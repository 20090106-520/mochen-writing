import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  IPC_CHANNELS,
  SKILL_FILE_NAME,
  catalogView,
  marketTargetDir,
  type MarketListResult,
  type MarketSkill,
  type SkillSource
} from "@mochen/contracts";
import { scanSkills } from "@mochen/fs-store";

/** electron 的 ipcMain.handle 的窄形状（与 skill-service 同款）：装配处传进来，测试处传注册表。 */
type Handler = (channel: string, fn: (...args: unknown[]) => unknown) => void;

/**
 * 技能市场的主进程真身（2026-10-07）。
 *
 * 【这一层是技能库第一条写路径，所以它的守卫必须比只读那套更严】
 * `skill-service.ts` 是纯只读，写闸压根不存在；这里开了写，就得自己把三条线守住：
 *
 * 1. **只往全局目录写，绝不碰书目录。**
 *    装到书里看起来更贴心，但书是用户的作品，而且是会被同步/版本控制的——
 *    一个应用往用户的作品目录里塞文件，是本仓明确不做的事（那属于 `changes-service` 的回滚管辖区）。
 * 2. **目录名必须过 `MARKET_DIR_NAME_RE`**（在 contracts 的 `marketTargetDir` 里），
 *    拿它拼绝对路径；不合法直接拒，不给「大概安全」的路径。
 * 3. **装之前查同名**：全局已有同名目录时**拒绝**而不是覆盖。
 *    覆盖会毁掉用户自己改过的技能——而用户改过它是完全合理的事。
 *    卸载更严：**只允许删本市场装出去的那一份**（靠清单里的 dirName 白名单），
 *    不在清单里的目录名一律拒删，哪怕它就躺在全局 skills 目录下。
 *
 * 【为什么不装「就跳过已有」】那会让「重装/更新」变得不可能。
 * 现在的形状是：装 → 报「已经装过了」；卸 → 真的删掉；再装 → 装上。
 * 三步各自可逆，用户想更新就卸了重装，不含糊。
 */
export interface SkillMarketService {
  list(): Promise<MarketListResult>;
  /** 装一条。返回一句中文结果（成功也是一句话，让 UI 有一致的落点）。 */
  install(dirName: string): Promise<string>;
  uninstall(dirName: string): Promise<string>;
  /** 已装/书内各有哪些目录名——判定与 list 共用同一份读法，不另写一遍。 */
  dirNames(): Promise<{ installed: Set<string>; book: Set<string> }>;
}

export function createSkillMarketService(deps: {
  /** 内置清单（`skill-catalog.ts` 传进来；测试传自己的）。 */
  catalog: readonly MarketSkill[];
  /**
   * 两个来源的技能根，**直接取只读那套的 `dirOf`**（装配处把 `skillService.dirOf` 递进来）。
   *
   * 为什么借而不自己拼：`<书>/.mochen/skills` 这个路径在 `skill-service.ts` 里已经有一份实现。
   * 这里再拼一次，就是两份「书内技能在哪」的判定——将来目录形状一变、只改一处，
   * 市场就会悄悄去读一个不存在的目录，而且不报错（`scanSkills` 对 ENOENT 返回空表）。
   * 同理，「哪些目录算已装」也交给 `scanSkills`：
   * 它要的是「有同名目录**且读得到 SKILL.md**」，比「目录存在」更严，也与技能库那张表同源。
   */
  dirOf(source: SkillSource): string | null;
}): SkillMarketService {
  function byId(id: string): MarketSkill | null {
    // 清单是本进程里的常量，不接受任何外部 id：id 不在清单里就没有「这一条」可装。
    return deps.catalog.find((s) => s.dirName === id) ?? null;
  }

  /** 只读那套解析不出来的来源 = 装配漏了，不是「那一份不存在」。抛出去，不猜一个目录去写。 */
  function mustDirOf(source: SkillSource): string {
    const dir = deps.dirOf(source);
    if (dir === null) throw new Error(`技能来源 ${source} 没有目录`);
    return dir;
  }

  /**
   * 这一条要写去哪儿。null = **两种**都要拒的情况，调用方不许区分：
   * 装配没给出全局目录（读都没法读），或目录名不过守卫（拼出来的路径不可信）。
   * 用一个 null 把两件事一起表达，是不想让调用方「挑一个大概安全的」继续写。
   */
  function targetDirOf(skill: MarketSkill): string | null {
    const root = deps.dirOf("global");
    return root === null ? null : marketTargetDir(root, skill.dirName);
  }

  async function dirNames(): Promise<{ installed: Set<string>; book: Set<string> }> {
    const global = await scanSkills(mustDirOf("global"), "global");
    const bookDir = deps.dirOf("book");
    const book = bookDir === null ? [] : await scanSkills(bookDir, "book");
    return {
      installed: new Set(global.map((r) => r.dirName)),
      book: new Set(book.map((r) => r.dirName))
    };
  }

  async function list(): Promise<MarketListResult> {
    try {
      const names = await dirNames();
      return {
        entries: catalogView(deps.catalog, names.installed, names.book),
        listed: true,
        notice: ""
      };
    } catch (err) {
      // 列不出来就说列不出来——返回空表 + listed:false，UI 会显示「没列出来」而不是「一个技能都没有」。
      return { entries: [], listed: false, notice: `技能市场没有列出来：${reasonOf(err)}` };
    }
  }

  async function install(id: string): Promise<string> {
    const skill = byId(id);
    if (skill === null) return `市场里没有这一条：${id}`;
    const dir = targetDirOf(skill);
    if (dir === null)
      return `装不上《${skill.displayName}》：全局技能目录没配好，或这一条的目录名不合法`;
    const names = await dirNames();
    if (names.installed.has(skill.dirName)) {
      // 不覆盖：用户改过它是常事，覆盖等于毁掉。想更新就卸了重装（见类注释）。
      return `《${skill.displayName}》已经装在全局技能目录里了。要重新装，先卸掉再装。`;
    }
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, SKILL_FILE_NAME), skill.skillMd, "utf8");
    } catch (err) {
      return `装不上《${skill.displayName}》：${reasonOf(err)}`;
    }
    if (names.book.has(skill.dirName)) {
      // 装是成功了，但要说实话：同名那份在书里，会盖掉这份。
      return `装好了《${skill.displayName}》，不过这本书里已有一份同名的，合并时书内那份优先。`;
    }
    // 【2026-10-07 批次 5-㉛ 改文案】原本写的是「去技能库里把它加入这一轮的上下文」。
    // 那是技能库还是**另一个浮层**时的话；5-㉛ 起插件与技能合成同一个整页，
    // 而这张卡就摆在这一页上——「去技能库」是把用户往他已经在的地方赶，
    // 而他真正缺的信息是「装好 ≠ 这一轮生效」这件事，以及该按哪颗钮。
    return `装好了《${skill.displayName}》。这张卡上点「挂入」才能加进这一轮的上下文。`;
  }

  async function uninstall(id: string): Promise<string> {
    const skill = byId(id);
    // 不在清单里的一律拒删：哪怕它就躺在全局 skills 目录下——那个目录是用户的，
    // 应用没有权力凭「名字看着像」就把它删了。
    if (skill === null) return `市场里没有这一条，不删：${id}`;
    const dir = targetDirOf(skill);
    if (dir === null)
      return `卸不掉《${skill.displayName}》：全局技能目录没配好，或这一条的目录名不合法`;
    const names = await dirNames();
    if (!names.installed.has(skill.dirName)) return `《${skill.displayName}》本来就没装。`;
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (err) {
      return `卸不掉《${skill.displayName}》：${reasonOf(err)}`;
    }
    return `卸掉了《${skill.displayName}》。`;
  }

  return { list, install, uninstall, dirNames };
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 三条通道：列 / 装 / 卸。装与卸只收一个 `dirName` 字符串——
 * 渲染层不能传路径、不能传来源，只能指清单里的某一条（主进程再自己解析成绝对路径）。
 */
export function registerSkillMarketIpc(handle: Handler, market: SkillMarketService): void {
  handle(IPC_CHANNELS.marketList, () => market.list());
  handle(IPC_CHANNELS.marketInstall, (_event, id) => market.install(String(id)));
  handle(IPC_CHANNELS.marketUninstall, (_event, id) => market.uninstall(String(id)));
}
