/**
 * 写后自动体检的状态（2026-11-17）。
 *
 * 【为什么不塞进 useAgentStore】那个 store 已贴着 800 行预算，而且体检是**回执之后的旁路**：
 * 它只读这一轮写过的篇、只写自己这张表，不改对话转录与提案状态。判据在 utils/auto-checkup.ts，
 * 这里只负责「什么时候跑、跑完放哪、用户关掉之后还看不看」。
 *
 * 【为什么读不到就安静跳过】体检是尽力而为，与 `loadAllDocContents` 同一条口径：
 * 一篇读不到不影响其它篇的结论；全读不到就是空表（不弹任何东西）。
 */
import { defineStore } from "pinia";
import { autoCheckupOf, type AutoCheckupDoc, type AutoCheckupFinding } from "../utils/auto-checkup";
import { useBookStore } from "./useBookStore";

export const useAutoCheckupStore = defineStore("autoCheckup", {
  state: () => ({
    /** 键是 threadKey；空数组 = 这一轮体检过、没问题（不渲染，但与「没跑过」可区分）。 */
    findingsByThread: {} as Record<string, AutoCheckupFinding[]>,
    /** 用户点了「先不管」：这一轮不再显示。换轮由 clear 撤销。 */
    dismissedByThread: {} as Record<string, boolean>,
    runningByThread: {} as Record<string, boolean>,
    /** 跑着的时候又写成了新的篇：先记账，等这一轮跑完接着验，绝不静默丢掉。 */
    pendingByThread: {} as Record<string, string[]>
  }),
  getters: {
    /** 界面只问这一只：已关掉或还没结果都回空数组，模板只写一个 v-if。 */
    findingsOf(state) {
      return (threadKey: string): AutoCheckupFinding[] =>
        state.dismissedByThread[threadKey] === true
          ? []
          : (state.findingsByThread[threadKey] ?? []);
    }
  },
  actions: {
    /**
     * 体检查过的篇。relPaths 去重后逐篇读；读不到的跳过。
     *
     * 触发点是「每次 written」，一轮里可能连着写好几篇：正在跑时**不丢**新来的篇，
     * 而是记进 pending，等这一轮跑完接着验（否则第二篇永远等不到体检）。
     * 结果按 relPath 合并（同一篇重写就换新结论），排序与 autoCheckupOf 同口径。
     */
    async run(threadKey: string, relPaths: readonly string[]): Promise<void> {
      const paths = [...new Set(relPaths)];
      if (paths.length === 0) return;
      if (this.runningByThread[threadKey] === true) {
        const pending = this.pendingByThread[threadKey] ?? [];
        for (const relPath of paths) if (!pending.includes(relPath)) pending.push(relPath);
        this.pendingByThread[threadKey] = pending;
        return;
      }
      this.runningByThread[threadKey] = true;
      try {
        const docs = useBookStore().docs;
        const loaded = await Promise.allSettled(
          paths.map(async (relPath): Promise<AutoCheckupDoc> => {
            const known = docs.find((one) => one.relPath === relPath);
            const body = await window.mochen.readDoc(relPath);
            return { relPath, title: known?.title ?? relPath, content: body.content };
          })
        );
        const ok = loaded
          .filter(
            (one): one is PromiseFulfilledResult<AutoCheckupDoc> => one.status === "fulfilled"
          )
          .map((one) => one.value);
        const merged = new Map(
          (this.findingsByThread[threadKey] ?? []).map((one) => [one.docRelPath, one])
        );
        for (const one of autoCheckupOf(ok)) merged.set(one.docRelPath, one);
        this.findingsByThread[threadKey] = [...merged.values()].sort(
          (a, b) => b.total - a.total || a.docRelPath.localeCompare(b.docRelPath)
        );
      } finally {
        this.runningByThread[threadKey] = false;
        const pending = this.pendingByThread[threadKey];
        if (pending !== undefined && pending.length > 0) {
          delete this.pendingByThread[threadKey];
          void this.run(threadKey, pending);
        }
      }
    },

    /** 「先不管」：只关这一轮的卡片，不改任何正文。 */
    dismiss(threadKey: string): void {
      this.dismissedByThread[threadKey] = true;
    },

    /** 换轮清场：上一轮的体检结论不该挂在下一轮的对话流末尾。 */
    clear(threadKey: string): void {
      delete this.findingsByThread[threadKey];
      delete this.dismissedByThread[threadKey];
      delete this.pendingByThread[threadKey];
    }
  }
});
