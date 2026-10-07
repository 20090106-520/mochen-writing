import { defineStore } from "pinia";
import type {
  AppearanceBackdrop,
  AppearanceGlass,
  AppearanceGrid,
  AppearanceSurface
} from "@mochen/contracts";
import {
  APPEARANCE_BACKDROP_LABELS,
  APPEARANCE_GLASS_LABELS,
  APPEARANCE_GRID_LABELS,
  APPEARANCE_SURFACE_LABELS,
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
 * 【档名那一列的顺序就是中文名表的键序】
 * 不在这里另排一份：加一档时中文名表与 contracts 都要改（中文名必须人来定），
 * 而按钮顺序自动跟着中文名表的键序走，不需要第三处改动。
 */

/* 枚举的键序 —— 也就是档在按钮上的顺序。
   **从中文名表取键**，而不是从 contracts 再 import 一遍数组：
   两份数组都是 contracts 的，但拿键序只在这里一处做。 */
const APPEARANCE_BACKDROP_LABELS_ORDER = Object.keys(APPEARANCE_BACKDROP_LABELS);
const APPEARANCE_GLASS_LABELS_ORDER = Object.keys(APPEARANCE_GLASS_LABELS);
const APPEARANCE_SURFACE_LABELS_ORDER = Object.keys(APPEARANCE_SURFACE_LABELS);
const APPEARANCE_GRID_LABELS_ORDER = Object.keys(APPEARANCE_GRID_LABELS);

export const ALL_SKIN_FILTER = "全部";

export interface SkinBrowseConditions {
  draft: string;
  query: string;
  /** 空串 = 全部（不收窄）。用空串而不是 "全部" 这个词，是为了让存盘与判定都省一次映射。 */
  backdrop: AppearanceBackdrop | "";
  glass: AppearanceGlass | "";
  surface: AppearanceSurface | "";
  grid: AppearanceGrid | "";
}

function emptyConditions(): SkinBrowseConditions {
  return { draft: "", query: "", backdrop: "", glass: "", surface: "", grid: "" };
}

export interface SkinFilterRow {
  key: "backdrop" | "glass" | "surface" | "grid";
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
        c.query !== "" || c.backdrop !== "" || c.glass !== "" || c.surface !== "" || c.grid !== ""
      );
    },
    /** 四行筛选的形状。真身在 filters getter，模板只 v-for。 */
    filterRows(state): SkinFilterRow[] {
      const c = state.conditions;
      return [
        {
          key: "backdrop",
          label: "背景",
          values: [ALL_SKIN_FILTER, ...APPEARANCE_BACKDROP_LABELS_ORDER],
          labels: { [ALL_SKIN_FILTER]: ALL_SKIN_FILTER, ...APPEARANCE_BACKDROP_LABELS },
          current: c.backdrop || ALL_SKIN_FILTER
        },
        {
          key: "glass",
          label: "玻璃",
          values: [ALL_SKIN_FILTER, ...APPEARANCE_GLASS_LABELS_ORDER],
          labels: { [ALL_SKIN_FILTER]: ALL_SKIN_FILTER, ...APPEARANCE_GLASS_LABELS },
          current: c.glass || ALL_SKIN_FILTER
        },
        {
          key: "surface",
          label: "表面",
          values: [ALL_SKIN_FILTER, ...APPEARANCE_SURFACE_LABELS_ORDER],
          labels: { [ALL_SKIN_FILTER]: ALL_SKIN_FILTER, ...APPEARANCE_SURFACE_LABELS },
          current: c.surface || ALL_SKIN_FILTER
        },
        {
          key: "grid",
          label: "图案",
          values: [ALL_SKIN_FILTER, ...APPEARANCE_GRID_LABELS_ORDER],
          labels: { [ALL_SKIN_FILTER]: ALL_SKIN_FILTER, ...APPEARANCE_GRID_LABELS },
          current: c.grid || ALL_SKIN_FILTER
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
          this.matches([skin.label, skin.tagline, skin.origin, skin.id])
      );
    }
  }
});
