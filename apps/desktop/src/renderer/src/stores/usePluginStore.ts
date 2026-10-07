import { defineStore } from "pinia";
import type { PluginRef } from "@mochen/contracts";

/**
 * 插件的渲染层状态（2026-10-07 批次 5-㉚；5-㉛ 起住在 ExtensionsPage 的插件页）。
 *
 * 【为什么不挂进 useAgentStore】
 * 与技能市场同款理由：插件是**装在应用里的东西**，与当前书、当前线程都无关。
 * 塞进 agent store 会让「换一个 store 就是一个作用域」这条约定失效。
 *
 * 【这一份里没有开合】
 * 5-㉛ 之前它有一格 `open` 供浮层用；插件现在是整页，页的显隐由 layout store 的
 * currentView 拥有（那一页与当前书/线程都无关，正是 layout 的作用域）。
 * 留着 `open` 就会有两个真身，而它们可以一个说开一个说关。
 *
 * 【判定只在这一份】
 * 装没装、停没停、装不装得上，全部由主进程判（那是真身，见 plugin-service.ts）；
 * 这里只存它回的结果，模板不自己翻 `disabled`、不自己拼工具名。
 *
 * 【停用/卸载后必须重列】
 * 因为「已停用」这个标记是主进程按盘上实际情况给的。渲染层自己翻它就是第二份判据，
 * 而第二份判据会与真身漂开——症状是界面说停了、实际还在跑。
 */
export const usePluginStore = defineStore("plugins", {
  state: () => ({
    /** 主进程回的那张表。空数组 = 还没问过，与「问了但一个都没有」由 `listed` 分开。 */
    entries: [] as PluginRef[],
    /** null = 还没列过；false = 列不出来（那时 notice 有一句中文）。 */
    listed: null as boolean | null,
    /** 停用/卸载/读源码的结果（一句话）。空串 = 此刻没有反馈。 */
    notice: "",
    /** 正在动作上的目录名；空串 = 此刻没有动作在跑。用于禁掉那几颗钮。 */
    busyDirName: "",
    /** 源码预览：目录名 → 正文。点开时才去读，不预取。 */
    sources: {} as Record<string, string>,
    /** 正在读源码的那一个；空串 = 此刻没有在读。 */
    readingDirName: ""
  }),
  getters: {
    /** 当前正在跑着的那些（没停用、装得上）。判定在 getter，模板只 v-for。 */
    active(state): PluginRef[] {
      return state.entries.filter((one) => !one.disabled && one.ok);
    },
    /** 停用的那些单独摆一档：用户要看得见「我停用过什么」，藏着等于让人以为它没了。 */
    stopped(state): PluginRef[] {
      return state.entries.filter((one) => one.disabled);
    },
    isBusyOn(state) {
      return (dirName: string): boolean => state.busyDirName === dirName;
    }
  },
  actions: {
    /** 列一次。失败只写 notice、**不清空已显示的那张表**（与技能市场同一口径）。 */
    async refresh(): Promise<void> {
      try {
        const result = await window.mochen.listPlugins();
        this.entries = result.entries;
        this.listed = result.listed;
      } catch (err) {
        this.listed = false;
        this.notice = `插件清单没有列出来：${reasonOf(err)}`;
      }
    },
    /**
     * 停用或启用。做完**必须重列**：那一态由主进程判，渲染层自己翻就是第二份判据。
     *
     * 【失败也要重列】用户点了停用而主进程没停成功时，界面必须回到「没停」，
     * 否则用户以为已经停用了、下一轮才发现工具还在——那比当场报一句更坏。
     */
    async toggle(dirName: string, enabled: boolean): Promise<void> {
      await this.runAction(dirName, () => window.mochen.togglePlugin(dirName, enabled));
    },
    async uninstall(dirName: string): Promise<void> {
      await this.runAction(dirName, () => window.mochen.uninstallPlugin(dirName));
      delete this.sources[dirName];
    },
    /** 读一份源码来看一眼。截断的话如实说，不把半截当全部。 */
    async openSource(dirName: string): Promise<void> {
      this.readingDirName = dirName;
      try {
        const result = await window.mochen.readPluginSource(dirName);
        this.sources[dirName] = result.truncated
          ? `${result.content}\n\n（后面还有，这里只显示了开头一段）`
          : result.content;
      } catch (err) {
        this.notice = `读不到「${dirName}」的源码：${reasonOf(err)}`;
      } finally {
        this.readingDirName = "";
      }
    },
    async runAction(dirName: string, action: () => Promise<string>): Promise<void> {
      this.busyDirName = dirName;
      try {
        this.notice = await action();
      } catch (err) {
        this.notice = `没成：${reasonOf(err)}`;
      } finally {
        // 成败都重列：失败时界面要回到真身说的那一态，不能停在一个乐观的假象上。
        this.busyDirName = "";
        await this.refresh();
      }
    }
  }
});

/**
 * 失败原因那句话。
 *
 * 【不许把英文技术串透给用户】与 doc-tools-host 里 webSearch 那条同款理由：
 * 主进程那边可能哪天 `new Error("ENOENT")`，那种串一个字都不该出现在界面上。
 */
function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
