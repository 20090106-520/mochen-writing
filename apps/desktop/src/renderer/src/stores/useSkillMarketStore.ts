import { defineStore } from "pinia";
import { MARKET_CATEGORIES, type MarketCategory, type MarketEntry } from "@mochen/contracts";
import { useAgentStore } from "./useAgentStore";

/**
 * 技能市场的渲染层状态（2026-10-07）。
 *
 * 【为什么不挂进 useAgentStore / useBookStore】
 * 那一层是「这一轮对话 / 这本书」的状态；市场是**装在应用里的东西**，
 * 与当前书、与当前线程都无关（装一次全局到处能用）。塞进去会让「换一个 store 就是一个作用域」
 * 这条约定失效——本仓的 skill-service 特意在注释里写了「书目录是运行时才有的，所以现问 book.current()」，
 * 市场这一侧压根没有那个依赖。
 * 另外 `useBookStore.ts` 已经正好 800 行（行数预算上限），`useAgentStore` 也只剩 54 行余量。
 *
 * 【判定只在这一份】
 * 装没装归主进程判（`catalogView` 在 contracts），这里只存它回的结果；
 * 「筛选到某一类」这种纯显示判定也住这里，模板不自己 filter。
 */
export type MarketFilter = MarketCategory | "全部";

/** 筛选的那一排：全部分类 + 「全部」。顺序由 `MARKET_CATEGORIES` 的声明序给定，不另写一份。 */
export const MARKET_FILTERS: MarketFilter[] = ["全部", ...MARKET_CATEGORIES];

export const useSkillMarketStore = defineStore("skillMarket", {
  state: () => ({
    /** 主进程回的那张表。空数组 = 还没问过，与「问了但一个都没有」由 `listed` 分开。 */
    entries: [] as MarketEntry[],
    /** null = 还没列过。真出过错（列不出来）时它会带一句中文。 */
    listed: null as boolean | null,
    /** 装/卸过程中的一句中文结果（成功也是一句）。空串 = 此刻没有反馈。 */
    notice: "",
    /** 正在装/卸的目录名；空串 = 此刻没有动作在跑。用于禁掉那颗按钮。 */
    busyDirName: "",
    filter: "全部" as MarketFilter
  }),
  getters: {
    /** 当前筛选下要显示的那些条。判定在这里，模板只 v-for。 */
    visible(state): MarketEntry[] {
      if (state.filter === "全部") return state.entries;
      return state.entries.filter((e) => e.category === state.filter);
    },
    /** 正在忙的那一条是不是当前这条——模板据此决定按钮文案与禁用。 */
    isBusyOn(state) {
      return (dirName: string): boolean => state.busyDirName === dirName;
    }
  },
  actions: {
    setFilter(filter: MarketFilter): void {
      this.filter = filter;
    },
    /** 列一次市场。失败只写 notice、**不清空已显示的那张表**（与 refreshSkills 同一口径）。 */
    async refresh(): Promise<void> {
      try {
        const result = await window.mochen.listMarket();
        this.entries = result.entries;
        this.listed = result.listed;
        if (result.notice !== "") this.notice = result.notice;
      } catch (err) {
        this.listed = false;
        this.notice = `技能市场没有列出来：${reasonOf(err)}`;
      }
    },
    /**
     * 装一条。装完**必须重列**：已装标记是主进程按盘上实际情况判的，
     * 渲染层自己把 installed 翻成 true 就是第二份判据（铁律 6）。
     */
    async install(dirName: string): Promise<void> {
      await this.runInstall(dirName, window.mochen.installMarketSkill);
    },
    async uninstall(dirName: string): Promise<void> {
      await this.runInstall(dirName, window.mochen.uninstallMarketSkill);
    },
    /** install / uninstall 共用的那一次写盘。**只有这两个入口调它**，模板不调。 */
    async runInstall(dirName: string, call: (name: string) => Promise<string>): Promise<void> {
      if (this.busyDirName !== "") return;
      this.busyDirName = dirName;
      this.notice = "";
      try {
        this.notice = await call(dirName);
      } catch (err) {
        this.notice = `没能装卸这一条：${reasonOf(err)}`;
      } finally {
        this.busyDirName = "";
        await this.refresh();
        // **技能库那张表也得刷**：它是 agent store 里的另一张表（`refreshSkills`），
        // 盘的目录变了它不会自己变。不刷的后果很具体——用户在市场这一页装完，
        // 切回「已有的」看到的还是装之前那张表，新技能根本不在里面，
        // 而 notice 明明写着「装好了」。两张表各刷各的，判定仍只在主进程那一份。
        // 成败都刷：读盘很便宜，漏刷一次要等用户下次重开面板才发现。
        await useAgentStore().refreshSkills();
      }
    }
  }
});

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
