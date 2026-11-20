/**
 * `search_docs` 的检索真身（2026-11-20 从 doc-tools-host.ts 迁出）。
 *
 * 【为什么迁出】宿主文件已经贴着 800 行预算；检索这一块还要补「故事圣经」与
 * 「章末摘要」两类来源，继续堆在宿主里必超。迁出的是纯收集 + 纯排版，
 * 不碰道具树、不碰提案、不共享状态，所以不会多出第二份判据（铁律 6）。
 *
 * 【为什么要搜设定库与前情】正文、设定、前情是模型理解「现在」的三份材料：
 * 设定库条目不在文稿树里（`search_docs` 过去搜不到），而前情摘要正是上一章的事实压缩。
 * 让模型一次拿到三份命中，比让它 `read_doc` 整章翻找省一整轮往返。
 */
import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  BOOK_KINDS,
  fuzzyEligible,
  fuzzyFindInLine,
  type BibleEntry,
  type DocRef
} from "@mochen/contracts";
import type { ToolOutcome } from "@mochen/agent-runtime";

/* 上限 50 而不是无限：回执直接进模型上下文，整本倾倒会把这轮的对话预算吃光。 */
const SEARCH_LIMIT_DEFAULT = 20;
const SEARCH_LIMIT_MAX = 50;

/** 检索来源：正文（文稿树）/ 设定库 / 前情摘要；缺省全搜。 */
export type SearchSource = "docs" | "bible" | "recaps" | "all";

export interface SearchSources {
  docs(): readonly DocRef[];
  root(): string | null;
  bible(): Promise<readonly BibleEntry[]>;
  recaps(): Readonly<Record<string, string>>;
}

interface SearchHit {
  ref: DocRef;
  /** 1 起的行号。 */
  line: number;
  /** 命中行原文（已 trim）。 */
  text: string;
}

/** 设定库 / 前情的命中：它们没有「文稿路径」，用 label 标明出处。 */
interface ExtraHit {
  label: string;
  text: string;
}

/** 每条命中行最多带多少字：设定正文可能很长，回执只给能认出「就是这条」的一段。 */
const EXTRA_HIT_MAX_CHARS = 160;

const BIBLE_TYPE_LABEL: Record<BibleEntry["type"], string> = {
  character: "人物",
  location: "地点",
  timeline: "时间线"
};

/** 模型可能给数字也可能给字符串；缺省/非法一律回默认，超上限截到上限。 */
function searchLimitOf(raw: unknown): number {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return SEARCH_LIMIT_DEFAULT;
  return Math.min(SEARCH_LIMIT_MAX, Math.max(1, Math.floor(value)));
}

function sourceOf(raw: unknown): SearchSource | null {
  const value = typeof raw === "string" ? raw : "";
  if (value === "" || value === "all") return "all";
  if (value === "docs" || value === "bible" || value === "recaps") return value;
  return null;
}

function clip(text: string): string {
  const chars = Array.from(text.trim());
  return chars.length <= EXTRA_HIT_MAX_CHARS
    ? chars.join("")
    : `${chars.slice(0, EXTRA_HIT_MAX_CHARS).join("")}…`;
}

/** 正文回执（逐行 / 按篇两档）。判据与排版只在这里，宿主不另拼一份。 */
function docsReceipt(input: {
  hits: SearchHit[];
  group: "line" | "doc";
  limit: number;
  scope: string;
  lead: string;
  fuzzy: boolean;
}): string {
  const { hits, group, limit, scope, lead, fuzzy } = input;
  const scopeNote = scope === "" ? "" : `（只搜了 ${scope} 类文稿）`;
  const fuzzyNote = fuzzy ? "（命中的字可能与查询不完全相同，引用前先核对）" : "";
  if (group === "doc") {
    const byDoc = new Map<string, SearchHit[]>();
    for (const hit of hits) {
      const bucket = byDoc.get(hit.ref.relPath);
      if (bucket === undefined) byDoc.set(hit.ref.relPath, [hit]);
      else bucket.push(hit);
    }
    const docs = [...byDoc.values()];
    const shown = docs.slice(0, limit);
    const rows = shown.map((bucket) => {
      const first = bucket[0]!;
      return `- ${first.ref.relPath} · ${first.ref.title}（命中 ${bucket.length} 处，首处第 ${first.line} 行：${first.text}）`;
    });
    const tail = docs.length > shown.length ? `，只列前 ${shown.length} 篇` : "";
    return `${lead} ${hits.length} 处，分布在 ${docs.length} 篇${scopeNote}${tail}${fuzzyNote}：\n${rows.join("\n")}`;
  }
  const shown = hits.slice(0, limit);
  const rows = shown.map((hit) => `${hit.ref.relPath}:${hit.line}: ${hit.text}`);
  const tail = hits.length > shown.length ? `，只列前 ${shown.length} 条` : "";
  return `${lead} ${hits.length} 处${scopeNote}${tail}${fuzzyNote}：\n${rows.join("\n")}`;
}

function bibleHits(entries: readonly BibleEntry[], query: string): ExtraHit[] {
  const hits: ExtraHit[] = [];
  for (const entry of entries) {
    const fields = [
      entry.title,
      entry.id,
      entry.role ?? "",
      ...(entry.aliases ?? []),
      entry.content
    ];
    if (!fields.some((field) => field.includes(query))) continue;
    const bodyLine =
      entry.content.split("\n").find((line) => line.includes(query)) ?? entry.content;
    const text = bodyLine.includes(query) ? bodyLine : `${entry.title}：${bodyLine}`;
    hits.push({
      label: `设定·${BIBLE_TYPE_LABEL[entry.type]}·${entry.title}（bible:${entry.type}:${entry.id}）`,
      text: clip(text)
    });
  }
  return hits;
}

function recapHits(recaps: Readonly<Record<string, string>>, query: string): ExtraHit[] {
  const hits: ExtraHit[] = [];
  for (const [relPath, body] of Object.entries(recaps)) {
    for (const line of body.split("\n")) {
      if (!line.includes(query)) continue;
      hits.push({ label: `前情·${relPath}`, text: clip(line) });
    }
  }
  return hits;
}

/**
 * 一次调用把三份来源搜齐。空 query / 认不出的 source 一律拒绝（不静默退回全书），
 * 精确零命中才跑容错轮，且容错只作用于正文——设定库与前情是作者写的原文，
 * 拿模糊命中去改设定稿风险更高。
 */
export async function runSearchDocs(
  sources: SearchSources,
  args: Record<string, unknown>
): Promise<ToolOutcome> {
  const deny = (text: string): ToolOutcome => ({ ok: false, text, proposals: [] });
  const query = typeof args.query === "string" ? args.query : "";
  if (query === "") return deny("search_docs 需要非空的 query。");

  const source = sourceOf(args.source);
  if (source === null) return deny("source 只认 docs、bible、recaps 或 all；不传则全搜。");
  const wantDocs = source === "all" || source === "docs";
  const wantBible = source === "all" || source === "bible";
  const wantRecaps = source === "all" || source === "recaps";

  // kind 只限定正文：设定库 / 前情没有「文稿类型」这一维，认不出的 kind 仍拒绝。
  const kind = typeof args.kind === "string" ? args.kind : "";
  if (kind !== "" && !(BOOK_KINDS as readonly string[]).includes(kind))
    return deny(`不认识的文稿类型「${kind}」。可用的是 ${BOOK_KINDS.join("、")}；不传则搜全书。`);
  const kindNote =
    kind !== "" && !wantDocs ? `（kind 只作用于正文，这次没有按它过滤设定库/前情）` : "";

  const group = args.group === "doc" ? "doc" : "line";
  const limit = searchLimitOf(args.limit);
  const root = sources.root();
  if (wantDocs && root === null) return deny("尚未打开作品目录。");

  const refs = sources.docs().filter((ref) => kind === "" || ref.kind === kind);
  const collectDocs = async (match: (line: string) => boolean): Promise<SearchHit[]> => {
    const hits: SearchHit[] = [];
    for (const ref of refs) {
      const body = await readFile(path.join(root!, ...ref.relPath.split("/")), "utf8").catch(
        () => null
      );
      if (body === null) continue;
      for (const [index, line] of body.split("\n").entries()) {
        if (!match(line)) continue;
        hits.push({ ref, line: index + 1, text: line.trim() });
      }
    }
    return hits;
  };

  let docsHits: SearchHit[] = wantDocs ? await collectDocs((line) => line.includes(query)) : [];
  let fuzzy = false;
  if (docsHits.length === 0 && wantDocs && fuzzyEligible(query)) {
    const fuzzyHits = await collectDocs((line) => fuzzyFindInLine(line, query) !== null);
    if (fuzzyHits.length > 0) {
      docsHits = fuzzyHits;
      fuzzy = true;
    }
  }
  const bible = wantBible ? bibleHits(await sources.bible(), query) : [];
  const recaps = wantRecaps ? recapHits(sources.recaps(), query) : [];

  const total = docsHits.length + bible.length + recaps.length;
  if (total === 0) return { ok: true, text: `没有命中「${query}」。`, proposals: [] };

  // 只有正文命中时保持原回执逐字不变：既有调用方与用例按这版口径钉过。
  if (bible.length === 0 && recaps.length === 0) {
    return {
      ok: true,
      text: docsReceipt({
        hits: docsHits,
        group,
        limit,
        scope: kind,
        lead: fuzzy ? `精确搜索没有命中「${query}」，按一字之差容错命中` : "命中",
        fuzzy
      }),
      proposals: []
    };
  }

  const sections: string[] = [];
  if (docsHits.length > 0) {
    sections.push(
      `【正文】\n${docsReceipt({
        hits: docsHits,
        group,
        limit,
        scope: kind,
        lead: fuzzy ? "按一字之差容错命中" : "命中",
        fuzzy
      })}`
    );
  }
  if (bible.length > 0) {
    sections.push(
      `【设定库】\n${bible
        .slice(0, limit)
        .map((hit) => `- ${hit.label}：${hit.text}`)
        .join("\n")}\n（设定库条目不是文稿，要修改请到设定面板，不要用 read_doc。）`
    );
  }
  if (recaps.length > 0) {
    sections.push(
      `【前情摘要】\n${recaps
        .slice(0, limit)
        .map((hit) => `- ${hit.label}：${hit.text}`)
        .join("\n")}`
    );
  }
  const count =
    `命中「${query}」共 ${total} 处` +
    `（正文 ${docsHits.length} / 设定库 ${bible.length} / 前情 ${recaps.length}）${kindNote}`;
  return { ok: true, text: `${count}：\n${sections.join("\n")}`, proposals: [] };
}
