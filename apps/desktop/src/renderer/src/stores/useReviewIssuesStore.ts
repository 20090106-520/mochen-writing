/**
 * 交稿问题清单 store（W-04 第一刀，2026-11-12）。
 *
 * 五个审稿面板现在都是临时浮层，看完关掉就没了。这一枚只管**把结论按章留下来**：
 * 落在当前这本书的 `.mochen/data/review-issues.json`，通路复用 `useBookFileData`——
 * 按书隔离、换书前先落盘、读不懂时停止写入这三条，跟设定三本是同一族要求，不另造一份。
 *
 * 这份数据没有旧版全局 localStorage 版本，所以不传 `legacyStorageKey`：通路连查都不查。
 * 状态模型与复检合并的真身在 `utils/review-issues.ts`，这里只做「哪一章、什么时候记一次」。
 * 五套判据的结论都落在这里，判据本身一行都不在这一层（`collect` 复用交稿体检的汇总通道）。
 *
 * 【为什么体检是显式动作】若跟着输入实时跑，作者打到一半，清单会随每个字反复把条目
 * 标成已修又标回待修——那不是跟踪，是抖动。只在用户点「收齐本章检查」时并一次。
 *
 * 【状态只有一份】交稿体检里点「已修 / 忽略」也走这里的 `setStatusOfItem`：它原先只记在
 * 内存里，于是同一条目在体检页显示「已忽略」、在去 AI 味页仍是待修，还会被「交给 AI 改」
 * 原样喂回模型。现在读写都是这一份，标一次两边都认。
 */
import { defineStore } from "pinia";
import { ref } from "vue";
import { useBookFileData } from "../composables/useBookFileData";
import { useBookStore } from "./useBookStore";
import { useSubmissionChecklistStore } from "./useSubmissionChecklistStore";
import type { ChecklistItem, ChecklistStatus } from "../utils/submission-checklist";
import {
  CHECKLIST_TO_ISSUE,
  chapterIssuesOf,
  emptyReviewIssueBook,
  issuesFromChecklist,
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

  /**
   * 收齐本章**五套**检查的结论（W-04 第二刀）。
   *
   * 【不复制汇总流程】`useSubmissionChecklistStore.load` 已经把「拉三套台账 → 挡迟到回包 →
   * `buildSubmissionChecklist`」走了一遍；这里直接复用它的 `items`，不另写一份 load，
   * 也不另造任何判据。代价是它顺手刷新了体检 store 的即时清单——同一章、同一份数据，
   * 体检面板下次打开仍会自己重算，没有副作用。
   *
   * 【为什么要验归属】load 是异步的，期间可能换章 / 换书（体检面板自己也监听换章）。
   * 迟到回包若照写，就会把新章的条目记到旧章名下。ownerKey 是体检 store 现成的
   * 「书 + 章」标识，拿它比对即可，不必再引入第二枚令牌。
   */
  async function collect(relPath: string, draft: string): Promise<void> {
    if (relPath === "") return;
    const book = useBookStore();
    const checklist = useSubmissionChecklistStore();
    const owner = `${book.meta?.id ?? ""}\u0000${relPath}`;
    await checklist.load(relPath, draft);
    if (checklist.ownerKey !== owner) return;
    const merged = mergeChapterIssues(issuesFor(relPath), issuesFromChecklist(checklist.items));
    data.value = withChapterIssues(data.value, relPath, merged);
  }

  function setStatus(relPath: string, id: string, status: IssueStatus): void {
    if (relPath === "") return;
    data.value = withChapterIssues(data.value, relPath, markIssue(issuesFor(relPath), id, status));
  }

  /**
   * 交稿体检里直接标状态（W-04 收尾）。
   *
   * 【为什么不是 setStatus 就够】体检面板打开时清单可能还是空的（作者没点过
   * 「收齐本章检查」）。这时点「忽略」若只改一个找不到的 id，盘上什么都没留下，
   * 下次打开又回待修。所以缺条目时按当前这条结论补一条，再落状态。
   *
   * 【为什么不走 mergeChapterIssues】那一条会把「这次没扫到」的待修全判成已修——
   * 作者只标了一条，不该顺手替他把别的都算修完。这里只补当前这一条。
   */
  function setStatusOfItem(relPath: string, item: ChecklistItem, status: ChecklistStatus): void {
    if (relPath === "") return;
    // 一条 item 必定搬出一条 issue；不另写一份字段搬运，免得两边形状漂移。
    const fresh = issuesFromChecklist([item])[0]!;
    const current = issuesFor(relPath);
    // 已有这一条时按当前结论刷新显示字段（行号、标题可能早变了），但只碰它自己：
    // 别的条目留在原处，不替作者判「修完了」。状态随后由 markIssue 覆盖成刚点的那一格。
    const base = current.some((entry) => entry.id === fresh.id)
      ? current.map((entry) => (entry.id === fresh.id ? fresh : entry))
      : [...current, fresh];
    data.value = withChapterIssues(
      data.value,
      relPath,
      markIssue(base, fresh.id, CHECKLIST_TO_ISSUE[status])
    );
  }

  return { data, saveError, issuesFor, openCountFor, check, collect, setStatus, setStatusOfItem };
});
