/**
 * 存稿仪表的运行时状态（W-05）。
 *
 * 【只干一件事】把既有改稿历史（`changes:list`）读回来，供「最近一次改动」列使用。
 * 章节档位与汇总全部是**现算**的（`utils/chapter-inventory.ts`），不在任何地方落盘：
 * 换书、换软件之后从当前书的扫描结果与写作目标里重新读，不会留下上一本书的读数。
 *
 * 为什么不复用 `book.loadChanges()`：那是改稿历史面板的数据通道，会把结果写进
 * `book.changeList` 并占用它自己的 notice。这里单独读一份，既有面板的行为一点不动。
 *
 * 令牌的理由与 W-04 同款：面板重开 / 换书时，先发的回包可能后到；没有令牌就会把
 * 旧书的时间戳盖到新书的章节上——路径相同（`chapters/01-开局.md`）时尤其危险。
 */
import { defineStore } from "pinia";
import type { ChangeEntry } from "@mochen/contracts";
import { failureReasonOf } from "../utils/draft-flush";

export const useChapterInventoryStore = defineStore("chapterInventory", {
  state: () => ({
    changes: [] as ChangeEntry[],
    loading: false,
    notice: "",
    loadToken: 0
  }),
  actions: {
    async loadChanges(): Promise<void> {
      const token = ++this.loadToken;
      this.loading = true;
      // 先清空：读的过程中哪怕慢，也不许把上一本书/上一次的读数留在表里。
      this.changes = [];
      this.notice = "";
      try {
        const list = await window.mochen.listChanges();
        if (token !== this.loadToken) return;
        this.changes = list;
      } catch (error) {
        if (token !== this.loadToken) return;
        this.notice = `最近改动没读回来：${failureReasonOf(error)}`;
      } finally {
        if (token === this.loadToken) this.loading = false;
      }
    },
    /** 关面板 / 换书：作废在途回包并清空。 */
    reset(): void {
      this.loadToken += 1;
      this.changes = [];
      this.loading = false;
      this.notice = "";
    }
  }
});
