import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  IPC_CHANNELS,
  SKILL_FILE_NAME,
  composeSkillMd,
  marketTargetDir,
  skillAuthorDraftSchema,
  type SkillAuthorDraft,
  type SkillAuthorResult
} from "@mochen/contracts";
import { parseFrontmatter } from "@mochen/fs-store";
import { handleTrusted } from "./ipc-guard.js";

/** electron 的 ipcMain.handle 的窄形状（与本目录其它服务同款）。 */
type Handler = (channel: string, fn: (...args: unknown[]) => unknown) => void;

/**
 * 「自己创建技能」的主进程真身（2026-11-10 用户裁定：
 * 「可以自己创建技能，然后自己根据需要的技能自己调用」）。
 *
 * 【与兑换码那套的区别】
 * 兑换码是**给别人**的：编成一段码，别人兑进自己的库。这里是**给自己**的：
 * 在界面上填名字、说明、正文，直接落成 `<全局 skills>/<dirName>/SKILL.md`。
 * 落盘形状与手放、与市场装、与兑换码兑完全同形——四条路都走同一套 `scanSkills` 读取，
 * 没有第二条解析路径。
 *
 * 【三条守卫，与市场/兑换码同一条边界】
 * 1. 只写**全局**技能目录，不碰书目录（书是用户的作品）。
 * 2. 目录名过 `marketTargetDir` 的守卫；拼不出合法路径就拒，不拿「大概安全」的路径写盘。
 * 3. 默认**不覆盖**：同名已有 SKILL.md 时报「已经有了」，要覆盖必须显式带 `overwrite`。
 *    删除也要求目录里真有 SKILL.md——凭目录名就 rm 一个目录，风险不对等。
 *
 * 【删除为什么必须在这里】
 * 从网上装的、自己写的技能都不在 `SKILL_CATALOG` 里，市场那条卸载通道按清单白名单拒删，
 * 于是「装得进来、删不掉」。这条通道补的就是这个洞：只删全局目录下**确实有 SKILL.md** 的那一层。
 */
export interface SkillAuthorService {
  save(draft: unknown): Promise<SkillAuthorResult>;
  remove(dirName: unknown): Promise<SkillAuthorResult>;
}

export function createSkillAuthorService(deps: {
  /** 借只读那套的 `dirOf`：`<appData>/skills` 只在一处拼。 */
  dirOf: (source: "global" | "book") => string | null;
}): SkillAuthorService {
  function fail(notice: string, dirName = "", displayName = ""): SkillAuthorResult {
    return { ok: false, notice, dirName, displayName };
  }

  function dirFor(dirName: string): string | null {
    const root = deps.dirOf("global");
    return root === null ? null : marketTargetDir(root, dirName);
  }

  async function save(input: unknown): Promise<SkillAuthorResult> {
    const parsed = skillAuthorDraftSchema.safeParse(input);
    if (!parsed.success) {
      // 边界上的错误说人话：取第一条 issue 的 message（schema 里写的就是中文）。
      const issue = parsed.error.issues[0];
      return fail(`保存不了：${issue?.message ?? "内容不合格式"}`);
    }
    const draft: SkillAuthorDraft = parsed.data;
    const dir = dirFor(draft.dirName);
    if (dir === null) {
      return fail(
        draft.dirName.trim() === ""
          ? "保存不了：先给它起个目录名（英文、数字、短横线）。"
          : `保存不了：目录名「${draft.dirName}」不合法。`,
        draft.dirName,
        draft.displayName
      );
    }

    const file = path.join(dir, SKILL_FILE_NAME);
    const existed = await readOrNull(file);
    if (existed !== null && !draft.overwrite) {
      return fail(
        `已经有同名技能《${draft.displayName}》（目录 ${draft.dirName}）。要覆盖它，勾上「覆盖已有的」再保存。`,
        draft.dirName,
        draft.displayName
      );
    }

    const skillMd = composeSkillMd({
      displayName: draft.displayName,
      description: draft.description,
      stages: draft.stages,
      appliesTo: draft.appliesTo,
      body: draft.body
    });
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(file, skillMd, "utf8");
    } catch (err) {
      return fail(`保存失败：${reasonOf(err)}`, draft.dirName, draft.displayName);
    }
    return {
      ok: true,
      notice:
        existed === null
          ? `写好了《${draft.displayName}》（${draft.dirName}）。这张卡上点「挂入」就能在这一轮用上；开着自动技能的话它也会自己按需挂。`
          : `覆盖好了《${draft.displayName}》（${draft.dirName}）。`,
      dirName: draft.dirName,
      displayName: draft.displayName
    };
  }

  async function remove(input: unknown): Promise<SkillAuthorResult> {
    const dirName = String(input).trim();
    const dir = dirFor(dirName);
    if (dir === null) return fail(`删不掉：目录名「${dirName}」不合法。`, dirName);
    const file = path.join(dir, SKILL_FILE_NAME);
    const existed = await readOrNull(file);
    if (existed === null) {
      // 没有 SKILL.md 就不是一个技能目录。照样 rm 会把用户放在那儿的别的东西一起删掉。
      return fail(`删不掉：${dirName} 里没有 ${SKILL_FILE_NAME}，它不是技能目录。`, dirName);
    }
    // 结果里用技能自己的名字（frontmatter 的 name），不是目录名——
    // 「删掉了《skill-1x7tkp》」对用户等于没说是哪一个。
    const name = parseFrontmatter(existed).data.name;
    const displayName = typeof name === "string" && name.trim() !== "" ? name.trim() : dirName;
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (err) {
      return fail(`删除失败：${reasonOf(err)}`, dirName, displayName);
    }
    return { ok: true, notice: `删掉了《${displayName}》（${dirName}）。`, dirName, displayName };
  }

  return { save, remove };
}

/** 读不到就当没有。只有 ENOENT 会被当成「还没有」，其它错误（权限等）也确实读不到——同样按没有处理，写盘时再报。 */
async function readOrNull(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 两条通道：存一份自写技能、删掉全局目录里的一份。渲染层只递草稿/目录名，路径全由主进程拼。 */
export function registerSkillAuthorIpc(handle: Handler, author: SkillAuthorService): void {
  handleTrusted(handle, IPC_CHANNELS.skillsAuthorSave, (_event, draft) => author.save(draft));
  handleTrusted(handle, IPC_CHANNELS.skillsRemove, (_event, dirName) => author.remove(dirName));
}
