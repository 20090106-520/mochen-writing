import { defineStore } from "pinia";
import type {
  AppearanceArt,
  AppearanceBackdrop,
  AppearanceGlass,
  AppearanceGrid,
  AppearanceSurface
} from "@mochen/contracts";
import {
  APPEARANCE_ART_LABELS,
  APPEARANCE_BACKDROP_LABELS,
  APPEARANCE_GLASS_LABELS,
  APPEARANCE_GRID_LABELS,
  APPEARANCE_SURFACE_LABELS,
  SKIN_ART_FILTERS,
  SKIN_BACKDROP_FILTERS,
  SKIN_GLASS_FILTERS,
  SKIN_GRID_FILTERS,
  SKIN_SURFACE_FILTERS,
  appearanceSkins,
  type AppearanceSkin
} from "../composables/appearanceSkins";

/**
 * 皮肤广场的浏览条件（2026-10-07 批次 5-㊴ 建，5-㊵ 换了四层的名字）。
 *
 * 【为什么条件住在 store 而不是页面】
 * 与插件/技能那一页同款口径（铁律 6）：筛选与搜索的判定只留一份，
 * 模板只 v-for、只绑。写在页面里的话，将来加第二处入口（比如命令面板）
 * 就得把这一段抄一遍，而抄的那份迟早忘改一个档。
 *
 * 【四层筛选是四个独立条件，不是四个单选档】
 * 一套皮肤可以同时是「弥散光 + 厚玻璃 + 全直角 + 无网格」——
 * 四个维度各自收窄，取交集。用户要的是「给我所有带玻璃的」，
 * 而不是「背景是弥散光**或**圆角是全直角」（那是并集，筛出来的东西没法看）。
 *
 * 【档只摆「表里真的有皮肤在用」的那几档】（2026-10-08 批次 5-㊷ 改）
 * 原先这里铺的是中文名表的全量键，而 contracts 有六档背景、表里只有三档在用——
 * 点 `nebula / ember / midnight` 必然筛出空列表，页面显示「没有匹配的皮肤」。
 * 那句话是假象，真相是那枚按钮不该存在。
 * ⇒ 档的来源改成 `SKIN_*_FILTERS`（在 appearanceSkins.ts 里从表派生，
 *   顺序仍按 contracts 枚举的键序）。加一档皮肤时按钮自己长出来，
 *   而「点了没结果」这一族在结构上就不可能再发生。
 */

export const ALL_SKIN_FILTER = "全部";

export interface SkinBrowseConditions {
  draft: string;
  query: string;
  /** 空串 = 全部（不收窄）。用空串而不是 "全部" 这个词，是为了让存盘与判定都省一次映射。 */
  backdrop: AppearanceBackdrop | "";
  glass: AppearanceGlass | "";
  surface: AppearanceSurface | "";
  grid: AppearanceGrid | "";
  art: AppearanceArt | "";
}

function emptyConditions(): SkinBrowseConditions {
  return { draft: "", query: "", backdrop: "", glass: "", surface: "", grid: "", art: "" };
}

export interface SkinFilterRow {
  key: "backdrop" | "glass" | "surface" | "grid" | "art";
  label: string;
  /** 那一维的全部取值（外加「全部」）。模板只 v-for 它。 */
  values: readonly string[];
  /** 每个档的中文名。空串（全部）那份也在里面。 */
  labels: Record<string, string>;
  current: string;
}

export const useSkinBrowseStore = defineStore("skinBrowse", {
  state: () => ({ conditions: emptyConditions() }),
  getters: {
    /** 当前页有没有正在生效的条件（搜索词或四层里任何一层收窄了）。 */
    hasConditions(state): boolean {
      const c = state.conditions;
      return (
        c.query !== "" ||
        c.backdrop !== "" ||
        c.glass !== "" ||
        c.surface !== "" ||
        c.grid !== "" ||
        c.art !== ""
      );
    },
    /** 五行筛选的形状。真身在 filters getter，模板只 v-for。
     *  `values` 用的是 `SKIN_*_FILTERS`（**从皮肤表派生**的在用小集合），
     *  `labels` 用的是全量中文名表——档名要一直查得到，
     *  因为老 JSON 里可能存着一档广场不卖的合法值。 */
    filterRows(state): SkinFilterRow[] {
      const c = state.conditions;
      return [
        {
          key: "backdrop",
          label: "背景",
          values: [ALL_SKIN_FILTER, ...SKIN_BACKDROP_FILTERS],
          labels: { [ALL_SKIN_FILTER]: ALL_SKIN_FILTER, ...APPEARANCE_BACKDROP_LABELS },
          current: c.backdrop || ALL_SKIN_FILTER
        },
        {
          key: "glass",
          label: "玻璃",
          values: [ALL_SKIN_FILTER, ...SKIN_GLASS_FILTERS],
          labels: { [ALL_SKIN_FILTER]: ALL_SKIN_FILTER, ...APPEARANCE_GLASS_LABELS },
          current: c.glass || ALL_SKIN_FILTER
        },
        {
          key: "surface",
          label: "表面",
          values: [ALL_SKIN_FILTER, ...SKIN_SURFACE_FILTERS],
          labels: { [ALL_SKIN_FILTER]: ALL_SKIN_FILTER, ...APPEARANCE_SURFACE_LABELS },
          current: c.surface || ALL_SKIN_FILTER
        },
        {
          key: "grid",
          label: "图案",
          values: [ALL_SKIN_FILTER, ...SKIN_GRID_FILTERS],
          labels: { [ALL_SKIN_FILTER]: ALL_SKIN_FILTER, ...APPEARANCE_GRID_LABELS },
          current: c.grid || ALL_SKIN_FILTER
        },
        {
          key: "art",
          label: "画面",
          values: [ALL_SKIN_FILTER, ...SKIN_ART_FILTERS],
          labels: { [ALL_SKIN_FILTER]: ALL_SKIN_FILTER, ...APPEARANCE_ART_LABELS },
          current: c.art || ALL_SKIN_FILTER
        }
      ];
    }
  },
  actions: {
    /** 按了搜索（或回车）：把 draft 提交成 query。没敲字就等于清空搜索。 */
    submitSearch(): void {
      this.conditions.query = this.conditions.draft.trim();
    },
    /** 换某一层的档。点已选中的那枚 = 收回这一层（再点「全部」也是同一个结果）。 */
    setFilter(key: SkinFilterRow["key"], value: string): void {
      const next: string = this.conditions[key] === value ? "" : value;
      // **整份替换，不做 conditions[key] = …**（2026-10-07 批次 5-㊴ 撞出来的）。
      // 左侧 `this.conditions[key]` 在 key 是字面量联合时会被 tsc 收窄成**那一维**，
      // 于是写进去的联合类型一定过不了 —— 报的还是
      // `Type '"plain"' is not assignable to type '""'`，而右侧已经收窄过了。
      // 换成整份替换后，赋值发生在 SkinBrowseConditions 这个整体类型上，那一步不存在。
      this.conditions = { ...this.conditions, [key]: next } as SkinBrowseConditions;
    },
    clearConditions(): void {
      this.conditions = emptyConditions();
    },
    /** 一段文字是否命中皮肤名、说明与出处。判定在这里，模板不自己 filter。 */
    matches(haystack: readonly string[]): boolean {
      const q = this.conditions.query.trim().toLowerCase();
      if (q === "") return true;
      return haystack.some((one) => one.toLowerCase().includes(q));
    },
    /** 四层收窄 + 搜索，全在这一处判完。模板只 v-for 结果。 */
    visibleSkins(skins: readonly AppearanceSkin[] = appearanceSkins): AppearanceSkin[] {
      const c = this.conditions;
      return skins.filter(
        (skin) =>
          (c.backdrop === "" || skin.backdrop === c.backdrop) &&
          (c.glass === "" || skin.glass === c.glass) &&
          (c.surface === "" || skin.surface === c.surface) &&
          (c.grid === "" || skin.grid === c.grid) &&
          (c.art === "" || skin.art === c.art) &&
          this.matches([skin.label, skin.tagline, skin.origin, skin.id])
      );
    }
  }
});
