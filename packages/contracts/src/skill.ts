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
import type { BookSkillPolicy } from "./book.js";

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
 * 技能清单里的一行（P0-2）：只给名称、用途、适用面与载入方式，**不给正文**。
 * 正文由 `use_skill` 按 id 按需读取——清单进系统提示，方法留在盘上，挂多少技能都不吃预算。
 */
export function skillBriefLine(ref: SkillRef): string {
  const hints: string[] = [];
  if (ref.stages.length > 0) hints.push(`阶段：${ref.stages.join("、")}`);
  if (ref.appliesTo.length > 0) hints.push(`文稿：${ref.appliesTo.join("、")}`);
  const tail = hints.length > 0 ? `（${hints.join("；")}）` : "";
  return `${ref.displayName || ref.dirName}：${ref.description}${tail}；正文未载入，需要时用 use_skill("${ref.id}") 读取。`;
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

/**
 * 书级技能策略的缺省值（P0-4）。老书 `book.json` 里没有这一格时用的就是它——
 * 两个空清单，与升级前「开书时一个都没挂、也没有任何技能被停用」的行为逐字一致。
 */
export const EMPTY_SKILL_POLICY: BookSkillPolicy = { enabled: [], disabled: [] };

/**
 * 策略的**唯一**归一化入口（铁律 6）：老书、半份策略、null meta 都从这里落到完整形状。
 * 返回新数组（不吃 pinia 的响应式代理），调用方可以放心改。
 */
export function skillPolicyOf(
  meta: { skillPolicy?: BookSkillPolicy | undefined } | null | undefined
): BookSkillPolicy {
  const policy = meta?.skillPolicy;
  return {
    enabled: policy ? [...policy.enabled] : [],
    disabled: policy ? [...policy.disabled] : []
  };
}

/** 这一条技能在本书里是否被全局停用。 */
export function isSkillDisabled(policy: BookSkillPolicy, id: string): boolean {
  return policy.disabled.includes(id);
}

/**
 * 这一条会话实际生效的技能 id：**线程覆盖优先**（没有覆盖就继承书级默认），
 * 停用的一律剔除。顺序保持，便于 UI 与上下文装配读同一份。
 */
export function effectiveSkillIds(
  policy: BookSkillPolicy,
  override?: readonly string[] | null
): string[] {
  const base = override ?? policy.enabled;
  const disabled = new Set(policy.disabled);
  return base.filter((id) => !disabled.has(id));
}

/** 去重且保持原序（策略清单是小数组，不值得为它引一份通用工具）。 */
function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/**
 * 「设为书级默认 / 取消默认」。两个清单互斥：设默认时顺手把同一条从停用清单里摘掉，
 * 否则会同时出现在两边、生效与否取决于两个清单谁先被读——那正是最难解释的界面。
 */
export function skillPolicyWithDefault(
  policy: BookSkillPolicy,
  id: string,
  on: boolean
): BookSkillPolicy {
  return {
    enabled: on ? uniqueIds([...policy.enabled, id]) : policy.enabled.filter((one) => one !== id),
    disabled: on ? policy.disabled.filter((one) => one !== id) : [...policy.disabled]
  };
}

/**
 * 「停用 / 启用」。停用时同时从书级默认清单里摘掉，保证互斥；
 * 启用只从停用清单里摘，**不自动挂回默认**（用户没说过「重新设为默认」）。
 */
export function skillPolicyWithDisabled(
  policy: BookSkillPolicy,
  id: string,
  disabled: boolean
): BookSkillPolicy {
  return {
    enabled: disabled ? policy.enabled.filter((one) => one !== id) : [...policy.enabled],
    disabled: disabled
      ? uniqueIds([...policy.disabled, id])
      : policy.disabled.filter((one) => one !== id)
  };
}
