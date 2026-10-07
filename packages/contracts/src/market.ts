/**
 * 技能市场（2026-10-07 用户裁定：「插件市场和技能都做，只不过是适配我这个软件能用的」）。
 *
 * 【这一段的裁定已被 5-㉘ 改写过一次，原文照录以便对照】
 * 起初的判断是：Harness 的插件跑在 `dsh` 运行时里（`@deepseek-ai/cordis`、`ctx.tools`、
 * `ctx.skills` 都是 Cordis 的 service），而墨宸当时没有 Cordis 的 service 容器，
 * 所以「装进去的插件拿不到 `ctx.tools`，注册的工具模型根本不会被墨宸的 agent 循环看见」。
 *
 * 那个判断是对的，但结论已经过时：2026-10-07 批次 5-㉘ 给墨宸加了一个
 * **Cordis 兼容内核**（`packages/plugin-kernel`），5-㉙ 又给它补了 `docs` service，
 * 5-㉚ 补了停用/卸载与面板。插件现在真能挂上、工具真能进模型看得见的工具表
 * （真机验过，见 `plugin-service.test.ts` 与 p528/p529/p530 三份探针）。
 *
 * **那为什么这一张表装的仍然是技能、不是插件？**
 * 因为「兼容内核能让插件跑起来」与「我们应当替用户去搜插件」是两件事：
 * - DSH 现存插件多为编程向（改代码、跑测试），与写小说没有交集；
 * - 而**目录拉取**（从 awesome-dsh-plugin 之类的地方实时取清单）尚未做，
 *   那一套要的是网络、超时、失败重试、签名与许可核对——是独立的一轮，不是顺手加个 fetch。
 * 所以眼下这张表仍然装技能；插件的入口是本地插件目录（见 plugin-service.ts）。
 * 待做的是「插件市场」那一页，本文件的表格将来要扩出技能之外的第二类可安装单元。
 *
 * 所以**目前**这张表的可安装单元是技能（`SKILL.md`），不是 Cordis 插件：
 * - 墨宸本来就有技能机制（`skill-service.ts` 列/读 + `<dirName>/SKILL.md` 这一形状），
 *   技能是纯提示词，不碰运行时，装上立刻能用；
 * - 清单里每一条都注明**从哪来**与**许可**，抄来的必须说清抄自哪个仓库（见 SKILL_CATALOG）。
 *
 * 【清单是数据不是逻辑，判定只留一份】
 * 「已安装 / 可安装 / 这条要装到哪个目录 / 同名怎么办」全在 `catalogView()`，
 * 主进程与渲染层都读它，谁都不许自己再算一遍（铁律 6）。
 */
import { z } from "zod";

/**
 * 一条市场条目的**目录名**守卫。与 fs-store 读技能的形状守卫同一套口径：
 * 单层、非空、不含路径分隔符、不是 `.`/`..`——安装要拿它拼绝对路径，这四条是安全线。
 */
export const MARKET_DIR_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** 市场条目的分类。只有这几个值是合法标签——UI 上的筛选就是这张表，不另写一份。 */
export const MARKET_CATEGORIES = ["构思", "结构", "文风", "校对", "资料"] as const;
export type MarketCategory = (typeof MARKET_CATEGORIES)[number];

/**
 * 一条市场条目。
 *
 * `skillMd` 是**技能正文全文**（含 frontmatter），装的时候逐字写进
 * `<全局 skills>/<dirName>/SKILL.md`。写成代码里的常量而不是随包发一堆文件：
 * 这样「装上之后与用户手放的技能完全同形」是构造出来的，不是碰出来的——
 * 装完走的是同一套 `scanSkills` / `readSkillFile`，没有第二份解析路径（铁律 6）。
 */
export const marketSkillSchema = z.object({
  /** 目录名（kebab-case 英文）。装出来的技能目录就叫它，也是它的默认显示名兜底。 */
  dirName: z.string().regex(MARKET_DIR_NAME_RE),
  /** 清单上给用户看的中文名。frontmatter 的 `name` 也要写它，两处不一致以这里为准（由测试钉住）。 */
  displayName: z.string().min(1),
  /** 一句话说清它干什么用。会原样进 frontmatter 的 description，也是卡片上那行副标题。 */
  summary: z.string().min(1),
  category: z.enum(MARKET_CATEGORIES),
  /**
   * 从哪来。**必填，连「本仓原创」也要写出来**：
   * 一条说不清出处的技能不该进清单——将来有人问「这段是谁写的」时答不上来，
   * 比一开始不收更糟。
   */
  origin: z.string().min(1),
  /** 许可。抄来的必须照抄上游的（MIT / Apache-2.0 / …），不许含糊成「免费」。 */
  license: z.string().min(1),
  /** 正文全文，第一行必须是 frontmatter 的 `---`（由 `catalogView` 与测试共同钉住）。 */
  skillMd: z.string().min(1)
});
export type MarketSkill = z.infer<typeof marketSkillSchema>;

/** 市场列表的一条：清单条目 + 「装没装」这一态。 */
export interface MarketEntry extends MarketSkill {
  /** 已经装在全局技能目录里（有同名目录且读得到 SKILL.md）。 */
  installed: boolean;
  /** 已装但**书内**也有一份同名技能：全局那份会被书内那份盖住（`mergeSkillRefs` 的书内优先）。 */
  shadowedByBook: boolean;
}

/** skills:market-list 的返回。`listed` 与 `installed` 一样：空表与「还没问过」要分得开。 */
export interface MarketListResult {
  entries: MarketEntry[];
  listed: boolean;
  /** 装/卸失败时给的一句中文（成功时是空串）。由主进程填，渲染层不自己编理由。 */
  notice: string;
}

/**
 * 拼出这一条要装到哪儿。**唯一拼路径的地方**：
 * 装、卸、查已装三处都走它，免得三处各拼一次、其中一处忘了 realpath。
 * 返回 null = 目录名不合法（调用方必须拒，不能拿一个「大概安全」的路径去写盘）。
 */
export function marketTargetDir(globalSkillsDir: string, dirName: string): string | null {
  if (!MARKET_DIR_NAME_RE.test(dirName)) return null;
  return `${globalSkillsDir.replace(/[\\/]+$/, "")}/${dirName}`;
}

/**
 * 清单 + 已装合成的判定（唯一实现）。
 *
 * 三条判定都在这里，理由逐条写在这里：
 * 1. `installed` 看**全局**目录里有没有同名且读得到 SKILL.md 的目录——那才是「装上了」；
 *    书内那份是另一回事（用户自己放的），不算市场装出来的。
 * 2. `shadowedByBook` 单列：书内同名会在 `mergeSkillRefs` 里盖掉全局那份，
 *    于是「市场显示已装、但这一轮挂进去的其实是用户自己那份」。这不是 bug，是既有优先级，
 *    但**必须让用户看见**，否则他会以为市场那份生效了（这是本仓反复吃的「界面在撒谎」那一类）。
 * 3. 顺序：分类 → 目录名。分类按 `MARKET_CATEGORIES` 的声明序（不是字母序），
 *    所以「构思」永远排在最前，改表就是改顺序。
 */
export function catalogView(
  catalog: readonly MarketSkill[],
  installedDirNames: ReadonlySet<string>,
  bookDirNames: ReadonlySet<string>
): MarketEntry[] {
  const order = new Map(MARKET_CATEGORIES.map((c, i) => [c, i]));
  return catalog
    .map((skill) => ({
      ...skill,
      installed: installedDirNames.has(skill.dirName),
      shadowedByBook: bookDirNames.has(skill.dirName)
    }))
    .sort(
      (a, b) =>
        (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99) ||
        a.dirName.localeCompare(b.dirName, "en")
    );
}
