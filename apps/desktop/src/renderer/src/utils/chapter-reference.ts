import {
  CHAPTER_OUTLINE_FIELDS,
  CHAPTER_OUTLINE_LABELS,
  parseVolumeOutline,
  type ChapterOutlineField,
  type DocRef,
  type ParsedChapter
} from "@mochen/contracts";
import type { ForeshadowRow } from "./foreshadow";

/**
 * 「本章参考」的数据层（2026-11-09 W-03）。
 *
 * 右栏常驻一条，只回答「这一章该记着什么」：章纲摘要 / 出场人物 / 待回收伏笔。
 * 三条纪律贯穿全文件：
 * ① **不猜**：章纲按标题逐字对上，人物按人物卡标题逐字出现在章纲文本里；
 * ② **不编**：对不上就回空表并给一句说明，不拿别的章或语义近似的名字顶替；
 * ③ **不抛**：盘上缺文件、把目录当文稿、内容形状不认、本该是 markdown 却是坏 JSON，
 *    一律按「没读到」处理，由调用处显示诚实的空态。
 *
 * 数据来源都是既有通道：
 * - 章纲：`book.docs` 里 kind 为 `volume` / `outline` 的文稿，正文交给 contracts 的
 *   `parseVolumeOutline`（与卷纲→章纲面板同一份解析，不另写一份认章正则）；
 * - 人物：`book.docs` 里 kind 为 `character` 的条目，只取标题（不额外读卡正文）；
 * - 伏笔：`useBookStore.foreshadowRows`（既有台账通道）。
 */

export interface OutlineMatch {
  chapter: ParsedChapter;
  /** 章纲文稿自己的标题（不是章节标题），用来在界面上说清「取自哪一份」。 */
  sourceTitle: string;
  sourceRelPath: string;
}

export type OutlineLookup =
  { kind: "none" } | { kind: "ambiguous"; count: number } | { kind: "ok"; match: OutlineMatch };

export interface OutlineDoc {
  doc: DocRef;
  chapters: ParsedChapter[];
}

/** 第一遍只读这些：所有分卷 + 与本章同名的大纲。同名大纲通常就是「生成章纲」产出的那一份。 */
export function outlineCandidates(docs: readonly DocRef[], chapterTitle: string): DocRef[] {
  const title = chapterTitle.trim();
  if (title === "") return [];
  return docs.filter(
    (doc) => doc.kind === "volume" || (doc.kind === "outline" && doc.title.trim() === title)
  );
}

/** 第一遍没对上时才读其余大纲：它们的标题未必与章节同名，只能靠正文里的章标题认。 */
export function fallbackOutlineCandidates(docs: readonly DocRef[], chapterTitle: string): DocRef[] {
  const title = chapterTitle.trim();
  return docs.filter((doc) => doc.kind === "outline" && doc.title.trim() !== title);
}

/**
 * 把候选文稿读回来并解析成章表。
 *
 * 四种「没有数据」的情形都在这里收成空表，不抛：
 * - 缺文件 / 目录：`readDoc` reject，`allSettled` 只跳过那一条；
 * - 形状不认：回的不是 `{ content: string }`（或 content 不是字符串），跳过；
 * - 坏 JSON：这里只认 markdown 章纲，JSON 文本解析不出任何章，自然落空。
 * 其余文稿照旧读——一条坏不影响另一条。
 */
export async function readOutlineDocs(
  docs: readonly DocRef[],
  readDoc: (relPath: string) => Promise<unknown>
): Promise<OutlineDoc[]> {
  // `Promise.resolve().then(...)` 把 readDoc 的**同步抛**也翻成 rejection——
  // allSettled 只兜异步失败，裸调在 map 阶段就会把整批带崩。
  const loaded = await Promise.allSettled(
    docs.map((doc) => Promise.resolve().then(() => readDoc(doc.relPath)))
  );
  const out: OutlineDoc[] = [];
  docs.forEach((doc, index) => {
    const one = loaded[index];
    if (one?.status !== "fulfilled") return;
    const value = one.value;
    if (typeof value !== "object" || value === null) return;
    const content = (value as { content?: unknown }).content;
    if (typeof content !== "string") return;
    try {
      const parsed = parseVolumeOutline(content);
      if (parsed.chapters.length === 0) return;
      out.push({ doc, chapters: parsed.chapters });
    } catch {
      // 解析器面对完全认不出的内容时也不许把整条右栏带崩：这一篇按空表处理。
    }
  });
  return out;
}

/** 两章是不是同一份章纲：六字段与其余正文都逐字相同才算，避免把并行的两份抄本当冲突。 */
function sameChapter(a: ParsedChapter, b: ParsedChapter): boolean {
  if (a.body !== b.body) return false;
  return CHAPTER_OUTLINE_FIELDS.every((field) => a.fields[field] === b.fields[field]);
}

/**
 * 在所有读回来的章表里按标题**逐字**找本章。
 * 一处都对不上 → `none`；多处但内容一致 → 取第一处（常见于「生成章纲」与卷纲并存）；
 * 多处且内容不一致 → `ambiguous`，不替作者挑。
 */
export function matchOutlineChapter(
  sources: readonly OutlineDoc[],
  chapterTitle: string
): OutlineLookup {
  const title = chapterTitle.trim();
  if (title === "") return { kind: "none" };
  const matches: OutlineMatch[] = [];
  for (const source of sources) {
    for (const chapter of source.chapters) {
      if (chapter.title.trim() !== title) continue;
      matches.push({
        chapter,
        sourceTitle: source.doc.title,
        sourceRelPath: source.doc.relPath
      });
    }
  }
  if (matches.length === 0) return { kind: "none" };
  const first = matches[0]!;
  if (!matches.every((one) => sameChapter(one.chapter, first.chapter))) {
    return { kind: "ambiguous", count: matches.length };
  }
  return { kind: "ok", match: first };
}

/**
 * 找本章章纲：先读「所有分卷 + 同名大纲」这一小撮；没对上再退回读其余大纲。
 * 退回只在第一遍真的没有命中时发生——已经出现两种不同版本时不再扩大搜索，
 * 免得把一次本该交给作者裁决的冲突读成「找到了」。
 */
export async function lookupChapterOutline(
  docs: readonly DocRef[],
  chapterTitle: string,
  readDoc: (relPath: string) => Promise<unknown>
): Promise<OutlineLookup> {
  if (chapterTitle.trim() === "") return { kind: "none" };
  const primary = await readOutlineDocs(outlineCandidates(docs, chapterTitle), readDoc);
  const first = matchOutlineChapter(primary, chapterTitle);
  if (first.kind !== "none") return first;
  const rest = fallbackOutlineCandidates(docs, chapterTitle);
  if (rest.length === 0) return first;
  return matchOutlineChapter(await readOutlineDocs(rest, readDoc), chapterTitle);
}

/** 摘要在六项里的优先次序：先写正文最需要的目标/冲突/转折/钩子，其余两项兜底。 */
export const BRIEF_FIELD_ORDER: readonly ChapterOutlineField[] = [
  "goal",
  "conflict",
  "turn",
  "hook",
  "pov",
  "wordTarget"
];

/** 最多挑四项——「短摘要」是硬要求，右栏不复制整份章纲。 */
export const BRIEF_FIELD_LIMIT = 4;

/** 单项截断长度（码点）；超出的部分用省略号，原文仍留在章纲里。 */
export const BRIEF_FIELD_VALUE_LIMIT = 48;

export interface BriefField {
  field: ChapterOutlineField;
  label: string;
  value: string;
}

function clipText(value: string, limit: number): string {
  const chars = [...value];
  return chars.length > limit ? `${chars.slice(0, limit).join("")}…` : value;
}

/** 按优先次序挑最多四项非空字段，每项截短。六项全空时回空表，由调用处说明。 */
export function briefFields(chapter: ParsedChapter): BriefField[] {
  return BRIEF_FIELD_ORDER.map((field) => ({
    field,
    value: chapter.fields[field].trim()
  }))
    .filter((item) => item.value !== "")
    .slice(0, BRIEF_FIELD_LIMIT)
    .map((item) => ({
      field: item.field,
      label: CHAPTER_OUTLINE_LABELS[item.field],
      value: clipText(item.value, BRIEF_FIELD_VALUE_LIMIT)
    }));
}

/** 章纲里所有可能提到人名的文字：六字段值 + 无标签正文。 */
export function outlineText(chapter: ParsedChapter): string {
  return [...CHAPTER_OUTLINE_FIELDS.map((field) => chapter.fields[field]), chapter.body]
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join("\n");
}

/**
 * 出场人物：只认人物卡标题在章纲文本里**逐字出现**。
 * 不读卡正文、不收别名、不做语义近似——「像是同一个人」不是这里能下的结论。
 */
export function mentionedCharacters(cards: readonly DocRef[], text: string): string[] {
  const names: string[] = [];
  for (const card of cards) {
    const name = card.title.trim();
    if (name === "" || names.includes(name)) continue;
    if (text.includes(name)) names.push(name);
  }
  return names;
}

/** 右栏最多列这么多条待回收伏笔；其余只报数量，指向台账。 */
export const BRIEF_FORESHADOW_LIMIT = 5;

export interface ForeshadowBrief {
  rows: ForeshadowRow[];
  pendingTotal: number;
  /** 状态字段写坏的行：不能当「待回收」，但也不能装作没看见。 */
  brokenTotal: number;
  /** 原文读不到的行：状态未知。 */
  unknownTotal: number;
}

/**
 * 待回收伏笔：只取 tone=pending（已埋未收）。
 * 本章相关的排前面——`paidIn` 点名本章的（登记要在这儿收）先于 `plantedIn` 点名本章的，
 * 其余按路径稳定排序。这是**按台账里写死的路径**排序，不是按语义猜。
 */
export function briefForeshadows(
  rows: readonly ForeshadowRow[],
  activeRelPath: string
): ForeshadowBrief {
  const pending = rows.filter((row) => row.tone === "pending");
  const rankOf = (row: ForeshadowRow): number => {
    if (activeRelPath !== "" && row.paidIn === activeRelPath) return 0;
    if (activeRelPath !== "" && row.plantedIn === activeRelPath) return 1;
    return 2;
  };
  const sorted = [...pending].sort(
    (a, b) => rankOf(a) - rankOf(b) || a.relPath.localeCompare(b.relPath)
  );
  return {
    rows: sorted.slice(0, BRIEF_FORESHADOW_LIMIT),
    pendingTotal: pending.length,
    brokenTotal: rows.filter((row) => row.tone === "broken").length,
    unknownTotal: rows.filter((row) => row.tone === "unknown").length
  };
}

/**
 * 一条伏笔与本章的关系标签。只认台账里写下的路径，三个标签都不会凭标题猜。
 */
export function foreshadowTag(row: ForeshadowRow, activeRelPath: string): string {
  if (activeRelPath !== "" && row.paidIn === activeRelPath) return "本章登记回收";
  if (activeRelPath !== "" && row.plantedIn === activeRelPath) return "本章埋下";
  return "待回收";
}

export const NO_DOC_TEXT = "没打开文稿。打开一篇章节，这里显示它的章纲摘要、出场人物与待回收伏笔。";

export function notChapterText(title: string): string {
  return `当前打开的是《${title}》，不是章节正文；本章参考只对章节正文成立。`;
}

export function noOutlineText(title: string): string {
  return `没找到与《${title}》逐字同名的一章章纲；先在卷纲里写上这一章，或生成同名大纲后，这里才会有摘要。`;
}

export function ambiguousOutlineText(title: string, count: number): string {
  return `有 ${count} 处章纲都叫《${title}》且内容不一致，不替你挑；先去把它们对齐。`;
}

export const EMPTY_FIELDS_TEXT = "这一章章纲六项都还没写。";
export const NO_OUTLINE_FOR_CAST_TEXT = "章纲没对上，没法按章纲点名人物。";
export const NO_CHARACTER_CARDS_TEXT = "这本书还没有人物卡。";
export const NO_NAMED_CHARACTERS_TEXT = "本章章纲未点名人物";
export const NO_FORESHADOWS_TEXT = "伏笔台账里还没有登记过条目。";
export const NO_PENDING_FORESHADOWS_TEXT = "没有待回收的伏笔。";
export const FORESHADOW_LOADING_TEXT = "正在读伏笔台账…";
export const OUTLINE_LOADING_TEXT = "正在找本章章纲…";
