import { defineStore } from "pinia";
import type { BibleBriefRow } from "../utils/bible-brief";

/**
 * 「本轮不带」的设定（2026-11-20 W-01 补完）。
 *
 * 作者在输入区芯片里点掉一条设定，只影响**下一轮装配**：不改设定本身、不写盘、
 * 重启回到全带。它也不是「停用」——故事圣经面板里那条照旧在，只是这一轮别带。
 *
 * 为什么按书 id 分开存：设定 id 各书独立，切书后旧书的排除表不许跟着新书出现。
 * 为什么连标题一起存快照：主进程按「已移除」装配后就不再返回这一条，
 * 恢复列表没有第二个名字来源，只能靠点掉时留下的这一份。
 */
export const useBibleExclusionStore = defineStore("bible-exclusion", {
  state: () => ({
    /** 书 id → 点掉顺序（同一 key 只出现一次）。 */
    byBook: {} as Record<string, BibleBriefRow[]>
  }),

  actions: {
    /** 这本书本轮被移除的设定；没有书 id 就没得谈，回空表。 */
    rowsOf(bookId: string): BibleBriefRow[] {
      return this.byBook[bookId] ?? [];
    },

    /** 出网用的键表：startTurn 与占用条两处同源，只取 key（标题只在本地列出）。 */
    keysOf(bookId: string): string[] {
      return this.rowsOf(bookId).map((row) => row.key);
    },

    /** 「本轮不带」：同一 key 只记一次；连标题快照一起存，主进程不再返回它也能列出来恢复。 */
    exclude(bookId: string, row: BibleBriefRow): void {
      if (bookId === "") return;
      const current = this.rowsOf(bookId);
      if (current.some((item) => item.key === row.key)) return;
      this.byBook[bookId] = [...current, { ...row }];
    },

    include(bookId: string, key: string): void {
      const current = this.rowsOf(bookId);
      if (!current.some((item) => item.key === key)) return;
      this.byBook[bookId] = current.filter((item) => item.key !== key);
    },

    /** 「全部恢复」：整本清掉，比逐个 include 少一轮渲染。 */
    clear(bookId: string): void {
      delete this.byBook[bookId];
    }
  }
});
