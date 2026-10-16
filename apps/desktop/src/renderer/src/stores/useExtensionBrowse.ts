import { defineStore } from "pinia";
import {
  MARKET_CATEGORIES,
  SKILL_PATHS_MAX,
  SKILL_SOURCE_LABELS,
  type MarketCategory,
  type MarketEntry,
  type PluginRef,
  type SkillRef
} from "@mochen/contracts";
import { candidateOf, rankSkills, type SkillPick } from "../utils/skill-pick";

/**
 * 插件/技能页的**浏览条件**与其派生行（2026-10-07 批次 5-㉛）。
 *
 * 【条件按页各管一份，不是整页共用一份】
 * 写这一版时先把搜索词与筛选档做成了整页共用，随后改掉了：同一个筛选档在两页含义不同
 * （插件的「已安装」是没停用且装得上，技能的「已安装」是盘上有），共用一格会出现
 * 「在插件页顺手点了已安装，切到技能页只剩已安装的那些」——用户没要求过这件事，却发生了。
 * 而搜索框只有一个、切页签时显示的那一个字串也只有一格，所以**每页各带一份 draft**，
 * 于是「页签切换 = 换了一个清单，上一页的条件不该套在下一页上」这句在数据结构里成立，
 * 而不是靠每个调用点记得手动重置。
 *
 * 【派生行为什么在这里算，模板不自己 filter / 不自己 join】
 * 与技能市场/插件面板同款口径（铁律 6）：筛选、搜索、去重的判定只留一份，模板只 v-for。
 */

/**
 * 「已安装」那一档的档名。**两页共用一个词，但两页含义不同**（插件是没停用且装得上，
 * 技能是盘上有），所以条件本身仍按页各存一份。
 *
 * 为什么单独提出一个常量而不是两处各写一个字面量：用户指正要技能库那处也写「已安装」，
 * 而「同一个状态在两页叫两个词」正是界面在少说一件事——他在插件页认得「已装」，
 * 切到技能页却看到「在盘上」，会以为那是另一种状态。**档名是全应用一个词，口径各页各判。**
 */
export const INSTALLED_FILTER = "已安装";

/** 插件那页的筛选档。插件的类别由各插件自报而 `PluginRef` 里没有类别字段，所以只有这两档。 */
export type PluginFilter = "全部" | typeof INSTALLED_FILTER;
export const PLUGIN_FILTERS: readonly PluginFilter[] = ["全部", INSTALLED_FILTER];

/** 技能那页的筛选档 = 全部 + 市场那五个分类 + 「技能库」这一档 + 「已安装」。
 *  市场那五个直接从 `MARKET_CATEGORIES` 取，不另写一份（铁律 6）——
 *  另写一份的话，加一个分类要改两个地方，而漏改的那一个会让那个类别永远筛不出来。 */
export type SkillFilter = MarketCategory | "技能库" | typeof INSTALLED_FILTER | "全部";
export const SKILL_FILTERS: readonly SkillFilter[] = [
  "全部",
  ...MARKET_CATEGORIES,
  "技能库",
  INSTALLED_FILTER
];

/** 盘上但市场清单里没有的技能，卡片上那个分类标签就叫它（也是那一档筛选的档名）。 */
export const SKILL_LIBRARY_CATEGORY = "技能库";

/** 一页的条件。两个字段的分工与旧技能市场一致：draft 是输入框里正敲的字，query 是已提交的。
 *  分开是因为输入框不该一边敲一边筛——打到第三个字时结果已经变了，而用户还没按搜索。 */
export interface ExtensionBrowseConditions {
  draft: string;
  query: string;
  filter: PluginFilter | SkillFilter;
}

function emptyConditions(): {
  plugins: ExtensionBrowseConditions;
  skills: ExtensionBrowseConditions;
} {
  return {
    plugins: { draft: "", query: "", filter: "全部" },
    skills: { draft: "", query: "", filter: "全部" }
  };
}

/** 技能那页的一行。**一个技能一行**，盘上的与市场清单里的按目录名并成一行（见 skillEntries）。 */
export interface ExtensionSkillRow {
  /** 卡片的唯一键：盘上那份用技能 id（`global:rhythm`），只在清单里的用 `market:<dirName>`。 */
  key: string;
  /** 目录名。两张表的主键——市场装出来的就是落在全局 skills 目录下的同名目录。 */
  dirName: string;
  displayName: string;
  /** 一句说明（市场条目取 summary，盘上技能取 description）。 */
  summary: string;
  /** 显示用的分类标签：市场那条是它自己的分类，盘上非市场条目的是「技能库」。筛选按它判。 */
  categoryLabel: SkillFilter;
  /** 出处与许可。盘上那条只写来源（contracts 的 SKILL_SOURCE_LABELS），市场那条写「来源 · 许可」。 */
  sourceLabel: string;
  /** 盘上有没有（能不能挂入上下文）。 */
  onDisk: boolean;
  /** 已挂进本线程。**按线程判**：挂入是每条线程的事（spec §11），A 章挂的不该让 B 章显示成已挂入。 */
  pinned: boolean;
  /** 挂入时递的技能 id；`onDisk` 为假时是空串。 */
  skillId: string;
  /** 市场清单里有没有这一条（决定给不给「装上 / 卸掉」那枚钮）。 */
  inMarket: boolean;
  /** 市场那一条装没装。 */
  marketInstalled: boolean;
  /** 已装但书内同名那份盖住了它。判定在 contracts 的 `catalogView` 里，这里只透传。 */
  shadowedByBook: boolean;
  /** 市场条目的正文全文，供「看看装上去的就是这份」预览；盘上非市场条目的空串。 */
  skillMd: string;
  /** 这一行此刻有没有动作在跑（卸掉/装上 之中有一个在跑）。 */
  busy: boolean;
}

// 这三个 store 只在 action 内部现取（不在模块求值期读它们的状态），但 import 仍在文件顶部：
// ESM 会把所有 import 声明提升到模块顶部，把它们写在文件末尾**并不能**延迟求值——
// 那只是让「为什么放这儿」看起来有理由，而理由是假的。
// 放在顶部之前先确认过没有回边：useExtensionBrowse 没有被任何 store 引用，
// 所以 useSkillMarketStore / useAgentStore / useBookStore 到这儿都是单向的。
// **将来往这里加 import 时先查有没有回边**，有回边就会在加载顺序上变成一个隐含约定，
// 而那种约定的破法是运行时的 undefined，不是编译错误。
import { useSkillMarketStore } from "./useSkillMarketStore";
import { useAgentStore, threadKeyFor } from "./useAgentStore";
import { useBookStore } from "./useBookStore";

/** 插件/技能那页两枚钮各自落到谁身上。真身仍在各自那个 store（铁律 6），这里只分派。 */
export const useExtensionBrowseStore = defineStore("extensionBrowse", {
  state: () => ({ pages: emptyConditions() }),
  getters: {
    /**
     * 一段文字是否命中。
     *
     * 【为什么判定住这里】搜索是这一页的核心动作，而「怎么算命中」若在模板里写，
     * 插件页与技能页就会各写一遍——两边扫的字段还不一样（插件扫工具名，技能扫说明）。
     * ⇒ 合成一个函数，两边共用；差异交给调用方传字段。
     */
    matches(state) {
      return (haystack: readonly string[], page: "plugins" | "skills"): boolean => {
        const q = state.pages[page].query.trim().toLowerCase();
        if (q === "") return true;
        return haystack.some((one) => one.toLowerCase().includes(q));
      };
    },
    /** 当前页有没有正在生效的条件（搜索词或非「全部」那一档）。页眉那颗「清空」据此出现。 */
    hasConditions(state) {
      return (page: "plugins" | "skills"): boolean =>
        state.pages[page].query !== "" || state.pages[page].filter !== "全部";
    },
    /**
     * 技能页顶上那条「推荐」的装配（2026-10-17，接 `utils/skill-pick` 的得分逻辑）。
     *
     * 【推荐 ≠ 挂入，这一层一个字都没越界】
     * 它只产出一张排好序的建议清单；真正的挂入仍然是 `useAgentStore.toggleSkillForThread`
     * 那一颗钮（spec §11「唯一让技能进入上下文的动作」没动）。所以这里不写任何线程态。
     *
     * 【为什么装配住这里而不是模板里】
     * 与 `skillEntries` 同款口径（铁律 6）：候选切面的映射、去重、排序只有一份，
     * 模板只 v-for。打分本体仍在 `skill-pick`，这里只负责把 `SkillRef[]` 递进去、把结果递出来——
     * 字段名一旦对歪（比方说把 `stages` 当 `stage`），分数会静默变错，所以要有一条用例钉住映射。
     *
     * 场景三项（`stageName` / `docKind` / `instruction`）由页面现取后透传：
     * 阶段名取自 `activeStageOf(book.meta)?.name`、文稿类取自当前活动文稿的 `kind`、
     * 指令就是本线程输入框里正敲的字（`agent.draftOf`）。
     */
    skillRecommendations() {
      return (input: {
        /** 技能库那张表（盘上有得挂的那些）。 */
        library: readonly SkillRef[];
        /** 本线程已挂入的技能 id：不再重复推荐。 */
        pinned: readonly string[];
        /** 当前创作阶段名；没打开作品 / 没阶段传空串。 */
        stageName: string;
        /** 当前文稿 kind；没打开文稿传 null。 */
        docKind: string | null;
        /** 本线程输入框里正敲的指令原文。 */
        instruction: string;
        /** 取前几条，默认技能挂入上限（`SKILL_PATHS_MAX` = 12）。 */
        limit?: number;
      }): SkillPick[] =>
        rankSkills(
          input.library.map(candidateOf),
          { stageName: input.stageName, docKind: input.docKind, instruction: input.instruction },
          input.limit ?? SKILL_PATHS_MAX,
          input.pinned
        );
    }
  },
  actions: {
    /** 按了搜索（或回车）：把 draft 提交成 query。没敲字就等于清空搜索。 */
    submitSearch(page: "plugins" | "skills"): void {
      this.pages[page].query = this.pages[page].draft.trim();
    },
    setFilter(page: "plugins" | "skills", filter: PluginFilter | SkillFilter): void {
      this.pages[page].filter = filter;
    },
    /** 清掉这一页的条件。留着上一次搜的东西，用户切回来只会以为「怎么就这几张卡」。 */
    clearConditions(page: "plugins" | "skills"): void {
      this.pages[page] = { draft: "", query: "", filter: "全部" };
    },
    /**
     * 插件那页的行：筛选 + 搜索都在这里判完，模板只 v-for。
     *
     * 「已安装」这一档的口径：**没停用且装得上**（`ok` 与 `disabled` 都由主进程判）。
     * 停用的那些在「全部」里仍看得见——用户要看得见「我停用过什么」。
     */
    pluginEntries(
      plugins: { entries: PluginRef[]; isBusyOn(dirName: string): boolean },
      page: "plugins" | "skills" = "plugins"
    ): PluginRef[] {
      const rows =
        this.pages[page].filter === INSTALLED_FILTER
          ? plugins.entries.filter((one) => !one.disabled && one.ok)
          : plugins.entries;
      return rows.filter((one) => this.matches([one.title, ...one.toolNames, one.reason], page));
    },
    /**
     * 技能那页的行。**两张表按目录名并成一行**。
     *
     * 【为什么必须并，而不是各出一张】
     * 市场装上之后，那份技能就落进了全局 skills 目录，于是它**同时**出现在
     * 「盘上那张表」与「市场那张表」里。各出一行的话，同一个技能在页面上出现两次、
     * 两枚钮还不一样（一枚装/卸、一枚挂入/取下）——用户得自己想哪张卡才是真的那一份。
     * 这与 5-㉚ 探针在旧浮层里抓到的「清单混进 shim 与停用清单」是同一族：两份来源没合就端上桌。
     *
     * 【哪一份在生效，不在这里判】
     * 主进程的 `mergeSkillRefs` 已经按目录名去重且**书内优先**，
     * 所以 `library` 里每个目录名只有一条、那条就是要挂入的那份。
     * 这里只按主键 join，不重算优先级（重算就是第二份判据）。
     *
     * 顺序：盘上那些按 `library` 的原序（那已经是主进程排好的），之后才补只在清单里、
     * 还没装的那些（按市场自己的分类序）。于是用户自己放的技能位置稳定，不会因为
     * 市场里碰巧没有它就乱跳。
     */
    skillEntries(input: {
      library: readonly SkillRef[];
      /** 本线程已挂入的技能 id。 */
      pinned: readonly string[];
      market: readonly MarketEntry[];
      marketBusy(dirName: string): boolean;
      page?: "plugins" | "skills";
    }): ExtensionSkillRow[] {
      const page = input.page ?? "skills";
      const pinned = new Set(input.pinned);
      const rows: ExtensionSkillRow[] = [];
      const joined = new Set<string>();

      for (const skill of input.library) {
        const entry = input.market.find((one) => one.dirName === skill.dirName);
        joined.add(skill.dirName);
        rows.push({
          key: `library:${skill.id}`,
          dirName: skill.dirName,
          displayName: skill.displayName,
          summary: skill.description,
          categoryLabel: entry ? entry.category : SKILL_LIBRARY_CATEGORY,
          sourceLabel: entry
            ? `${entry.origin} · ${entry.license}`
            : SKILL_SOURCE_LABELS[skill.source],
          onDisk: true,
          pinned: pinned.has(skill.id),
          skillId: skill.id,
          inMarket: entry !== undefined,
          marketInstalled: entry?.installed ?? false,
          shadowedByBook: entry?.shadowedByBook ?? false,
          skillMd: entry?.skillMd ?? "",
          busy: input.marketBusy(skill.dirName)
        });
      }

      for (const entry of input.market) {
        if (joined.has(entry.dirName)) continue;
        rows.push({
          key: `market:${entry.dirName}`,
          dirName: entry.dirName,
          displayName: entry.displayName,
          summary: entry.summary,
          categoryLabel: entry.category,
          sourceLabel: `${entry.origin} · ${entry.license}`,
          onDisk: false,
          pinned: false,
          skillId: "",
          inMarket: true,
          marketInstalled: entry.installed,
          shadowedByBook: entry.shadowedByBook,
          skillMd: entry.skillMd,
          busy: input.marketBusy(entry.dirName)
        });
      }

      const filter = this.pages[page].filter;
      const byFilter =
        filter === "全部"
          ? rows
          : filter === INSTALLED_FILTER
            ? rows.filter((one) => one.onDisk)
            : rows.filter((one) => one.categoryLabel === filter);
      return byFilter.filter((one) =>
        this.matches([one.displayName, one.summary, one.sourceLabel], page)
      );
    },
    /**
     * 「装上 / 卸掉」：**落盘**的那一层，装一次全局到处能用。
     * 路径与「已安装」判定全在主进程（skill-market-service.ts），这里既不拼路径也不自己翻标记。
     */
    async toggleInstalled(row: ExtensionSkillRow): Promise<void> {
      if (!row.inMarket) return;
      const market = useSkillMarketStore();
      await (row.marketInstalled ? market.uninstall(row.dirName) : market.install(row.dirName));
    },
    /**
     * 「挂入 / 取下」：**这一条线程**的那一层，重启后清空。
     *
     * 与上一条不是一回事，所以页面上是两枚钮而不是一枚——合成一枚就是把
     * 「已经安装」与「这一轮生效」混成同一个「已安装」，
     * 而那是两种不同的期待：用户常常要「盘上有，但这一轮别带」。
     */
    togglePinned(row: ExtensionSkillRow): void {
      if (!row.onDisk || row.skillId === "") return;
      useAgentStore().toggleSkillForThread(threadKeyFor(useBookStore().activeDocTab), row.skillId);
    }
  }
});
