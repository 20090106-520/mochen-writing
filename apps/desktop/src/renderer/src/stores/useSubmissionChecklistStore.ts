import { defineStore } from "pinia";
import { keywordMisses } from "../utils/foreshadow";
import { buildSubmissionChecklist, type ChecklistItem } from "../utils/submission-checklist";
import { useBookStore } from "./useBookStore";
import { useCastCheckStore } from "./useCastCheckStore";
import { useTimelineStore } from "./useTimelineStore";

/**
 * 「交稿体检」的即时结论（2026-11-09 W-04；2026-11-12 收尾后只管结论）。
 *
 * 这一枚只回答「这一章这一秒查到了什么」：把五套既有检查汇成一张清单，**不记状态**。
 * 待修 / 已修 / 忽略是作者要跨章、跨次留着的决定，真源是 `useReviewIssuesStore` 落盘的
 * `review-issues.json`。原先这里也存一份内存状态表，于是同一条目在体检页显示「已忽略」、
 * 在去 AI 味页仍是待修，还会被「交给 AI 改」原样喂回模型。两套合成一套后，
 * 这里连 `statuses` 都不留——没有第二份可读，就不会有第二份不同步。
 *
 * 清单内容本身不缓存，每次打开 / 换章都重新走既有检查通道：
 * 去 AI 味与审稿打分读当前 `draft`，人物核对与时间线读各自 store，伏笔读既有台账。
 * - 换章：清单立刻清空重算，旧章回包被 `loadToken` 挡掉；
 * - 换书：`ownerKey` 带书 id，`collect` 拿它验归属，旧书结论不会串到新书；
 * - 重开软件：结论重算，状态由落盘清单读回，这里不需要缓存任何东西。
 */
export const useSubmissionChecklistStore = defineStore("submissionChecklist", {
  state: () => ({
    open: false,
    /** 当前清单归属（`书 id` + `章相对路径`），换章时用它判断要不要清空。 */
    ownerKey: "",
    items: [] as ChecklistItem[],
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
