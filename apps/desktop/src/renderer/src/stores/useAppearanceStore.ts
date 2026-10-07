import { defineStore } from "pinia";
import { toRaw } from "vue";
import { createDefaultAppearanceSettings, type AppearanceSettings } from "@mochen/contracts";

/**
 * 外观设置的数据真身：App.vue 只管把 settings 刷上 DOM，读写都走这里。
 * load 在应用挂载时调一次（appearance:get）；update 是「改一处」的入口，
 * 每次都整份写回主进程（appearance:save），成功才落本地 state——
 * 失败时 state 不动（界面弹回原样），error 收一句中文，UI 如实转述，不假装存上了。
 */
export const useAppearanceStore = defineStore("appearance", {
  state: () => ({
    settings: createDefaultAppearanceSettings(),
    loaded: false,
    error: null as string | null
  }),
  actions: {
    async load(): Promise<void> {
      try {
        const snapshot = await window.mochen.appearanceGet();
        this.settings = snapshot.settings;
        this.loaded = true;
        this.error = null;
      } catch (error) {
        // 读失败就用默认值继续跑（和主进程「坏了退默认」一个口径），但要把话说明白。
        this.error = "外观设置没有读到，用的是默认主题。";
        console.error("appearance:get 失败", error);
      }
    },
    async update(patch: Partial<AppearanceSettings>): Promise<boolean> {
      /**
       * **必须 `toRaw`，不能只 `{ ...this.settings }`**（2026-10-06 真机撞出来的）。
       *
       * 浅展开只解开**顶层**：`this.settings` 是响应式对象，展开出来的 `next.mode` 是原始字符串，
       * 但 `next.light` / `next.dark` 仍然是 Vue 代理。Electron 在 IPC 的 send 端做结构化克隆，
       * 代理当场抛 `An object could not be cloned.` ⇒ **用户改任何外观设置都存不下来**，
       * 而 tsc / eslint / vitest 三关全绿（死掉的不是语法，是「那个值是代理」）。
       *
       * `toRaw(this.settings)` 返回的是 raw target，它的嵌套值本来就是 raw 的，
       * 一次就把整棵树解开。与批次 5-② 那个 EPUB `buildExport(toRaw(...))`、
       * 以及 `useBookStore.saveMeta` 的 `{ ...toRaw(this.meta), ...patch }` 是同一条口径。
       */
      const next: AppearanceSettings = { ...toRaw(this.settings), ...patch };
      try {
        await window.mochen.appearanceSave(next);
      } catch (error) {
        this.error = "外观设置没有保存成功，界面已弹回原来的样子。";
        console.error("appearance:save 失败", error);
        return false;
      }
      this.settings = next;
      this.error = null;
      return true;
    }
  }
});
