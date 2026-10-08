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
  state: () => ({
    conditions: emptyConditions(),
    /** 整窗预览中的那套皮肤 id。`null` = 没在预览。
     *  **它不进 appearance.json**：预览是「先看一眼」，落盘的只有「就用它」那一次。
     *  真身放在浏览 store 而不是页面 ref，是因为刷到屏幕上的那条通路在 App.vue（装配层），
     *  页面 ref 递不过去；递不过去就会有人再开一条写 DOM 的路，那两个作者同一批 token
     *  正是本仓钉过多次的坑族。 */
    previewId: null as string | null,
    /** 并排对比里勾选的那几套（最多两套，见 `toggleCompare`）。 */
    compareIds: [] as string[]
  }),
  getters: {
    /** 预览中了哪一套。id 查不到就当没预览——**不许兜底成某一套**，
     *  否则皮肤表改过之后，一次残留的预览会把界面刷成另一套而屏幕上没有任何人说过为什么。 */
    previewSkin(state): AppearanceSkin | null {
      if (state.previewId === null) return null;
      return appearanceSkins.find((skin) => skin.id === state.previewId) ?? null;
    },
    /** 对比栏要画的那几套（按勾选顺序）。查不到的那一条直接丢掉，同上。 */
    compareSkins(state): AppearanceSkin[] {
      return state.compareIds
        .map((id) => appearanceSkins.find((skin) => skin.id === id))
        .filter((skin): skin is AppearanceSkin => skin !== undefined);
    },
    /** 少于两套就没有「对比」可看：这一条判据只在这里有一份。 */
    isComparing(state): boolean {
      return state.compareIds.length >= 2;
    },
    /**
     * 皮肤浮层（整窗预览条 / 对比栏）此刻开着吗——Esc 裁决读这一句（5-㊷）。
     *
     * 【为什么判据是「预览中了哪套」而不是「previewId 是不是 null」】
     * id 可能在皮肤表改过之后查不到（`previewSkin` 于是为 null）。
     * 那一刻屏幕上并没有任何预览浮层，而残留的 id 还在——
     * 拿 id 判就会让一次 Esc 白吃在一个看不见的层上，而这正是本仓在 Ctrl+F 与引用菜单上
     * 各栽过一次的那一族。**看得见的那一层才算开着。**
     */
    overlayIsOpen(): boolean {
      return this.previewSkin !== null || this.isComparing;
    },
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
    /** 整窗预览：换成这一套（再点一次同一套 = 退出预览）。
     *  只做「记下 id」这一件事——刷 DOM 的那一步在 App.vue，页面与 store 都不许自己写。 */
    setPreview(id: string | null): void {
      this.previewId = id;
    },
    togglePreview(id: string): void {
      this.previewId = this.previewId === id ? null : id;
    },
    clearPreview(): void {
      this.previewId = null;
    },
    /** 勾选进对比栏。**上限两套**：超过就是三块整窗并排，每一块都窄到看不出玻璃与图案。
     *  第三枚挤掉最早那一枚（FIFO），而不是拒绝点击——拒绝点击在界面上是哑的。 */
    toggleCompare(id: string): void {
      const next = this.compareIds.includes(id)
        ? this.compareIds.filter((one) => one !== id)
        : [...this.compareIds, id].slice(-2);
      this.compareIds = next;
    },
    clearCompare(): void {
      this.compareIds = [];
    },
    /**
     * 收掉最外那一层（Esc 派到这里，5-㊷）。
     *
     * 【先退预览、后退对比】预览是「刚刚才打开的那一层」，它把整窗刷成了没落盘的样子；
     * 对比栏只是页面上的一个抽屉。Esc 一次只关一层，关的是最外那一层——
     * 这条优先级只有这一处，裁决表（escape-policy）不重复它，页面也不。
     */
    closeTopLayer(): void {
      if (this.previewSkin !== null) {
        this.previewId = null;
        return;
      }
      this.compareIds = [];
    },
    /** 离开皮肤广场：预览与对比都收干净。
     *  【为什么预览必须跟着收】预览是不落盘的临时刷写，人走了它还留在 `<html>` 上，
     *  于是屏幕上是一套、设置里是另一套——这正是本批在 `currentSkinLabel` 上刚修掉的
     *  那类「两处互相矛盾」，只不过这次矛盾的一边根本没有真身。 */
    leaveGallery(): void {
      this.previewId = null;
      this.compareIds = [];
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
