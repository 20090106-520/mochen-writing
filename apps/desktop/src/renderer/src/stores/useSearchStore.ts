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
      return { query: "", hits: [], totalHits: 0, durationMs: 0, searchedAt: Date.now() };
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

    const result: SearchResult = {
      query: trimmed,
      hits: allHits,
      totalHits: allHits.length,
      durationMs: Math.round(performance.now() - start),
      searchedAt: Date.now()
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
