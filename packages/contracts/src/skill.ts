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
 * 清单行里 description 的截断长度（挂入行与技能库索引行共用一把尺）：
 * 够认出「它是干什么的」，不够塞进一份说明书。
 */
const SKILL_INDEX_DESC_CHARS = 48;

/** 压成一行并截断：清单里每条只占一行，description 里换行会把清单拆成两段。 */
function briefDesc(description: string): string {
  const flat = description.replace(/\s+/g, " ").trim();
  if (flat === "") return "（无说明）";
  const chars = [...flat];
  return chars.length <= SKILL_INDEX_DESC_CHARS
    ? flat
    : `${chars.slice(0, SKILL_INDEX_DESC_CHARS).join("")}…`;
}

/**
 * 技能清单里的一行（P0-2）：只给名称、id、用途与适用面，**不给正文**。
 * 正文由 `use_skill` 按 id 按需读取——清单进系统提示，方法留在盘上，挂多少技能都不吃预算。
 *
 * 【为什么行尾不再带「正文未载入，需要时用 use_skill 读取」】那句话原先是每行一份，
 * 挂满 12 条就是同一句制式话在提示词里出现 12 遍；而上下文包末尾的 `skillHint`
 * 已经整段说过一次（`agent-service.ts`），技能库索引的段头也说一次。三处说同一件事，
 * 模型读到的是一段复读机——正是它最擅长模仿的形状。这里只留**这一条是什么**，
 * 「怎么读」交给说一次的那两处。
 *
 * 【为什么 description 也截断】索引行截到 48 字（`briefDesc`），挂入行原先一个字不截。
 * 用户写三千字说明的场合下，这行会撑满 `PINNED_SKILL_CHARS` 的上限并被 clip 从中间切断——
 * 「清单短句永远碰不到上限」这个前提当场失效，而且被切掉的正是行尾。两处用同一把尺。
 */
export function skillBriefLine(ref: SkillRef): string {
  const hints: string[] = [];
  if (ref.stages.length > 0) hints.push(`阶段：${ref.stages.join("、")}`);
  if (ref.appliesTo.length > 0) hints.push(`文稿：${ref.appliesTo.join("、")}`);
  const tail = hints.length > 0 ? `（${hints.join("；")}）` : "";
  return `${ref.displayName || ref.dirName}（${ref.id}）：${briefDesc(ref.description)}${tail}`;
}

/**
 * 模型把技能 id 写错时，认出「它指的是哪一份」（2026-11-12）。
 *
 * 【为什么值得一个函数】`use_skill` 只认完整 id（`global:check-style`），而清单里同一份技能
 * 同时摆着三个字面量：显示名（文风检查）、目录名（check-style）、完整 id。模型照着前两个
 * 调一次是常态——历史里这种手误一次就白烧一轮工具往返，而模型对工具报错的反应往往是
 * 回头解释一遍（「抱歉，我需要先列出技能」，正是对话里最重的那层 AI 腔）。
 *
 * 匹配只认三条、且每条都要求**整段相等**：完整 id（不分大小写）→ 目录名 → 显示名
 * （抹掉空白后）。不做前缀或包含匹配：「文风」能同时对上「文风检查」「文风分析」，
 * 猜错比不猜更费一轮，而调用方拿不到「这是猜的」这个信号。同一档里有多个候选就当
 * 认不出（返回 null）——两份同名技能时，选哪一份都是随机的。
 *
 * 它不读盘、也不判断停用：停用是纪律（P0-4），由调用方拿到候选后自己把闸，
 * 否则「你是指它吧」会把一份停用技能的存在感递出去。
 */
export function matchSkillRef(wanted: string, refs: readonly SkillRef[]): SkillRef | null {
  const key = wanted.trim();
  if (key === "" || refs.length === 0) return null;
  const lower = key.toLowerCase();
  const flat = (text: string): string => text.replace(/\s+/g, "");
  const flatKey = flat(key);
  /** 只有唯一候选才算认出：同档多个 = 认不出（选谁都是随机）。 */
  const only = (list: SkillRef[]): SkillRef | null => {
    const hit = list[0];
    return list.length === 1 && hit !== undefined ? hit : null;
  };
  return (
    only(refs.filter((ref) => ref.id.toLowerCase() === lower)) ??
    only(refs.filter((ref) => ref.dirName.toLowerCase() === lower)) ??
    only(refs.filter((ref) => flat(ref.displayName) === flatKey))
  );
}

/**
 * 技能库索引的额度（2026-11-10）。
 *
 * 【它解决的是哪件事】挂入机制只能把**用户或自动识别挑中的**那几枚摆到模型眼前。
 * 库里另外那几十枚——装进来的、网上扒的、自己写的——模型根本不知道存在，
 * 于是「按需自己调用」实际退化成了「只能用手挑的」。这一段把整库的名字摆出去，
 * 正文仍旧留在盘上（`use_skill` 现读），所以不吃技能正文额度。
 *
 * 【为什么要双闸】条数与字数各一道：只限条数挡不住「一份技能写了一千字 description」，
 * 只限字数挡不住「三百条各一行」——后者会把提示词里的技能段挤到让人无法阅读。
 * 超出的部分不静默丢弃，末尾如实报「还有 N 条没列出」并给出列全的办法。
 */
export const SKILL_INDEX_MAX_ITEMS = 24;
export const SKILL_INDEX_MAX_CHARS = 1800;

export interface SkillIndexOptions {
  maxItems?: number;
  maxChars?: number;
}

export interface SkillIndexResult {
  /** 直接拼进系统提示的整段文本；没有可列的技能时是空串（调用方据此不写这一段）。 */
  text: string;
  /** 剔掉挂入之后，库里还剩多少条。 */
  total: number;
  /** 这一段真正列出来几条。 */
  shown: number;
}

/** 压成一行并截断：清单里每条只占一行，description 里换行会把清单拆成两段。 */
/**
 * 拼「技能库索引」这一段：库里**没挂入**的技能，一行一条（名称 · id · 一句说明）。
 *
 * 【为什么排除挂入的那些】挂入的技能已经在上下文里有一行清单（`skillBriefLine`，
 * 带「何时用」），再列一遍等于同一份技能在提示词里出现两次，模型会当成两条。
 *
 * 【为什么按 id 排序】提示词要可复现：同一份技能库在同一本书里，每一轮拼出来的这一段
 * 必须逐字相同，否则前缀缓存每轮都失效，而且用户看到的读数会莫名其妙地抖。
 * 按 `id` 排是稳定序，且与技能库列表的排序口径无关（那页是按分类与推荐度排的）。
 */
export function skillIndexBlock(
  refs: readonly SkillRef[],
  pinned: readonly string[] = [],
  options: SkillIndexOptions = {}
): SkillIndexResult {
  const maxItems = options.maxItems ?? SKILL_INDEX_MAX_ITEMS;
  const maxChars = options.maxChars ?? SKILL_INDEX_MAX_CHARS;
  const skip = new Set(pinned);
  const rest = refs.filter((ref) => !skip.has(ref.id)).sort((a, b) => (a.id < b.id ? -1 : 1));
  const total = rest.length;
  if (total === 0) return { text: "", total: 0, shown: 0 };

  const lines: string[] = [];
  let used = 0;
  for (const ref of rest) {
    if (lines.length >= maxItems) break;
    const line = `- ${ref.displayName || ref.dirName}（${ref.id}）：${briefDesc(ref.description)}`;
    // +1 是换行符：按拼起来之后的实际长度算，否则「刚好卡在额度上」的那一条会被多算。
    if (used + [...line].length + 1 > maxChars) break;
    lines.push(line);
    used += [...line].length + 1;
  }
  // 一条都塞不进（额度被调得过小）时不硬塞半条：返回空段，让调用方当「没有索引」。
  if (lines.length === 0) return { text: "", total, shown: 0 };

  // 【读法只在没别处说过时写全（2026-11-12）】这一段与「挂入技能清单」住在同一个上下文包里，
  // 而清单后面已经有一句 `SKILL_HINT` 交代过「先 use_skill 读全文、别凭名字猜做法」。
  // 用户既挂了技能、库里又还有别的技能，是**最常出现**的一种组合——两段各说一遍同样的读法，
  // 模型读到的又是一次重复。所以只要这一轮真的剔掉过挂入条目（说明清单在、读法已说过），
  // 这里就只交代「这一段是什么」，读法用一句「同上」带过。
  const pinnedShown = refs.length - rest.length > 0;
  const head = pinnedShown
    ? "技能库里还有下面这些技能，本轮**没有挂入**、正文也没有载入" +
      "（读法同上：先 use_skill 读出全文再照它做，别凭名字猜做法）："
    : "技能库里还有下面这些技能，本轮**没有挂入**、正文也没有载入：" +
      '看中哪一份，先 use_skill("<id>") 读出全文再照它做；' +
      "**没读正文之前，不要凭名字猜它的做法**（名字只说明它治什么，不说明怎么治）。";
  const tail =
    lines.length < total
      ? `（库里共 ${total} 条，这里先列 ${lines.length} 条；剩下的用 use_skill 不带参数可以列全。）`
      : "";
  const text = [head, ...lines, tail].filter((one) => one !== "").join("\n");
  return { text, total, shown: lines.length };
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
 * 剥掉技能正文末尾的「## 出处」段（2026-11-12）。
 *
 * 【为什么读给模型之前要剥，UI 却不剥】24 份市场技能的出处原在第二段（「改编自 …（MIT）。
 * 只搬方法，不搬原文。」），一轮里打开技能详情看到的第一段就是这句——上一轮按本仓
 * 「同一句制式话不重复」的规矩把它统一搬到了文末 `## 出处`。搬完它才有一个稳定位置，
 * 可以被一条规则摘掉，而不是每份各写一遍正则。
 *
 * 摘掉的是两层浪费：
 * ① 字数——每份 40–60 字，挂三份就吃掉一条技能的额度；
 * ② 更像问题的是**形状**：模型读一份方法，末尾写着「改编自 xx/yy（MIT）」，
 *    它会把这半句当正文的一部分来学。一份讲「怎么改文风」的技能后面跟着一段版权声明，
 *    模板味的来源之一就是这种「文档附带物」混在方法里。
 *
 * 署名义务不受影响：出处仍留在 SKILL.md、技能详情页照常显示（渲染层走
 * `window.mochen.readSkill`，与这里无关），随分发保留。不递给模型的只是那一遍复述。
 *
 * 只认**文末最后一个小节**是「## 出处」才摘：自定义技能万一在中间写了个叫「出处」的
 * 二级标题、后面还有正文，摘到文末就是吃内容。判据很朴素——最后一个 `## ` 标题是不是它。
 */
export function stripSkillOrigin(body: string): string {
  const lines = body.split("\n");
  let lastHeading = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i] ?? "")) lastHeading = i;
  }
  if (lastHeading < 0) return body;
  if (!/^##\s*出处\s*$/.test((lines[lastHeading] ?? "").trim())) return body;
  const kept = lines.slice(0, lastHeading).join("\n").trimEnd();
  // 整份正文只有一节出处（坏技能）：宁可原样递出去让模型看见病在哪，也不递一段空白。
  return kept === "" ? body : kept;
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
