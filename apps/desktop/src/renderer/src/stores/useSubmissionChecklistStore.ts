import { defineStore } from "pinia";
import { keywordMisses } from "../utils/foreshadow";
import {
  buildSubmissionChecklist,
  statusKeyOf,
  type ChecklistItem,
  type ChecklistStatus
} from "../utils/submission-checklist";
import { useBookStore } from "./useBookStore";
import { useCastCheckStore } from "./useCastCheckStore";
import { useTimelineStore } from "./useTimelineStore";

/**
 * 「交稿体检」清单的会话态（2026-11-09 W-04）。
 *
 * 为什么**不写盘**：`待修 / 已修 / 忽略` 是作者这次交稿前的自检标记，不是书的数据；
 * 写进 `book.json` 会污染作品结构，写进 `.mochen/` 又要在换书/重开后解释同步问题。
 * 所以状态只活在内存里，按「书 id + 章路径 + 条目指纹」分开记：
 * - 换章：清单本身立刻清空并重算，旧章回包被 `loadToken` 挡掉；
 * - 换书：键里带书 id，旧书的标记不会串到新书；
 * - 重开软件：内存清空，全部回到「待修」。
 *
 * 清单内容本身不缓存，每次打开/换章都重新走既有检查通道：
 * 去 AI 味与审稿打分读当前 `draft`，人物核对与时间线读各自 store，伏笔读既有台账。
 */
export const useSubmissionChecklistStore = defineStore("submissionChecklist", {
  state: () => ({
    open: false,
    /** 当前清单归属（`书 id` + `章相对路径`），换章时用它判断要不要清空。 */
    ownerKey: "",
    items: [] as ChecklistItem[],
    /** 键 = `statusKeyOf(ownerKey, item.id)`；只在内存里。 */
    statuses: {} as Record<string, ChecklistStatus>,
    loading: false,
    notice: "",
    /** 未归属到本章、但本次确实查到的全书级读数，页脚据此说明去哪看。 */
    timelineOther: 0,
    castGap: 0,
    cardCount: 0,
    foreshadowTotal: 0,
    /** 竞态闸门：只有最后一次发起的 `load` 能把结果落地。 */
    loadToken: 0
  }),

  getters: {
    todoCount: (state) =>
      state.items.filter(
        (item) => (state.statuses[statusKeyOf(state.ownerKey, item.id)] ?? "todo") === "todo"
      ).length,
    fixedCount: (state) =>
      state.items.filter((item) => state.statuses[statusKeyOf(state.ownerKey, item.id)] === "fixed")
        .length,
    ignoredCount: (state) =>
      state.items.filter(
        (item) => state.statuses[statusKeyOf(state.ownerKey, item.id)] === "ignored"
      ).length
  },

  actions: {
    toggle(): void {
      this.open = !this.open;
      if (!this.open) this.loadToken += 1;
    },

    close(): void {
      this.open = false;
      this.loadToken += 1;
    },

    /** 换章 / 换书时先清空：旧清单和旧读数一条都不许留在新标题底下。 */
    clearFor(chapterRelPath: string): void {
      const book = useBookStore();
      const nextOwner = `${book.meta?.id ?? ""}\u0000${chapterRelPath}`;
      if (this.ownerKey === nextOwner) return;
      this.loadToken += 1;
      this.ownerKey = nextOwner;
      this.items = [];
      this.notice = "";
      this.loading = false;
      this.timelineOther = 0;
      this.castGap = 0;
      this.cardCount = 0;
      this.foreshadowTotal = 0;
    },

    statusOf(itemId: string): ChecklistStatus {
      return this.statuses[statusKeyOf(this.ownerKey, itemId)] ?? "todo";
    },

    setStatus(itemId: string, status: ChecklistStatus): void {
      this.statuses[statusKeyOf(this.ownerKey, itemId)] = status;
    },

    /**
     * 重新汇总一章。开始就把旧清单清空；三个台账走既有 load 通道，读失败由各 store
     * 自己记 `notice`。任何一次换章都会让本轮的 `loadToken` 失效，迟到的回包不会落地。
     */
    async load(chapterRelPath: string, draft: string): Promise<void> {
      const book = useBookStore();
      const ownerKey = `${book.meta?.id ?? ""}\u0000${chapterRelPath}`;
      const token = ++this.loadToken;
      this.ownerKey = ownerKey;
      this.items = [];
      this.notice = "";
      this.timelineOther = 0;
      this.castGap = 0;
      this.cardCount = 0;
      this.foreshadowTotal = 0;
      if (chapterRelPath === "") {
        this.loading = false;
        return;
      }
      this.loading = true;
      const timeline = useTimelineStore();
      const cast = useCastCheckStore();
      try {
        // 三个台账各自容错；这里用 allSettled 只为「一套读挂了不拖住另外两套」。
        await Promise.allSettled([book.loadForeshadows(), timeline.load(), cast.load()]);
        if (token !== this.loadToken) return;
        if (book.foreshadowRows.length > 0) await book.loadForeshadowChapters();
        if (token !== this.loadToken) return;
        const text = chapterRelPath === book.activeDocTab ? book.draft : draft;
        this.items = buildSubmissionChecklist({
          chapterRelPath,
          draft: text,
          castFindings: cast.findings,
          foreshadowRows: book.foreshadowRows,
          keywordMisses: keywordMisses(book.foreshadowRows, book.foreshadowChapterTexts),
          timelineIssues: timeline.issues
        });
        const attributedTimeline = this.items.filter((item) => item.source === "timeline").length;
        this.timelineOther = Math.max(0, timeline.issues.length - attributedTimeline);
        this.castGap = cast.findings.filter(
          (finding) => finding.level === "gap" && finding.chapter === ""
        ).length;
        this.cardCount = cast.cardCount;
        this.foreshadowTotal = book.foreshadowRows.length;
        const complaints: string[] = [];
        if (cast.notice !== "") complaints.push(cast.notice);
        if (timeline.notice !== "") complaints.push(timeline.notice);
        if (book.foreshadowRows.length === 0 && book.notice.includes("伏笔台账")) {
          complaints.push(book.notice);
        }
        this.notice = complaints.join(" ");
      } catch (err) {
        if (token === this.loadToken) {
          this.notice = `体检没汇总完：${err instanceof Error ? err.message : String(err)}`;
        }
      } finally {
        if (token === this.loadToken) this.loading = false;
      }
    }
  }
});
