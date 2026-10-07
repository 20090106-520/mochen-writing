/**
 * 技能库（plan3 spec §11）：全局 `<appData>/…/skills/<名>/SKILL.md` + 书内 `.mochen/skills/<名>/SKILL.md`。
 *
 * 这一层是**只读浏览 + 显式挂入**：没有编写、没有删除、没有导入通道。
 * 技能不是 BookKind——它不进文稿树、不参与章节顺序、也不在 `scanBook` 的眼里
 * （`.mochen` 被跳过是既有正确行为，文稿扫描不该看见会话/备份/技能）。
 *
 * 两条刻意的收窄：
 * - id 恒为 `${source}:${dirName}`。同名的全局与书内技能会撞，靠 source 区分；合并时**书内优先**。
 * - relPath 恒为 `<dirName>/SKILL.md`，文件名一字不差。读取安全全靠这一条形状，见 SKILL_FILE_NAME。
 */
import { z } from "zod";

/** 技能的两个来源。同名时书内优先（用户在自己书里写的那份，比全局那份更贴这本书）。 */
export const SKILL_SOURCES = ["global", "book"] as const;
export type SkillSource = (typeof SKILL_SOURCES)[number];

/** 技能目录里那个唯一入口文件的名字——读取守卫按它逐字比对，不给别的名字留口子。 */
export const SKILL_FILE_NAME = "SKILL.md";

/** 挂入技能的单条路径上限与每轮条数上限（spec §11 的 `z.array(...).max(12)`）。 */
export const SKILL_PATH_MAX_LEN = 300;
export const SKILL_PATHS_MAX = 12;

/** 单个技能正文的读上限（64 KB）。超出截断并如实标 truncated，绝不静默少给。 */
export const SKILL_CONTENT_MAX_BYTES = 64 * 1024;

export const skillRefSchema = z.object({
  /** `${source}:${dirName}`，合并去重与「已挂入」比对都用它。 */
  id: z.string().min(1),
  source: z.enum(SKILL_SOURCES),
  dirName: z.string().min(1),
  displayName: z.string(),
  description: z.string(),
  /** frontmatter `stage`：这一枚技能推荐在哪些阶段用（只作提示，不作闸门）。 */
  stages: z.array(z.string()),
  /** frontmatter `appliesTo`：推荐挂在哪些文稿上（同样只是提示）。 */
  appliesTo: z.array(z.string()),
  relPath: z.string().min(1)
});
export type SkillRef = z.infer<typeof skillRefSchema>;

/** skills:read 的返回。`truncated` 必须透传给用户——「读到的不是全部」不装作是全部。 */
export interface SkillContent {
  relPath: string;
  content: string;
  truncated: boolean;
}

/**
 * 挂入技能的入参守卫（`StartTurnInput.skillPaths`）。
 * 必填、无默认值：渲染层忘了传就在边界上炸出中文，而不是悄悄按「没挂技能」发出去。
 */
export const skillPathsSchema = z
  .array(z.string().min(1, "挂入技能的路径不能为空").max(SKILL_PATH_MAX_LEN, "挂入技能的路径过长"))
  .max(SKILL_PATHS_MAX, `挂入的技能太多（最多 ${SKILL_PATHS_MAX} 个）`);

/** 两个来源的中文名，穷尽表（铁律 6）：来源标签在三处 UI 上摆，不许各写一份。 */
export const SKILL_SOURCE_LABELS: Record<SkillSource, string> = {
  global: "全局技能",
  book: "本书技能"
};

/** 拼 id：全局这一处与 fs-store 的 scanSkills 共用同一句形，不许各处手搓 `${source}:${dirName}`。 */
export function skillIdOf(source: SkillSource, dirName: string): string {
  return `${source}:${dirName}`;
}

/**
 * 拆 id。渲染层把 `${source}:${dirName}` 递进 startTurn，主进程要还原成 (来源, 目录名) 才读得到盘。
 * 拆不出来（没有冒号、来源不认识）⇒ 返回 null，调用方给一句中文——绝不猜一个来源去读盘。
 */
export function splitSkillId(id: string): { source: SkillSource; dirName: string } | null {
  const at = id.indexOf(":");
  if (at <= 0 || at === id.length - 1) return null;
  const source = id.slice(0, at);
  if (!SKILL_SOURCES.includes(source as SkillSource)) return null;
  const dirName = id.slice(at + 1);
  if (dirName.includes("/") || dirName.includes("\\") || dirName === "." || dirName === "..") {
    return null;
  }
  return { source: source as SkillSource, dirName };
}
