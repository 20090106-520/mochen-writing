import { defineStore } from "pinia";
import { toRaw } from "vue";
import {
  DEFAULT_CHANGE_RETENTION,
  changePruneReportLine,
  type ChangePruneReport,
  type ChangeRetention
} from "@mochen/contracts";

/**
 * 改稿历史保留上限的渲染层真身（2026-10-06 批次 5-⑧）。
 *
 * 与 `useAppearanceStore` 同一套形状与同一套纪律：
 * ① 读失败退回默认档继续跑，但 `error` 要说清「这是默认、不是你设的」；
 * ② 存**失败时不动 state**（界面弹回原样），不假装存上了；
 * ③ 跨 IPC 递的值一律 `toRaw`——浅展开解不开嵌套的 Vue 代理，
 *    Electron 会在 send 端抛 `An object could not be cloned.`（见 useAppearanceStore 里那段）。
 *
 * **为什么这份不跟外观一样住「应用启动读一次」**：保留上限还影响「立即清理」，
 * 而清理要当前打开的书——书换了就可能要重新读。面板自己 `ensureLoaded` 一次就够了。
 */
export const useChangeRetentionStore = defineStore("change-retention", {
  state: () => ({
    retention: { ...DEFAULT_CHANGE_RETENTION } as ChangeRetention,
    /** 盘上确实有一份用户自己设的（不是默认档、也不是夹过的坏值）。 */
    persisted: false,
    loaded: false,
    saving: false,
    pruning: false,
    error: null as string | null,
    /** 清理完之后那句话；null = 这一轮还没清过。 */
    pruneLine: null as string | null
  }),
  actions: {
    /** 幂等：面板每次打开都调，重复读不会把用户刚存的值冲掉（loaded 之后直接返回）。 */
    async ensureLoaded(): Promise<void> {
      if (this.loaded) return;
      await this.load();
    },

    async load(): Promise<void> {
      try {
        const snapshot = await window.mochen.changesRetentionGet();
        this.retention = snapshot.retention;
        this.persisted = snapshot.persisted;
        this.loaded = true;
        this.error = null;
      } catch (error) {
        // 读不回来就跑默认档（主进程那边也是这个策略），但界面必须说清「这是默认档」。
        this.retention = { ...DEFAULT_CHANGE_RETENTION };
        this.persisted = false;
        this.error = "改稿历史上限没有读到，现在用的是默认档。";
        console.error("changes:retention-get 失败", error);
      }
    },

    /**
     * 改一处上限。成功才落本地 state；失败时 state 不动，界面自己弹回原样。
     *
     * 回的是**主进程夹完之后的那一份**（`save` 已在落盘前 sanitize 过）：界面显示的
     * 必须是盘上真实存着的那份，而不是调用方递进来的那份——两者不一致时，
     * 界面上那个高亮档位就是在说谎。
     */
    async save(patch: Partial<ChangeRetention>): Promise<boolean> {
      if (this.saving) return false;
      this.saving = true;
      const next: ChangeRetention = { ...toRaw(this.retention), ...patch };
      try {
        const saved = await window.mochen.changesRetentionSave(next);
        this.retention = saved;
        // 存成功了这一刻它就是用户设的，不再是默认档。
        this.persisted = true;
        this.error = null;
        return true;
      } catch (error) {
        this.error = "改稿历史上限没有保存成功，界面已弹回原来的样子。";
        console.error("changes:retention-save 失败", error);
        return false;
      } finally {
        this.saving = false;
      }
    },

    /**
     * 立即按**当前**上限清理一次。
     *
     * 成功与「没什么可清」都要说人话，两者在界面上是同一块地方呈现的
     * （`changePruneReportLine` 出文），不能让用户面对一句没有信息的「已清理」。
     */
    async pruneNow(): Promise<void> {
      if (this.pruning) return;
      this.pruning = true;
      try {
        const report: ChangePruneReport = await window.mochen.changesPruneNow();
        this.pruneLine = changePruneReportLine(report);
        this.error = null;
      } catch (error) {
        this.pruneLine = null;
        this.error = "没能清理改稿历史（多半是还没打开作品目录）。";
        console.error("changes:prune-now 失败", error);
      } finally {
        this.pruning = false;
      }
    }
  }
});
