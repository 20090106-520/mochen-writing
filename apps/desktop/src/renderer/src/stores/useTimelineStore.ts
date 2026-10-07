/**
 * 时间线一致性检查（2026-10-05，批次 5-①）的读盘与状态。
 *
 * **为什么不并进 useBookStore**：那份已经 750 行（预算 800），而本功能要读盘、组行、判一致性。
 * 塞进去必然超预算，超了就只剩「加注释解释为什么这么长」这条路。
 * 另立一个 store 更要紧的原因是**职责不同**：useBookStore 是「当前打开的那一篇」，
 * 这里是「整本书的时间线」——它扫的是全部 timeline 文稿，不随当前标签变。
 *
 * 判定与日期算术在 `contracts/timeline-check`（那里有 34 条真单测），这里只存结果与在途标记。
 */
import { defineStore } from "pinia";
import {
  checkTimeline,
  parseTimelineMeta,
  timelineVerdict,
  type TimelineIssue
} from "@mochen/contracts";
import { useBookStore } from "./useBookStore";

export interface TimelineRow {
  relPath: string;
  title: string;
  /** 故事内日期（ISO）；没写或写坏了是 null。 */
  date: string | null;
  /** 日期字段的问题说明；正常时是空串。 */
  dateProblem: string;
  /** 一句话说清这篇讲的是什么（取正文首句，截断过）。 */
  gist: string;
}

export const useTimelineStore = defineStore("timeline", {
  state: () => ({
    /** 浮层是否开着。挂在左栏「时间线」那一项上。 */
    open: false,
    /** 读回来的整本时间线（按日期升序；没有日期的排在最后）。 */
    rows: [] as TimelineRow[],
    /** 判定出来的问题（已算好，不在组件里判）。 */
    issues: [] as TimelineIssue[],
    /** 在途标记：按钮据此禁用，重复点不会发两次 IPC。 */
    busy: false,
    /** 读盘失败时给用户看的中文原因；空串 = 没失败。 */
    notice: "" as string
  }),

  getters: {
    /** 头部那句话：零矛盾也要说话，不许一片空白让人猜是不是没跑。 */
    verdict(state): string {
      return timelineVerdict(state.issues);
    },
    /** 查不出问题但压根没有日期的条目时，提醒一句（不是错，是「还没排期」）。 */
    undatedCount(state): number {
      return state.rows.filter((r) => r.date === null).length;
    }
  },

  actions: {
    /**
     * 读一遍全书的 `timeline/` 文稿并查一致性。
     *
     * **读不到的照样列出来**（dateProblem 写明读不到）——与伏笔台账同一条纪律：
     * 凭空从台账上消失的那一条时间线，恰恰是最需要被看见的那一条。
     * 一篇失败不拖垮整表（`allSettled`）。
     */
    async load(): Promise<void> {
      const book = useBookStore();
      const targets = book.docs.filter((d) => d.kind === "timeline");
      if (targets.length === 0) {
        this.rows = [];
        this.issues = [];
        this.notice = "";
        return;
      }
      this.busy = true;
      this.notice = "";
      try {
        const loaded = await Promise.allSettled(
          targets.map((d) => window.mochen.readDoc(d.relPath))
        );
        const rows: TimelineRow[] = [];
        const entries = targets.map((doc, i) => {
          const one = loaded[i];
          if (one?.status !== "fulfilled") {
            rows.push({
              relPath: doc.relPath,
              title: doc.title,
              date: null,
              dateProblem: "这一篇读不出来，没法排进时间线",
              gist: ""
            });
            return {
              relPath: doc.relPath,
              title: doc.title,
              date: null,
              dateProblem: "读不到",
              text: ""
            };
          }
          const content = one.value.content;
          const meta = parseTimelineMeta(content);
          const row: TimelineRow = {
            relPath: doc.relPath,
            title: doc.title,
            date: meta.date,
            dateProblem: meta.dateProblem,
            gist: gistOf(content)
          };
          rows.push(row);
          return {
            relPath: doc.relPath,
            title: doc.title,
            date: meta.date,
            dateProblem: meta.dateProblem,
            text: content
          };
        });
        this.rows = sortRows(rows);
        this.issues = checkTimeline(entries);
      } catch (err) {
        this.notice = `时间线没读回来：${err instanceof Error && err.message !== "" ? err.message : String(err)}`;
        this.rows = [];
        this.issues = [];
      } finally {
        this.busy = false;
      }
    },

    /** 点浮层右上那颗：开/关都在这一格里，左栏与浮层共用（不许组件各持一个本地布尔）。 */
    async toggle(): Promise<void> {
      this.open = !this.open;
      if (this.open) await this.load();
    },

    close(): void {
      this.open = false;
    }
  }
});

/** 取正文第一句当摘要；没有正文就空串（不编一句"暂无"糊上去）。 */
function gistOf(content: string): string {
  const body = content
    .replace(/^---[\s\S]*?---\n/, "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l !== "" && !l.startsWith("#"));
  if (body === undefined) return "";
  return body.length > 40 ? `${body.slice(0, 40)}…` : body;
}

/** 按日期升序；没有日期的排在最后（而不是混在中间打乱顺序）。 */
function sortRows(rows: TimelineRow[]): TimelineRow[] {
  return [...rows].sort((a, b) => {
    if (a.date === null && b.date === null) return a.title.localeCompare(b.title);
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return a.date.localeCompare(b.date);
  });
}
