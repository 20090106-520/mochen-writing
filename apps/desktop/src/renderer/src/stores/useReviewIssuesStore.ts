/**
 * 交稿问题清单 store（W-04 第一刀，2026-11-12）。
 *
 * 五个审稿面板现在都是临时浮层，看完关掉就没了。这一枚只管**把结论按章留下来**：
 * 落在当前这本书的 `.mochen/data/review-issues.json`，通路复用 `useBookFileData`——
 * 按书隔离、换书前先落盘、读不懂时停止写入这三条，跟设定三本是同一族要求，不另造一份。
 *
 * 这份数据没有旧版全局 localStorage 版本，所以不传 `legacyStorageKey`：通路连查都不查。
 * 状态模型与复检合并的真身在 `utils/review-issues.ts`，这里只做「哪一章、什么时候记一次」。
 *
 * 【为什么体检是显式动作】若跟着输入实时跑，作者打到一半，清单会随每个字反复把条目
 * 标成已修又标回待修——那不是跟踪，是抖动。只在用户点「记进本章清单」时并一次。
 */
import { defineStore } from "pinia";
import { ref } from "vue";
import { useBookFileData } from "../composables/useBookFileData";
import {
  chapterIssuesOf,
  emptyReviewIssueBook,
  issuesFromSlop,
  markIssue,
  mergeChapterIssues,
  normalizeReviewIssueBook,
  openCount,
  withChapterIssues,
  type IssueStatus,
  type ReviewIssue,
  type ReviewIssueBook,
  type SlopLike
} from "../utils/review-issues";

export const useReviewIssuesStore = defineStore("reviewIssues", () => {
  const data = ref<ReviewIssueBook>(emptyReviewIssueBook());
  const { saveError } = useBookFileData<ReviewIssueBook>({
    key: "review-issues",
    data,
    empty: emptyReviewIssueBook,
    normalize: normalizeReviewIssueBook,
    isEmpty: (value) => Object.keys(value.chapters).length === 0
  });

  function issuesFor(relPath: string): ReviewIssue[] {
    return chapterIssuesOf(data.value, relPath);
  }

  function openCountFor(relPath: string): number {
    return openCount(issuesFor(relPath));
  }

  /** 记一次体检：本轮扫描并进上一轮的结论，改掉的自动落已修、忽略的保持忽略。 */
  function check(relPath: string, hits: readonly SlopLike[]): void {
    if (relPath === "") return;
    const merged = mergeChapterIssues(issuesFor(relPath), issuesFromSlop(hits));
    data.value = withChapterIssues(data.value, relPath, merged);
  }

  function setStatus(relPath: string, id: string, status: IssueStatus): void {
    if (relPath === "") return;
    data.value = withChapterIssues(data.value, relPath, markIssue(issuesFor(relPath), id, status));
  }

  return { data, saveError, issuesFor, openCountFor, check, setStatus };
});
