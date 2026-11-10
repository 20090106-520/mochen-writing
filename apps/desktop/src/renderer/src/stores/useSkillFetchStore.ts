import { defineStore } from "pinia";
import {
  SKILL_SOURCE_PRESETS,
  presetUrl,
  type RemoteListResult,
  type RemoteSkillEntry,
  type RemoteSkillPreview
} from "@mochen/contracts";
import { useAgentStore } from "./useAgentStore";
import { useSkillMarketStore } from "./useSkillMarketStore";

/**
 * 在线技能源的渲染层状态（2026-11-10）。
 *
 * 【它替代的到底是什么】
 * 之前技能页只有「内置清单」：二十条写在仓里的说明书，装出来的东西与网上无关。
 * 用户要的是「从网上找开源/好用的技能，直接放进来」。于是这里只有三个动作：
 * 列源 → 点开一条看它到底是什么 → 装进全局技能目录。
 *
 * 【判定一律不在这一层】
 * 能不能装、装到哪、同名怎么办、正文多大，全由主进程判并在 `notice` 里给一句中文；
 * 这里只存结果、只按 `listed` 区分「一条都没有」与「没列出来」。
 * 装完两张表都要刷（技能库 + 市场），否则会出现「提示装好了、列表里却没有」。
 *
 * 【为什么不把正文塞进列表】
 * 二十条技能的正文一次性取回来是二十次请求，而且 GitHub 有速率限制。
 * 列表只要名字，正文在点开那一条时取一次，并且主进程会缓存。
 */
export const useSkillFetchStore = defineStore("skillFetch", {
  state: () => ({
    /** 卡片是否展开。默认收起：技能页的首要内容是「我已经有什么」。 */
    open: false,
    /** 当前浏览的源：内置源的 id，或用户自己粘的地址（此时 `sourceId` 为 `custom`）。 */
    sourceId: SKILL_SOURCE_PRESETS[0]?.id ?? "",
    url: "",
    entries: [] as RemoteSkillEntry[],
    /** null = 还没列过；false = 列失败（原因在 notice）。 */
    listed: null as boolean | null,
    loading: false,
    notice: "",
    /** 正在展开预览的那一条的 path。空串 = 没有展开的。 */
    openPath: "",
    preview: null as RemoteSkillPreview | null,
    previewBusy: false,
    /** 正在装的那一条的 path。 */
    installing: "",
    /** 装好之后的那句结果，与列表刷新分开摆，免得刷一次就被覆盖。 */
    result: ""
  }),
  getters: {
    presets: () => SKILL_SOURCE_PRESETS,
    /** 地址栏当前指向哪儿（回显，让人确认自己看的是哪个源）。 */
    sourceLabel(state): string {
      const preset = SKILL_SOURCE_PRESETS.find((one) => one.id === state.sourceId);
      return preset === undefined ? state.url : preset.title;
    },
    busyOn(state) {
      return (path: string): boolean => state.installing === path;
    }
  },
  actions: {
    toggle(): void {
      this.open = !this.open;
      if (this.open && this.listed === null) void this.load(this.sourceId);
    },
    /** 切到一个内置源并立刻列。 */
    async usePreset(id: string): Promise<void> {
      this.sourceId = id;
      this.url = "";
      await this.load(id);
    },
    /** 列一遍当前的源（或某个地址）。失败不清空已显示的表，与 refreshSkills 同一口径。 */
    async load(idOrUrl: string): Promise<void> {
      if (this.loading) return;
      this.loading = true;
      this.notice = "";
      this.preview = null;
      this.openPath = "";
      try {
        const result: RemoteListResult = await window.mochen.listRemoteSkills(idOrUrl);
        this.entries = result.entries;
        this.listed = result.listed;
        this.notice = result.notice;
      } catch (err) {
        this.listed = false;
        this.notice = `没列出来：${reasonOf(err)}`;
      } finally {
        this.loading = false;
      }
    },
    /** 用户自己粘的地址：先归一成源再列。地址里没写协议也认（`owner/repo` 这种简写）。 */
    async loadTyped(): Promise<void> {
      const typed = this.url.trim();
      if (typed === "") {
        this.notice = "先粘一个地址：GitHub 仓库、某个技能目录，或一份 SKILL.md 的链接。";
        return;
      }
      this.sourceId = "custom";
      await this.load(typed);
    },
    /** 点开一条：取它的正文给用户看。取不到就说取不到，不留一个空壳预览。 */
    async openEntry(entry: RemoteSkillEntry): Promise<void> {
      if (this.openPath === entry.path) {
        this.openPath = "";
        this.preview = null;
        return;
      }
      this.openPath = entry.path;
      this.preview = null;
      this.previewBusy = true;
      try {
        this.preview = await window.mochen.previewRemoteSkill(entry.url);
      } catch (err) {
        this.preview = null;
        this.notice = `取不到这份技能：${reasonOf(err)}`;
      } finally {
        this.previewBusy = false;
      }
    },
    /** 装。成功就整表重列（已装标记归主进程判），并刷新技能库与市场两张表。 */
    async install(entry: RemoteSkillEntry): Promise<void> {
      if (this.installing !== "") return;
      this.installing = entry.path;
      this.result = "";
      try {
        const result = await window.mochen.installRemoteSkill(entry.url);
        this.result = result.notice;
        if (result.ok) {
          await useAgentStore().refreshSkills();
          await useSkillMarketStore().refresh();
          await this.load(this.sourceId === "custom" ? this.url.trim() : this.sourceId);
          this.result = result.notice;
        }
      } catch (err) {
        this.result = `装不上：${reasonOf(err)}`;
      } finally {
        this.installing = "";
      }
    },
    /** 把当前预览的那一份装进来。预览里已经知道它是什么了，不再重复取一遍。 */
    async installOpen(): Promise<void> {
      const entry = this.entries.find((one) => one.path === this.openPath);
      if (entry !== undefined) await this.install(entry);
    },
    /** 内置源那一条预设的地址——界面要显示「这个源在哪」时用它，不自己拼。 */
    urlOfPreset(id: string): string {
      const preset = SKILL_SOURCE_PRESETS.find((one) => one.id === id);
      return preset === undefined ? "" : presetUrl(preset);
    }
  }
});

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
