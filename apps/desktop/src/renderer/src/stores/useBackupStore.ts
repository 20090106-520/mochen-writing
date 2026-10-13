import { defineStore } from "pinia";
import type { BookBackupEntry } from "@mochen/contracts";
import { useBookStore } from "./useBookStore";

/**
 * 整书备份（2026-10-10）：复制不打包——`.mochen/` 之外的整本书抄进
 * `<书>/.mochen/backups/book-<时间戳>/`。盘上的判定（daily 去重、保留上限、
 * 恢复落点与盖写防线）全在主进程 book-backup.ts；这里只管把结果递上去、
 * 把理由显示出来。
 */
export const useBackupStore = defineStore("backup", {
  state: () => ({
    /** 当前书的备份清单（最近一次 list 的快照；对话框每次打开都会现取）。 */
    entries: [] as BookBackupEntry[],
    /** 最近一次操作的失败理由（人话，直接上屏）；null = 没有未读的失败。 */
    error: null as string | null,
    /** 最近一次成功动作的人话回执（「已备份 N 个文件 / 已恢复到 xx」）；null = 没有新的。 */
    receipt: null as string | null,
    busy: false
  }),
  getters: {
    hasBook: () => useBookStore().hasBook
  },
  actions: {
    async list(): Promise<void> {
      const result = await window.mochen.listBookBackups();
      if (result.ok) {
        this.entries = result.entries;
        this.error = null;
      } else {
        this.entries = [];
        this.error = result.message;
      }
    },
    /**
     * 备一份。`daily` 档今天已备过时主进程回 `name: null`——那是正常结果，
     * 静默收下（开书时的自动档，一天一份的上限靠它）；manual 档必有名字。
     */
    async create(mode: "manual" | "daily"): Promise<boolean> {
      this.busy = true;
      try {
        const result = await window.mochen.createBookBackup(mode);
        if (!result.ok) {
          this.error = result.message;
          return false;
        }
        this.receipt =
          result.name === null ? null : `已备份 ${result.fileCount} 个文件到 ${result.name}`;
        this.error = null;
        if (result.name !== null) await this.list();
        return true;
      } finally {
        this.busy = false;
      }
    },
    /** 每日自动档：开书那刻调一次，失败完全静默（自动的事不打扰写作）。 */
    async ensureDaily(): Promise<void> {
      await this.create("daily").catch(() => undefined);
    },
    /** 恢复一份到书旁新目录（主进程保证不盖写）；成功后回执里带上落点目录名。 */
    async restore(name: string): Promise<boolean> {
      this.busy = true;
      try {
        const result = await window.mochen.restoreBookBackup(name);
        if (!result.ok) {
          this.error = result.message;
          return false;
        }
        this.receipt = `已恢复到书旁的「${result.destName}」目录——当前这本书没有动。`;
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
