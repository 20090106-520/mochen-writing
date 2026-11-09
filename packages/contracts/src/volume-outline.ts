/**
 * 卷纲 → 章纲的**结构化判定层**（2026-10-05，批次 5-②）。
 *
 * **要解决的问题**：本项目的「分卷」与「大纲」两类文稿都是**自由 markdown**，
 * 作者爱怎么写就怎么写。自由是好事，但它有个代价——写完之后没法回答
 * 「第三卷一共有几章」「哪几章还没写钩子」「每章目标字数加起来够不够」。
 * 这些问题的答案在人脑里，不在文件里。
 *
 * **边界（与 ai-slop / review-score / timeline-check 同一条铁律）**：
 * 本模块**只做能量出来的结构化**——把已经写在卷纲里的字段摆成一张表。
 * 它不判断章与章之间成不成立、不判断剧情好不好、不替作者补写缺的那一项。
 * 缺就是缺，照实留空并计入 `missing`；补齐是作者自己的活，不是工具的。
 *
 * **为什么住 contracts**：章纲生成要写盘（fs-store），面板要显示（renderer），
 * 两边都要用同一份判定与同一份字段表——放渲染层会被 fs-store 反向依赖，
 * 放 fs-store 则契约跟着搬砖。按铁律 6 的口径（跨层契约住 contracts）放这里。
 */
import { splitFrontmatter } from "./frontmatter.js";

/**
 * 章纲字段的唯一真身（穷尽表：加一个字段而忘了写标签，下游 `Record` 立刻编译不过）。
 *
 * 这六个字段是雪花法在「一章」这个粒度上真正会用到的东西——
 * 谁在看（pov）、他要什么（goal）、谁拦着他（conflict）、
 * 这一章结束后什么变了（turn）、读者为什么翻下一章（hook）、写多长（wordTarget）。
 */
export const CHAPTER_OUTLINE_FIELDS = [
  "pov",
  "goal",
  "conflict",
  "turn",
  "hook",
  "wordTarget"
] as const;
export type ChapterOutlineField = (typeof CHAPTER_OUTLINE_FIELDS)[number];

/** 字段 → 中文标签。组件不许自己写字面量标签（同一句话只住一处）。 */
export const CHAPTER_OUTLINE_LABELS: Record<ChapterOutlineField, string> = {
  pov: "视角",
  goal: "目标",
  conflict: "冲突",
  turn: "转折",
  hook: "钩子",
  wordTarget: "字数"
};

/**
 * 标签的**别名表**：作者写「阻力」还是「冲突」、写「尾钩」还是「钩子」，都算同一项。
 * 这张表只做「标签 → 字段」的归一，值一个字都不改（铁律 6：原文照留）。
 * 键必须小写（匹配前统一 `toLowerCase`）；新增别名先想清楚它会不会与现有字段撞义。
 */
const FIELD_ALIASES: Record<string, ChapterOutlineField> = {
  pov: "pov",
  视角: "pov",
  主角: "pov",
  目标: "goal",
  目的: "goal",
  冲突: "conflict",
  阻力: "conflict",
  矛盾: "conflict",
  转折: "turn",
  变化: "turn",
  钩子: "hook",
  尾钩: "hook",
  字数: "wordTarget",
  字数目标: "wordTarget",
  目标字数: "wordTarget"
};

/** 一条字段行的形状：可选项目符号 → 可选加粗 → 标签 → 分隔符 → 值。 */
const FIELD_LINE =
  /^\s*(?:[-*+]\s+)?(?:\*\*|__)?\s*([^\s:：=＝*_][^:：=＝*_]{0,11})\s*(?:\*\*|__)?\s*[:：=＝]\s*(.*)$/;

export interface ParsedChapter {
  /** 文档里的出场次序（1 起）。**不按标题里的数字重排**——分卷顺序是作者定的，不是标题定的。 */
  order: number;
  /** 标题原文，一字不改（剥掉 `##` 与「第X章」之外的东西都不动）。 */
  title: string;
  /** 这个标题是被哪条规则认成章节的（面板上要能说清「凭什么说这是章」）。 */
  detectedBy: "heading" | "numbered";
  /** 每个字段的原文值；空串 = 这一项没写。 */
  fields: Record<ChapterOutlineField, string>;
  /** 没写的字段（派生，不另存一份——铁律 6）。 */
  missing: ChapterOutlineField[];
  /** `wordTarget` 读得出纯整数时的数字值；读不出（写了「三千字」）就是 null，**不猜**。 */
  wordTarget: number | null;
  /** 没有字段标签的其余正文：原样保留，生成章纲时当提要用。 */
  body: string;
  /**
   * 一个字段都没写出来。多半是分组标题（如 `## 人物线`）而不是一章——
   * 面板照实标出来让人自己判断，不替它决定「这是一章」。
   */
  isLoose: boolean;
}

export interface VolumeOutline {
  chapters: ParsedChapter[];
  /** 认不出任何章时的一句中文（可直接显示）；认得出来就是空串。 */
  note: string;
}

/**
 * 本模块**算不出来**的东西，写在文件里而不是留给用户去猜。
 * 面板上有一块专门把它列出来——与 4-② 审稿打分、5-① 时间线核对同款。
 */
export const VOLUME_OUTLINE_BLIND_SPOTS = [
  "读不出章与章之间的因果与递进成不成立，只能把你已经写下的字段摆整齐。",
  "分不出「这一节是一章」还是「这一节是个分组」——一个字段都没写的节会标出来让你自己定。",
  "标题里的「第几章」不参与排序：出场次序就是你在卷纲里写的次序。",
  "没写的字段一律留空，不替你编。"
] as const;

/** `## 标题` / `### 标题`：二级与三级标题是章节的来源；一级是卷纲自己的标题，不算章。 */
const HEADING_RE = /^(#{2,3})\s+(.+?)\s*#*$/;
/** `第 3 章 潮信` / `第三章`：中文数字与阿拉伯数字都认。 */
const NUMBERED_RE = /^\s*第\s*([0-9]+|[〇零一二三四五六七八九十百千两]+)\s*[章回节]\s*(.*)$/;

function emptyFields(): Record<ChapterOutlineField, string> {
  return {
    pov: "",
    goal: "",
    conflict: "",
    turn: "",
    hook: "",
    wordTarget: ""
  };
}

/**
 * 字数只认**纯整数**（`3000` / `3000 字` / `约 3000`）。
 * 「三千字」「两千五百」这类中文数字不转——本地没有可靠的中文数字解析，
 * 猜错一个数比留空更坏（留空是「没读出来」，猜错是「读出来是错的」）。
 */
function parseWordTarget(raw: string): number | null {
  const m = /[0-9]+/.exec(raw);
  if (m === null) return null;
  const n = Number(m[0]);
  // 0 与负数不是字数目标，读不出来。
  return n > 0 ? n : null;
}

/**
 * 这一行是不是章节的开头（解析与「写回原文」共用这一份判定）。
 * 返回 null = 不是章；否则给出标题与「凭什么认成章」。
 */
function chapterStartOf(line: string): {
  title: string;
  detectedBy: ParsedChapter["detectedBy"];
} | null {
  const heading = HEADING_RE.exec(line);
  if (heading !== null) {
    return { title: (heading[2] ?? "").trim(), detectedBy: "heading" };
  }
  const numbered = NUMBERED_RE.exec(line);
  if (numbered !== null) {
    const rest = (numbered[2] ?? "").trim();
    return { title: rest === "" ? line.trim() : rest, detectedBy: "numbered" };
  }
  return null;
}

/**
 * 这一行是不是一条字段行（解析与「写回原文」共用这一份判定）。
 * `value` 是 trim 之后的值；`label` 是原文里那个标签（写回时要保留作者原词）。
 */
function fieldOfLine(
  line: string
): { field: ChapterOutlineField; label: string; value: string } | null {
  const fieldLine = FIELD_LINE.exec(line);
  if (fieldLine === null) return null;
  const field = FIELD_ALIASES[(fieldLine[1] ?? "").toLowerCase()];
  if (field === undefined) return null;
  return { field, label: fieldLine[1] ?? "", value: (fieldLine[2] ?? "").trim() };
}

/**
 * 把一篇卷纲 markdown 拆成结构化章节。
 *
 * **纯函数**：不读盘、不调模型、不看任何全局状态。同样的输入永远给同样的输出。
 *
 * 认章的两条规则（面板上原样告诉用户是哪一条认的）：
 * ① 二/三级标题（`## 第一章 潮信`）；
 * ② 独立的「第N章」行（`第 3 章 潮信`，前面没有标题符号）。
 * 两者都认不了时，一个章都不报，`note` 说清为什么——不给空数组让用户猜。
 */
export function parseVolumeOutline(raw: string): VolumeOutline {
  const body = splitFrontmatter(raw ?? "").body;
  const lines = body.split(/\r?\n/);

  type Draft = {
    title: string;
    detectedBy: ParsedChapter["detectedBy"];
    fields: Record<ChapterOutlineField, string>;
    bodyLines: string[];
  };
  const drafts: Draft[] = [];
  let current: Draft | null = null;
  /** 第一条章之前的内容（卷纲的引子/总纲）——不进任何一章的 body。 */
  const preamble: string[] = [];

  const startDraft = (title: string, detectedBy: Draft["detectedBy"]): Draft => {
    const next: Draft = { title, detectedBy, fields: emptyFields(), bodyLines: [] };
    drafts.push(next);
    return next;
  };

  for (const line of lines) {
    const start = chapterStartOf(line);
    if (start !== null) {
      current = startDraft(start.title, start.detectedBy);
      continue;
    }
    if (current === null) {
      preamble.push(line);
      continue;
    }
    // 字段行：先按标签表归一，认出来才从正文里拿走。
    const fieldLine = fieldOfLine(line);
    if (fieldLine !== null) {
      // 同一字段重复写：后写的盖前面的，并把**被盖掉的那一句**留在 body 里标出「已作废」——
      // 「同一个字段说了两遍不同的话」是需要人判断的事，静默丢掉一句就是替作者做决定。
      if (current.fields[fieldLine.field] !== "") {
        current.bodyLines.push(
          `- ${fieldLine.label}：${current.fields[fieldLine.field]}（这一项在下面又写了一遍，上面这句已作废）`
        );
      }
      current.fields[fieldLine.field] = fieldLine.value;
      continue;
    }
    current.bodyLines.push(line);
  }

  const chapters: ParsedChapter[] = drafts.map((draft, i) => {
    const missing = CHAPTER_OUTLINE_FIELDS.filter((field) => draft.fields[field] === "");
    return {
      order: i + 1,
      title: draft.title,
      detectedBy: draft.detectedBy,
      fields: draft.fields,
      missing,
      wordTarget: parseWordTarget(draft.fields.wordTarget),
      body: draft.bodyLines.join("\n").trim(),
      isLoose: missing.length === CHAPTER_OUTLINE_FIELDS.length
    };
  });

  if (chapters.length === 0) {
    const lead = preamble.join("\n").trim().slice(0, 40);
    return {
      chapters: [],
      note:
        lead === ""
          ? "这篇卷纲里没认出章节——用 `## 标题` 或单独一行「第N章」开一章。"
          : `这篇卷纲里没认出章节——开头是「${lead}…」这类提要。用 \`## 标题\` 或单独一行「第N章」开一章。`
    };
  }

  return { chapters, note: "" };
}

/** 一章的完整度（0~1）：面板画进度条用。字段没写的章自然低，不必另外维护一份「重要度」。 */
export function chapterCompleteness(chapter: ParsedChapter): number {
  return (CHAPTER_OUTLINE_FIELDS.length - chapter.missing.length) / CHAPTER_OUTLINE_FIELDS.length;
}

/**
 * 全卷已写明的目标字数总和。
 *
 * **三档，不是两档**（2026-10-05 真机读出来的）：没写、写了读不出、读得出。
 * 早先只分「读得出 / 读不出」两档，结果把**一个字段都没写**的那一节也算进 `unreadable`，
 * 面板于是说「另有 1 章写了数字但没读出来」——它压根没写过数字。
 * 那是替作者编事实，与本模块的边界直接冲突。现在：
 * - `total`：读得出纯整数的那些加起来（读不出与没写的都不算 0、也不算入）；
 * - `unreadable`：**写了但读不出**的章数（`fields.wordTarget` 非空、`wordTarget` 为 null）；
 * - 没写的那几章两档都不进——它们已经由 `chapter.missing` 如实报出来了，不必在这儿再说一遍。
 */
export function summedWordTarget(chapters: readonly ParsedChapter[]): {
  total: number;
  unreadable: number;
} {
  let total = 0;
  let unreadable = 0;
  for (const chapter of chapters) {
    if (chapter.wordTarget !== null) {
      total += chapter.wordTarget;
      continue;
    }
    if (chapter.fields.wordTarget !== "") unreadable += 1;
  }
  return { total, unreadable };
}

/**
 * 把一章拼成一篇**空的大纲文稿**的 markdown（2026-10-05 批次 5-②）。
 *
 * **三条口径，都不是随便定的**：
 * ① **只写卷纲里真写了的字段**。没写的**不写**——写一行 `- 冲突：` 会被下一次
 *    `parseVolumeOutline` 读成「写了空值」，而 `（待补）` 这种占位更糟：
 *    它会让作者以为这一项已经有人想过。缺的那几项**由面板列出来**，不落进文件。
 * ② 输出与卷纲**同一种形状**（标题 + `- 标签：值`）——所以本章纲再被
 *    `parseVolumeOutline` 读一遍，读回来的就是原来那几个字段。往返一致是这里的硬要求。
 * ③ 末尾写一行来路（哪个卷纲的第几章）。这不是字段、**也不是 frontmatter**：
 *    来路会变（卷纲改名了），放进 frontmatter 就得跟着同步，不值当。
 *
 * 纯函数，不读盘不调模型（同一判定只有一份实现，铁律 6）。
 */
export function buildChapterOutlineMarkdown(chapter: ParsedChapter, sourceTitle: string): string {
  // 二级标题不是一级：篇名由 frontmatter 的 title 承担（`createDoc` 的模板就带 title），
  // 正文里再顶一个一级标题会被 Markdown 编辑器当成正文的一部分。
  // 二级还正好是 `parseVolumeOutline` 认章的那一级——往返一致就靠这一行。
  const lines: string[] = [`## ${chapter.title}`, ""];
  for (const field of CHAPTER_OUTLINE_FIELDS) {
    const value = chapter.fields[field];
    if (value === "") continue;
    lines.push(`- ${CHAPTER_OUTLINE_LABELS[field]}：${value}`);
  }
  if (chapter.body !== "") {
    lines.push("", chapter.body);
  }
  lines.push("", `> 来自《${sourceTitle}》第 ${chapter.order} 章。`);
  return `${lines.join("\n")}\n`;
}

/** 一条「把某章的六项字段写回原文」的改动（2026-11 章纲可编辑）。 */
export interface ChapterFieldEdit {
  /** 章的出场次序（1 起），与 `ParsedChapter.order` 同一口径。 */
  order: number;
  /**
   * 只放**改过**的字段：没出现的键=这一项不动（连原词与标点都别碰）。
   * 值 trim 后为空 = 把这一项从原文里删掉（「没写」在文件里就是没有这行）。
   */
  fields: Partial<Record<ChapterOutlineField, string>>;
}

/**
 * 把章节字段的修改**就地写回**卷纲原文（2026-11 W-02 第一步）。
 *
 * **为什么不是重新拼一份**：原文是自由 markdown，除了六项字段还有引子、分组标题、
 * 段落正文、作者自己写的说明。按解析结果重拼会把这些整段丢掉。这里只动字段行：
 * 改过的行原地替换（保留作者原来的标签词，比如「阻力」不被改成「冲突」），
 * 空值删掉这一项的所有行，原来没写的插在本章最后一条字段行之后（一条都没有就紧跟标题）。
 * 其余每一个字节原样返回——包括 frontmatter、`第N章` 这种没有井号的标题行。
 *
 * 章按**出场次序**定位、不按标题：同一篇里两章同名是作者的自由，重名不该让改动落到错的章上。
 * 纯函数，不读盘不调模型；与 `parseVolumeOutline` 共用 `chapterStartOf` / `fieldOfLine`
 * 这一份「什么算章 / 什么算字段行」的判定（铁律 6）。
 */
export function applyChapterFieldEdits(raw: string, edits: readonly ChapterFieldEdit[]): string {
  const source = raw ?? "";
  const { block, body } = splitFrontmatter(source);
  const bom = source.charCodeAt(0) === 0xfeff ? "\ufeff" : "";
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const prefix = block === null ? "" : `${block}\n`;
  const lines = body.split("\n");

  const starts: number[] = [];
  for (const [index, line] of lines.entries()) {
    if (chapterStartOf(line) !== null) starts.push(index);
  }
  const editByOrder = new Map<number, ChapterFieldEdit["fields"]>();
  for (const edit of edits) editByOrder.set(edit.order, edit.fields);

  // 从最后一章往前改：前面章的插入/删除不会挪动已处理章的行号。
  for (let i = starts.length - 1; i >= 0; i -= 1) {
    const start = starts[i];
    const fields = editByOrder.get(i + 1);
    if (start === undefined || fields === undefined) continue;
    const end = i + 1 < starts.length ? (starts[i + 1] as number) : lines.length;

    const fieldLines: { line: number; field: ChapterOutlineField }[] = [];
    for (let j = start + 1; j < end; j += 1) {
      const parsed = fieldOfLine(lines[j] ?? "");
      if (parsed !== null) fieldLines.push({ line: j, field: parsed.field });
    }

    const replacements: { line: number; text: string }[] = [];
    const removals: number[] = [];
    const insertions: string[] = [];
    for (const field of CHAPTER_OUTLINE_FIELDS) {
      const value = fields[field];
      if (value === undefined) continue;
      // 字段是单行：换行会被下一次解析当成另一行（不是这一项的值）。
      const next = value.replace(/\r?\n/g, " ").trim();
      const hits = fieldLines.filter((hit) => hit.field === field);
      if (next === "") {
        // 清空 = 「这一项没写」：所有写它的行都删掉。只删最后一条的话，
        // 早先那句重复行（解析时被标成已作废的那句）会重新变成生效值。
        removals.push(...hits.map((hit) => hit.line));
        continue;
      }
      if (hits.length === 0) {
        insertions.push(`- ${CHAPTER_OUTLINE_LABELS[field]}：${next}`);
        continue;
      }
      const last = hits[hits.length - 1] as { line: number };
      // 保留原文标签词，只换冒号后面的值。
      const label = fieldOfLine(lines[last.line] ?? "")?.label ?? CHAPTER_OUTLINE_LABELS[field];
      replacements.push({ line: last.line, text: `- ${label}：${next}` });
    }

    for (const replacement of replacements) lines[replacement.line] = replacement.text;
    removals.sort((a, b) => b - a);
    for (const line of removals) lines.splice(line, 1);

    if (insertions.length > 0) {
      // 删完之后重扫这一章，插在最后一条字段行之后；一条都没有就紧跟标题。
      const shiftedEnd =
        i + 1 < starts.length ? (starts[i + 1] as number) - removals.length : lines.length;
      let anchor = start + 1;
      for (let j = start + 1; j < shiftedEnd; j += 1) {
        if (fieldOfLine(lines[j] ?? "") !== null) anchor = j + 1;
      }
      let offset = 0;
      for (const text of insertions) {
        lines.splice(anchor + offset, 0, text);
        offset += 1;
      }
    }
  }

  return `${bom}${prefix}${lines.join("\n")}`.replace(/\n/g, eol);
}
