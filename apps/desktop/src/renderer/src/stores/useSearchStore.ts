/**
 * SearchStore —— 全文搜索
 *
 * 跨章节/资料全文关键字搜索：
 * - 支持章节、大纲、角色、情节、世界观等全部 BookKind 文档
 * - 结果带文档类型、章节标题、匹配行上下文（前后各一行）
 * - 高亮匹配关键字
 * - 结果可点击跳转（浏览或打开章节）
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { fuzzyEligible, fuzzyFindInLine } from "@mochen/contracts";
import type { BookDoc } from "../types/book-doc";

export interface SearchHit {
  docRelPath: string;
  docTitle: string;
  docKind: string;
  lineNumber: number;
  matchStart: number;
  matchEnd: number;
  beforeContext: string;
  matchText: string;
  afterContext: string;
}

export interface SearchResult {
  query: string;
  hits: SearchHit[];
  totalHits: number;
  durationMs: number;
  searchedAt: number;
  /**
   * 命中口径（2026-10-10）：`exact` = 精确子串；`fuzzy` = 整书精确零命中后
   * 按「一字之差」兜底命中（判定真身在 @mochen/contracts/search-match）。
   * 面板要把这一轮如实标出来——容错结果是「相似」不是「相同」，不标就是骗人。
   */
  mode: "exact" | "fuzzy";
}

const MAX_HITS = 200;
const CONTEXT_RADIUS = 30;

export const useSearchStore = defineStore("search", () => {
  const query = ref("");
  const isSearching = ref(false);
  const lastResult = ref<SearchResult | null>(null);
  const searchHistory = ref<string[]>([]);

  const hasResult = computed(() => lastResult.value !== null && lastResult.value.hits.length > 0);
  const hitCount = computed(() => lastResult.value?.totalHits ?? 0);

  /**
   * 在单个文档内搜索，返回匹配结果
   */
  function searchInDoc(doc: BookDoc, queryLower: string): SearchHit[] {
    if (!queryLower || !doc.content) return [];
    const hits: SearchHit[] = [];
    const lines = doc.content.split("\n");

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const currentLine = lines[lineIdx]!;
      const lineLower = currentLine.toLocaleLowerCase();
      let searchFrom = 0;
      let foundAt = lineLower.indexOf(queryLower, searchFrom);

      while (foundAt !== -1 && hits.length < MAX_HITS) {
        const beforeStart = Math.max(0, foundAt - CONTEXT_RADIUS);
        const afterEnd = Math.min(currentLine.length, foundAt + queryLower.length + CONTEXT_RADIUS);

        hits.push({
          docRelPath: doc.relPath,
          docTitle: doc.title,
          docKind: doc.kind,
          lineNumber: lineIdx + 1,
          matchStart: foundAt,
          matchEnd: foundAt + queryLower.length,
          beforeContext: beforeStart > 0 ? "…" : "" + currentLine.slice(beforeStart, foundAt),
          matchText: currentLine.slice(foundAt, foundAt + queryLower.length),
          afterContext:
            currentLine.slice(foundAt + queryLower.length, afterEnd) +
            (afterEnd < currentLine.length ? "…" : "")
        });

        searchFrom = foundAt + 1;
        foundAt = lineLower.indexOf(queryLower, searchFrom);
        if (hits.length >= MAX_HITS) break;
      }
    }

    return hits;
  }

  /**
   * 执行搜索
   */
  function search(docs: BookDoc[], rawQuery: string): SearchResult {
    const trimmed = rawQuery.trim();
    query.value = trimmed;

    if (!trimmed) {
      lastResult.value = null;
      return {
        query: "",
        hits: [],
        totalHits: 0,
        durationMs: 0,
        searchedAt: Date.now(),
        mode: "exact"
      };
    }

    isSearching.value = true;
    const start = performance.now();
    const queryLower = trimmed.toLocaleLowerCase();

    const allHits: SearchHit[] = [];
    for (const doc of docs) {
      const docHits = searchInDoc(doc, queryLower);
      allHits.push(...docHits);
      if (allHits.length >= MAX_HITS) break;
    }

    // 一字之差兜底（2026-10-10）：整书精确零命中才跑（正常搜索零开销），
    // 判定真身在 contracts/search-match（与主进程 search_docs 吃同一份，不许抄第二份）。
    let mode: "exact" | "fuzzy" = "exact";
    if (allHits.length === 0 && fuzzyEligible(queryLower)) {
      mode = "fuzzy";
      for (const doc of docs) {
        const lines = doc.content.split("\n");
        for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
          const currentLine = lines[lineIdx]!;
          const found = fuzzyFindInLine(currentLine, queryLower);
          if (found === null || allHits.length >= MAX_HITS) continue;
          allHits.push({
            docRelPath: doc.relPath,
            docTitle: doc.title,
            docKind: doc.kind,
            lineNumber: lineIdx + 1,
            matchStart: found.start,
            matchEnd: found.end,
            beforeContext:
              found.start > 0
                ? "…" + currentLine.slice(Math.max(0, found.start - CONTEXT_RADIUS), found.start)
                : "",
            matchText: currentLine.slice(found.start, found.end),
            afterContext:
              currentLine.slice(found.end, found.end + CONTEXT_RADIUS) +
              (found.end + CONTEXT_RADIUS < currentLine.length ? "…" : "")
          });
        }
      }
    }

    const result: SearchResult = {
      query: trimmed,
      hits: allHits,
      totalHits: allHits.length,
      durationMs: Math.round(performance.now() - start),
      searchedAt: Date.now(),
      mode
    };

    lastResult.value = result;
    isSearching.value = false;

    // 搜索历史（去重，最多20条）
    const histIdx = searchHistory.value.indexOf(trimmed);
    if (histIdx !== -1) searchHistory.value.splice(histIdx, 1);
    searchHistory.value.unshift(trimmed);
    if (searchHistory.value.length > 20) searchHistory.value.pop();

    return result;
  }

  /** 清空搜索 */
  function clear(): void {
    query.value = "";
    lastResult.value = null;
    isSearching.value = false;
  }

  /** 清除搜索历史 */
  function clearHistory(): void {
    searchHistory.value = [];
  }

  return {
    query,
    isSearching,
    lastResult,
    searchHistory,
    hasResult,
    hitCount,
    searchInDoc,
    search,
    clear,
    clearHistory
  };
});
