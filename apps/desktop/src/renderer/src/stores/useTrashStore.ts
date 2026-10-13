import { defineStore } from "pinia";
import type { TrashEntry } from "@mochen/contracts";
import { useBookStore } from "./useBookStore";

/**
 * 书稿回收站（2026-10-10）：删 = 移进 `<书>/.mochen/trash/`，还原 = 按小抄搬回。
 * 盘上的判定全在主进程 doc-trash.ts（只收在册文稿、realpath 闸、原位占位不盖写）；
 * 这里只管三件事：把结果递上去、把理由显示出来、刷新树。
 *
 * 树刷新走 book.refreshDocs()（温和重扫）：删除与还原都是低频动作，
 * 为它们给 useBookStore 加第二套单篇增删逻辑不值得——那边 800 行预算也装不下。
 */
export const useTrashStore = defineStore("trash", {
  state: () => ({
    /** 当前书的回收站条目（最近一次 list 的快照；对话框每次打开都会现取）。 */
    entries: [] as TrashEntry[],
    /** 最近一次操作的失败理由（人话，直接上屏）；null = 没有未读的失败。 */
    error: null as string | null,
    busy: false
  }),
  getters: {
    hasBook: () => useBookStore().hasBook
  },
  actions: {
    /** 列回收站。失败把理由放进 error（no-book 也是一句实话，不抛）。 */
    async list(): Promise<void> {
      const result = await window.mochen.listTrash();
      if (result.ok) {
        this.entries = result.entries;
        this.error = null;
      } else {
        this.entries = [];
        this.error = result.message;
      }
    },
    /**
     * 把一篇文稿移进回收站。成功后温和重扫（树里那一行会消失）；
     * 失败把理由放进 error 并返回 false，调用方不用自己组织文案。
     */
    async trashDoc(relPath: string): Promise<boolean> {
      this.busy = true;
      try {
        const result = await window.mochen.trashDoc(relPath);
        if (!result.ok) {
          this.error = result.message;
          return false;
        }
        await useBookStore().refreshDocs();
        this.error = null;
        return true;
      } finally {
        this.busy = false;
      }
    },
    /** 还原一条到原路径；原位被占时主进程回 target-exists，理由原样上屏。 */
    async restore(trashName: string): Promise<boolean> {
      this.busy = true;
      try {
        const result = await window.mochen.restoreTrash(trashName);
        if (!result.ok) {
          this.error = result.message;
          return false;
        }
        await useBookStore().refreshDocs();
        await this.list();
        this.error = null;
        return true;
      } finally {
        this.busy = false;
      }
    },
    clearError(): void {
      this.error = null;
    }
  }
});
