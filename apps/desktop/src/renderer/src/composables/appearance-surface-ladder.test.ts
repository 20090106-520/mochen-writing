/**
 * 表面阶梯与「深档底上的字色」守卫（2026-10-12，清单第 4 项「次要文字对比度」）。
 *
 * 【这一份为什么单独成文】
 * 皮肤守卫（`appearance-skins.test.ts`）量的是**页底与卡面**那两个面；
 * 这一份要量的是**整条五档阶梯**与「谁把最深那两档当底」。
 * 判据对象不同，混在一张文件里就会出现「为了测阶梯而把皮肤表读三遍」的错位。
 *
 * 【病是怎么定性的——与台账里那句话不一样，先看数字】
 * `README.md:6244` 与全扫台账 `:273` 写的是「次要文字对比度仍差 0.1–0.4，要动的是表面阶梯」。
 * 把 16 组（八套皮肤 × 明暗）逐档算完，那个诊断的**病因定位站不住**：
 *
 * 【每一格都是 16 组里的**最低值**，不是某一组的抽样】
 * 次要/第三级/正文三列的浅底最低都出自「汐 · 昼阁」，深底最低出自「书舟 · 昼渡」；
 * 只有正文那一列两半来自不同组（浅 8.47 = 灯楼 · 燃夜，深 7.60 = 汐 · 昼阁）。
 * 探针是一次性临时件（跑完即删，判据本体是这份文件），日志留在本机 `%TEMP%/m11/`：
 * `ladder-probe.log`（三列全量）/ `body-probe.log`（正文列）/ `ceiling-probe.log`（下面那两个上限）。
 *
 * | 档 | 深度（浅/深） | 次要（浅 0.71 / 深 0.72） | 第三级（浅 0.71 / 深 0.62） | 状态档灰（浅 0.78 / 深 0.80） | 正文 |
 * | --- | --- | --- | --- | --- | --- |
 * | raised | 0.018 / 0.055 | 4.94 / 6.66 | 4.94 / 5.21 | 6.11 / 7.92 | 11.09 / 11.83 |
 * | card | 0.028 / 0.075 | 4.88 / 6.30 | 4.88 / 4.94 | 6.04 / 7.50 | 10.82 / 11.20 |
 * | muted | 0.045 / 0.09 | 4.71 / 6.04 | 4.71 / 4.73 | 5.83 / 7.19 | 10.40 / 10.74 |
 * | hover | 0.085 / 0.14 | **4.38** / 5.15 | **4.38** / **4.04** | 5.41 / 6.13 | 9.28 / 9.15 |
 * | selected | 0.12 / 0.20 | **4.09** / **4.28** | **4.09** / **3.35** | 5.06 / 5.10 | 8.47 / **7.60** |
 *
 * 阶梯对**正文档**五档全过（最低 7.60，下面第一条守卫钉住 ≥ 7）——阶梯本身没病。
 * 掉线的只有「两档灰字 × 最深那两档」。而浅底没有调系数的余地：
 * 0.71 的灰要过 4.5，深度上限是 **0.068**；要留 0.2 的留量回到 4.7，上限只剩 **0.048**，
 * 而 `muted` 自己就占着 0.045，`hover` 0.085 / `selected` 0.12 都压在上限**之外**。
 * （两个上限都按「16 组里最紧的那一套」算：浅底 binding 全是「汐 · 昼阁」。
 * 深底的余量确实更大——次要 0.72 过 4.5 能忍到 0.182，但第三级 0.62 只能忍到 0.105，
 * 仍然盖不住 `selected` 的 0.20，所以这一条律深浅两边都要跑。）
 * ⇒ **「五档阶梯」与「灰字压在最深两档上达标」在浅色里不可能同时成立**，
 *   这不是把系数拧大拧小能解决的，要动的是**用法**：深档底一出现，那一块的灰字必须升档。
 *
 * 【所以本文件两条律】
 * ① 数值律：新token `--text-on-state`（浅 0.78 / 深 0.80）对**五档全部** ≥ 4.5；
 *    正文对五档 ≥ 7；次要/第三级对**四个浅档**（页底 + raised + card + muted）≥ 4.5；
 *    并**反向**钉住「次要 × selected 仍然 < 4.5」——这一条一变色就说明阶梯或字色动过，
 *    那时②那张表要重审，而不是让结构律悄悄变成装饰。
 * ② 结构律：凡是把深档（`--surface-hover` / `--surface-selected`，含别名
 *    `--hover` / `--selected` / `--hover-bg`）当背景画的规则，**必须自己写明这一档上的字色**：
 *    - 块里给 `color:`（正文级），管元素自己；**或**
 *    - shadow 本族消费的灰字 token（`--text-secondary: var(--text-on-state)` 这一行），
 *      自定义属性连着**整棵子树**一起改口——这是它比 `color:` 强的地方：
 *      `small` / `kbd` / `.xxx-hint` / `> svg` 这些后代，`color:` 一行管不到。
 *    块里**直接**写了灰字 token 的，同一条规则里就必须 shadow 那枚 token（有一条独立的普查咬这个）。
 *    剩下的只有三类豁免，每类都配一条**机器能查**的附带判据，豁免不能用来藏别的东西。
 *
 * 【普查范围是枚举出来的，不是名单】
 * `styles/*.css` 全部 + `components/*.vue` 的内联 `<style>`。
 * 手写名单正是 5-㊱/5-㊲ 漏掉整个族的原因（那两批按根类名认族，于是根类名
 * `.tool-roster-mask` 的那一枚与 `.change-history` 那一族两批都不属于）。
 * 新增一处深档底而没进 `STATE_RUNG_SITES` ⇒ 「没被唯一命中」那条直接红。
 *
 * 【这条律查不到的那一半，写清楚】
 * 块里没写 `color:`、族里也没有灰字 token 的「继承正文档」情形，静态 CSS 判不出来——
 * 后代选择器不必然带上父类名（`.context-meter-kind` 就不含 `.context-meter-list`），
 * 谁坐在谁上面是**模板**决定的，不是样式表决定的。
 * 所以下表每条的 `shadow` 名单是逐族对着模板与样式核过的判定，
 * 逐条理由与当时的普查快照（**77 处深档底规则 / 19 个文件**）记在
 * `docs/superpowers/plans/2026-10-09-full-scan-report.md` §二十九。
 * **判据本体是这份文件自己**：那张名单每次跑都是从盘上枚举出来的，不依赖任何外部快照，
 * 也没有另留一份探针脚本——留一份和表并行演化的脚本只会变成第二件要人记得同步的东西。
 * 漏核一个新族仍然可能——那一族的**块**会因为没进表而红，
 * 只是红的原因会是「没写明字色」，而不是「少 shadow 了某个名字」。
 */
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cssRules,
  listComponentFiles,
  scopedStyleSource,
  strippedStyleSource,
  vueSource
} from "../utils/vue-source-reader";
import { appearanceSkins } from "./appearanceSkins";
import {
  ON_STATE_TEXT_MIX,
  SECONDARY_TEXT_MIX,
  SURFACE_LADDER_MIX,
  TERTIARY_TEXT_MIX,
  contrastRatio,
  mixHex
} from "./appearanceThemeRuntime";

/** 最深那两档 = 状态档；别名（`--hover` / `--selected` / `--hover-bg`）最终都指向同一枚，一并算。 */
const DEEP_TOKENS = [
  "--surface-hover",
  "--surface-selected",
  "--hover",
  "--selected",
  "--hover-bg"
] as const;
/** 灰字家族的全部名字：三枚正主 + 三枚别名。别名在 `:root` 就算成了具体颜色，所以只能按名字逐个 shadow。 */
const DIM_TOKENS = [
  "--text-secondary",
  "--text-tertiary",
  "--text-muted",
  "--text-dim",
  "--text-soft",
  "--text-faint"
] as const;
/**
 * 「失活控件」的形状判据：先把 `:not(...)` 整段摘掉再看剩下什么。
 * `.save-button:disabled` 是 WCAG 1.4.3 Incidental 例外点名的 inactive control；
 * `.x:hover:not(:disabled)` 里那个 `:disabled` 只是「没失活时才 hover」的守卫，
 * 裸匹配 `:disabled` 会把后者也放过——第一版就是这么漏掉了 `.model-picker-refresh:hover`。
 */
const inactiveControl = (selector: string): boolean =>
  /:disabled|aria-disabled|readonly/.test(selector.replace(/:not\([^)]*\)/g, ""));

/** 块里写了这些 `color:` 之一 = 「这一档上的字色我自己负责」，机器可查。 */
const PRIMARYISH_COLORS = [
  "var(--text-primary",
  "var(--text)",
  "var(--text-on-state",
  "var(--neutral-solid)",
  "var(--neutral-solid-contrast",
  "var(--accent-contrast"
] as const;

type Exempt =
  | { kind: "no-text-part"; why: string }
  | { kind: "inactive-control"; why: string }
  | { kind: "accent-as-text"; why: string };

interface SiteVerdict {
  /** 唯一命中一条规则的针串（在**该文件内**唯一）。 */
  needle: string;
  /** 块里必须出现的 `--text-*: var(--text-on-state)` shadow 名单。 */
  shadow?: readonly string[];
  /** 块自己写明正文级字色。 */
  primary?: boolean;
  /**
   * 块自己不写 `color:`，字色从**同文件那条基规则**继承而来。
   *
   * 这不是放宽：`inheritFrom` 必须给出那条基规则的针串，律会去查它**确实**声明了
   * 一枚正文级 `color:`。`.permission-option:hover` 就是这一形——hover 只换底，
   * 字色由 `.permission-option { color: var(--text) }` 带着；把它写成 `primary: true`
   * 是谎报（块里没有 color），把它改成再声明一遍 `color` 是第五份同义声明。
   */
  inheritFrom?: string;
  exempt?: Exempt;
}
interface FileSites {
  file: string;
  sites: readonly SiteVerdict[];
}

/**
 * 普查表。四种合法形状：`primary`（块自己写明字色）/ `shadow`（把本族灰字 token 在这一档升档）/
 * `inheritFrom`（块不写 color，字色由同文件那条**整串相等**的基规则带着，且它必须是正文级）/
 * `exempt`（三类豁免之一），可以同时有；但四项全空就是「画了深档底却什么都没写」。
 */
const STATE_RUNG_SITES: readonly FileSites[] = [
  /* 欢迎首页胶囊（2026-11-09 参考图）：hover 换的是 --hover 状态档底，块里自己写了
   --text-primary 字色 ⇒ primary，不靠基规则带。新族登记在此，别绕开结构律。
   （2026-11-20 C4 的 .is-resume 高亮胶囊底是 color-mix(--focus)——不在 DEEP_TOKENS
   里，不进普查；它的基规则与 hover 都自己写了正文级字色。） */
  {
    file: "styles/welcome-home.css",
    sites: [{ needle: ".welcome-shortcut:hover", primary: true }]
  },
  {
    file: "styles/toast.css",
    sites: [
      /* 2026-11-20 通知整修 C5：排队徽章 hover 换 --hover 档底，块里自己写了正文级字色。 */
      { needle: ".toast-queue-badge:hover", primary: true }
    ]
  },
  {
    file: "styles/notification-center.css",
    sites: [
      /* 2026-11-20 通知整修 A2 的四条状态档底。行 hover 与 conversation-history-item:hover
       同一手法（族内两档灰字在本档升到状态档专用字色）；头部两枚文字钮与行尾删除钮
       块里自己写了正文级字色 ⇒ primary。 */
      { needle: ".notification-center-item:hover", shadow: ["--text-soft", "--text-faint"] },
      { needle: ".notification-center-head-button:hover", primary: true },
      {
        needle: ".notification-center-head-actions > button[aria-label]:hover",
        primary: true
      },
      { needle: ".notification-center-remove:hover", primary: true }
    ]
  },
  {
    file: "styles/agent-pane.css",
    sites: [
      { needle: ".card-turn", primary: true },
      /* 2026-11-10：消息操作条那几枚小字钮从「只改字色」改成带悬停底（命中区 19 → 24px，
         见 agent-pane.css 那段注释）。底是 hover 档，字色同时升到正文级。 */
      { needle: ".message-action:hover", primary: true },
      { needle: ".proposal-mode", primary: true },
      { needle: ".proposal-buttons button:hover", primary: true },
      { needle: ".round-tool-button:hover", primary: true },
      { needle: ".composer-reference-trigger", primary: true },
      { needle: ".composer-reference-options button:hover", shadow: ["--text-faint"] },
      { needle: ".composer-context-item:hover", shadow: ["--text-tertiary"] },
      { needle: ".composer-context-item:active", shadow: ["--text-tertiary"] },
      { needle: ".context-picker-close:hover", shadow: ["--text-tertiary"] },
      { needle: ".context-option:hover", shadow: ["--text-secondary", "--text-tertiary"] },
      /* 阶段选择的键盘高亮（2026-10-25）：↑↓ 改的是高亮不是真焦点，与 hover 同一块、同样的升档。 */
      { needle: ".context-option.is-selected", shadow: ["--text-secondary", "--text-tertiary"] },
      { needle: ".context-option:active", shadow: ["--text-secondary", "--text-tertiary"] },
      /* 「更多」二级选项卡（2026-11-09 四组统一打开方式）：标题图标自带深底并写明字色；
         行 hover / 键盘高亮换的是 --selected 档，块里把本族两档灰字升成 --text-on-state。 */
      { needle: ".composer-sheet-icon", primary: true },
      {
        needle: ".composer-sheet-option:hover:not(:disabled)",
        shadow: ["--text-soft", "--text-faint"]
      }
    ]
  },
  {
    file: "styles/change-history.css",
    sites: [
      { needle: ".change-history-row:hover", shadow: ["--text-dim"] },
      // 逐行对比那两颗次级按钮（2026-10-13）：`:hover` 只换底，字色由各自基规则声明的
      // `color: var(--text)` 带着 —— 与 `.permission-option:hover` 同一形，不是 primary（块里没有 color）。
      { needle: ".change-history-toggle:hover", inheritFrom: ".change-history-toggle" },
      { needle: ".change-history-jump:hover", inheritFrom: ".change-history-jump" }
    ]
  },
  {
    file: "styles/context-meter.css",
    sites: [
      { needle: ".context-meter-list li.is-active", shadow: ["--text-tertiary"] },
      /* 2026-11-20：占用读数搬去状态栏之后的那一枚（`.context-meter--compact`）。
         hover/展开态换的是 hover 档底，块里自己写了正文级字色 ⇒ primary。 */
      { needle: ".context-meter--compact:hover", primary: true }
    ]
  },
  {
    file: "styles/conversation-history.css",
    sites: [
      { needle: ".conversation-history-panel > header > button:hover", primary: true },
      {
        needle: ".conversation-history-item:hover",
        shadow: ["--text-secondary", "--text-tertiary"]
      },
      {
        needle: ".conversation-history-item.is-current",
        shadow: ["--text-secondary", "--text-tertiary"]
      }
    ]
  },
  {
    file: "styles/conversation-pane.css",
    sites: [
      { needle: ".icon-button:hover", primary: true },
      { needle: ".header-text-button:hover", primary: true },
      { needle: ".header-text-button.is-active", primary: true },
      { needle: ".workbench-card:hover", shadow: ["--text-tertiary"] }
    ]
  },
  {
    file: "styles/dialog.css",
    sites: [
      { needle: ".dialog-close:hover", primary: true },
      { needle: ".appearance-segment-button:hover", primary: true },
      /* 2026-11-20 新建作品智能刀：「沿用」那枚小钮的悬停底换的是 hover 档，
         字色同时升到正文级（primary）。 */
      { needle: ".new-book-remembered-button:hover", primary: true },
      /* 2026-11-20 模型对话框重排：供应商卡片与高级区 summary 的悬停底是 hover 档，
         两块里都自己写了正文级字色（primary）。 */
      { needle: ".provider-card:hover", primary: true },
      { needle: ".provider-advanced > summary:hover", primary: true },
      {
        needle: ".appearance-toggle",
        exempt: {
          kind: "no-text-part",
          why: "34×20 的开关轨道本体，块里没有也从来不需要字色：它归 WCAG 1.4.11（非文字组件 3:1），轨道是实心灰，看得见"
        }
      }
    ]
  },
  {
    file: "styles/editor-pane.css",
    sites: [
      /* `.format-button:disabled` 那两枚是**同一个元素**的失活态，不是后代，所以这里不需要 shadow。 */
      { needle: ".format-button:hover", primary: true },
      {
        /* 这里原先是 `accent-as-text` 豁免：accent 当字色压在 selected 档上，浅底 6/8 套不到 4.5
           （最低 灯楼 · 晴昼 3.42）。2026-10-17 按 §七十五 的口径修掉——字色改回正文级，
           选中态靠「selected 那层底 + 正文级字色」与未选中（透明底 + 二次灰）拉开，
           判据仍只有这一条（铁律 6：不立第二份）。 */
        needle: ".format-button.is-active",
        primary: true
      },
      {
        needle: ".save-button:disabled",
        exempt: {
          kind: "inactive-control",
          why: "WCAG 1.4.3 的 Incidental 例外明文覆盖 inactive user-interface control 里的字：「已在保存 / 无改动」那两态"
        }
      }
    ]
  },
  {
    file: "styles/extensions.css",
    sites: [{ needle: ".extensions-filter.is-active", primary: true }]
  },
  {
    file: "styles/foreshadow.css",
    sites: [{ needle: ".foreshadow-row:hover", shadow: ["--text-dim"] }]
  },
  {
    /* 素材库浮层（2026-10-23）：条目悬停在自绘底（`.material-entry` 已有 surface-dim 底）上，
       所以走 inheritFrom；条目里那行字数是从句色（--text-dim），压在状态档底上按 shadow 登记。
       动作条那两枚底是透明的，hover 才上底色 ⇒ primary。 */
    file: "styles/material-panel.css",
    sites: [
      { needle: ".material-entry:hover", inheritFrom: ".material-entry", shadow: ["--text-dim"] },
      { needle: ".material-action:hover:not(:disabled)", primary: true }
    ]
  },
  {
    /* 页面说明折叠条的标题行（2026-11-12）。基规则用的是 `--text-secondary`（三级灰压页底才达标），
       压到 hover 这一档就不够了，所以 hover 块里自己写明 `color: var(--text)` ⇒ primary。
       它是一条**可点的标题**而不是行内小字：不需要 shadow 升档，直接吃正文级字色。 */
    file: "styles/page-note.css",
    sites: [{ needle: ".page-note-summary:hover", primary: true }]
  },
  {
    file: "styles/interaction.css",
    sites: [
      { needle: ".permission-option:hover", inheritFrom: ".permission-option" },
      { needle: ".permission-option.is-current", inheritFrom: ".permission-option" },
      /* 权限档的键盘高亮（2026-10-25）：↑↓ 改的是高亮不是真焦点，这一格自己画了状态档底。
         形状与 hover 同一形——字色由基规则 `.permission-option` 带着。 */
      { needle: ".permission-option.is-selected", inheritFrom: ".permission-option" },
      { needle: ".composer-chip:hover", primary: true, shadow: ["--text-faint"] },
      { needle: '.composer-chip[aria-pressed="true"]', primary: true, shadow: ["--text-faint"] },
      { needle: ".model-select-row:hover", inheritFrom: ".model-select-row" },
      /* 2026-11-20 第二刀：当前行改回「浅灰底 + 粗体」（用户给的参考图同款），--selected 档、字色随基规则。 */
      { needle: ".model-select-row.is-current", inheritFrom: ".model-select-row" },
      /* 键盘高亮那一格（2026-10-25）：↑↓ 走的是高亮而不是真焦点，「指着哪一行」自己也画了状态档底；
         字色由基规则 `.model-select-row` 带着。类名从 is-active 改成 is-selected：这一族浮层
         （模型选择器 / 权限档 / 阶段选择 / @ 引用菜单）统一用同一枚词，各叫各的正是「不一致」的来源。 */
      { needle: ".model-select-row.is-selected", inheritFrom: ".model-select-row" },
      /* 模态标记（2026-10-22）：只有图像/视频模型会渲染出来的小药丸，底是 --hover。 */
      { needle: ".model-select-tag", primary: true },
      { needle: ".model-select-retry:hover", shadow: ["--text-soft"] }
    ]
  },
  {
    file: "styles/left-nav.css",
    sites: [
      {
        /* 这里原先是 `accent-as-text` 豁免：本层 (0,2,0) 覆写掉 theme-runtime.css 那条本意给它
           正文色的 `:where()`，浅底 6/8 套不到 4.5（实测 16 组里 9 组不达标，最低 3.42）。
           2026-10-15 修掉（台账 §七十五）：字色改回正文级，accent 只留在下面那条 `svg` 上
           （非文本，按 3:1 线）。同一天 §七十六把 `kbd` 那枚 shadow 也撤了——`.nav-row kbd`
           全仓一个元素也匹配不到，留着只是让守卫以为还有东西要护。 */
        needle: ".nav-row.is-active",
        primary: true
      },
      { needle: ".nav-subrow:hover", primary: true, shadow: ["--text-tertiary"] },
      { needle: ".nav-row:hover", primary: true, shadow: ["--text-secondary"] },
      {
        needle: ".section-toggle:hover",
        inheritFrom: ".section-toggle",
        shadow: ["--text-tertiary"]
      },
      { needle: ".tree-node-action-menu-item:hover", primary: true, shadow: ["--text-secondary"] },
      { needle: ".tree-row:hover", primary: true, shadow: ["--text-secondary"] },
      { needle: ".tree-row.is-selected", primary: true, shadow: ["--text-secondary"] },
      { needle: ".section-add:hover", primary: true },
      { needle: ".tree-add-confirm:hover", primary: true },
      // 统计对话框的行悬停（2026-10-14 收编）：本地线加的规则没进普查表——合并时两线各写了半边。
      { needle: ".stats-table tr.is-openable:hover td", primary: true }
    ]
  },
  {
    file: "styles/settings-page.css",
    sites: [
      { needle: ".settings-back:hover", primary: true },
      { needle: ".settings-search", shadow: ["--text-faint"] },
      { needle: ".settings-action-button:hover", primary: true },
      { needle: ".agent-mode-card:hover", shadow: ["--text-soft"] },
      { needle: ".provider-profile-icon", primary: true },
      {
        needle: ".provider-profile-menu button:hover",
        inheritFrom: ".provider-profile-menu button"
      },
      { needle: ".provider-connection-tag", primary: true },
      /* 模态标记（2026-10-22）：设置页只在图像/视频模型上渲染的小药丸，底是 --hover。 */
      { needle: ".provider-profile-tag", primary: true },
      { needle: ".provider-verify", primary: true },
      { needle: ".model-picker-count", primary: true },
      { needle: ".model-picker-refresh:hover", primary: true },
      { needle: ".model-picker-item:hover", primary: true }
    ]
  },
  {
    /* `.skin-filter-label` 是**兄弟**不是后代（它是筛选行左边那枚标签），所以 is-active 只需管自己。 */
    file: "styles/skin-gallery.css",
    sites: [
      { needle: ".skin-filter.is-active", primary: true },
      /* 2026-11-12：五层筛选收进折条之后，条件生效时那枚胶囊自己也画 selected 档底
         （不打开折条也能看出「现在不是全量」）。它与档同形，同样自带字色。 */
      { needle: ".skin-filter-fold-summary.is-active", primary: true }
    ]
  },
  {
    file: "styles/theme-runtime.css",
    /* 主题层自己也在普查范围内——它那条 `:where()` 只保元素自己，后代照样漏。 */
    sites: [
      { needle: ".brand-button:hover", primary: true },
      { needle: ".nav-row.is-active, .tree-row.is-selected", primary: true },
      {
        /* 原先挂 `accent-as-text` 豁免，理由写「暗色下危险项的字色是 danger」。2026-10-17 改成自证
           正文级（台账 §一百一十九）：字压状态档底 ⇒ 正文级（口径同 §七十五 / §一百一十六），
           危险身份交给**非文本**——图标 `.is-danger > svg { color: var(--danger) }`
           （`styles/left-nav.css:539-541`，按 3:1 线）与那条底色的 danger 色调。 */
        needle: ".tree-node-action-menu-item.is-danger:hover",
        primary: true
      },
      /* 带完整前缀才唯一：`.view-tabs button.is-active` 这串在上面那条 `:where()` 里也出现一次。 */
      { needle: "html[data-theme] .view-tabs button.is-active", primary: true },
      {
        /* 2026-11-10：针串从 `.send-button:disabled` 改成 `.save-button:disabled`——
           发送键的失活态不再画 selected 档底（改成空环，见 theme-runtime.css 那条注释），
           而 `.save-button:disabled` 仍是实心钮、仍画这一档。 */
        needle: ".save-button:disabled",
        exempt: {
          kind: "inactive-control",
          why: "同 `.send-button:disabled`：主题层给这两枚失活态定的就是 selected + tertiary，属 1.4.3 Incidental 例外"
        }
      }
    ]
  },
  {
    /* 作品工作项面板（2026-10-25 · §174）：左栏常驻的那一列。
       三处状态档底与「历史对话」浮层那两枚同一形——行里有一枚副行与一枚右格是三级灰，
       压在底上要升档（结构律 ②）。组头那枚的组名是次要灰、数字与图标是三级灰，两枚都要。 */
    file: "styles/work-items.css",
    sites: [
      { needle: ".work-items-group-head:hover", shadow: ["--text-secondary", "--text-tertiary"] },
      {
        needle: ".work-items-row:hover:not(:disabled)",
        shadow: ["--text-secondary", "--text-tertiary"]
      },
      {
        needle: ".work-items-row.is-current",
        primary: true,
        shadow: ["--text-secondary", "--text-tertiary"]
      }
    ]
  },
  {
    file: "components/ExportDialog.vue",
    sites: [{ needle: ".export-no-selection", primary: true }]
  },
  {
    file: "components/FindReplacePanel.vue",
    sites: [
      { needle: ".find-toggle:hover", primary: true },
      {
        /* 同 `.format-button.is-active`（见 styles/editor-pane.css 那一组）：原先是
           `accent-as-text` 豁免，accent 当字色压在 selected 档上；2026-10-17 字色改回正文级，
           accent 只留在边框上（非文本，按 3:1 线）。 */
        needle: ".find-toggle.is-active",
        primary: true
      },
      { needle: ".find-nav-btn:hover", primary: true },
      { needle: ".find-nav-btn:active", primary: true },
      { needle: ".find-close-btn:hover", primary: true },
      { needle: ".find-action-btn--muted:hover", primary: true },
      { needle: ".find-undo-btn:hover", primary: true }
    ]
  },
  {
    file: "components/OutlinePanel.vue",
    sites: [
      { needle: ".outline-close:hover", primary: true },
      { needle: ".outline-toolbar-btn:hover", primary: true },
      { needle: ".outline-section-head:hover", shadow: ["--text-tertiary"] },
      {
        needle: ".outline-node-row:hover",
        primary: true,
        shadow: ["--text-secondary", "--text-muted"]
      }
    ]
  },
  {
    file: "components/ProjectSettingsPanel.vue",
    sites: [{ needle: ".settings-btn:hover", inheritFrom: ".settings-btn" }]
  }
];

interface FoundBlock {
  file: string;
  selector: string;
  body: string;
  colors: string[];
}

/**
 * 枚举 `styles/*.css` + `components/*.vue` 内联 `<style>` 里的**全部**规则。
 * 全量而不是只留深档那几条，是因为 `inheritFrom` 那一型要找的基规则
 * （`.permission-option`、`.provider-profile-menu button`）本来就画在透明底上，
 * 只留深档的话它永远不在表里。
 */
function collectBlocks(): FoundBlock[] {
  const out: FoundBlock[] = [];
  const push = (file: string, css: string): void => {
    for (const rule of cssRules(css)) {
      const selector = rule.selector.replace(/\s+/g, " ").trim();
      const body = rule.body;
      if (selector === "" || selector.startsWith("@")) continue;
      out.push({
        file,
        selector,
        body,
        colors: [...body.matchAll(/(?:^|[^-\w])color:\s*([^;]+)/g)].map((m) => (m[1] ?? "").trim())
      });
    }
  };
  for (const name of readdirSync(new URL("../styles/", import.meta.url))
    .filter((n) => n.endsWith(".css"))
    .sort()) {
    push(`styles/${name}`, strippedStyleSource(name));
  }
  /* 内联样式只取**第一个** `<style>` 块（`scopedStyleSource` 那一枚）。本仓带样式的 SFC 都只有一个块；
     真出现第二个块时这里会漏，而漏的方向是「少普查」不是「假绿」——
     少普查的那一条规则会因为不在表里而先让上面那条 `toEqual([])` 红。 */
  for (const path of listComponentFiles()) {
    if (!vueSource(path).includes("<style")) continue;
    push(path, scopedStyleSource(path));
  }
  return out;
}

/** 这条规则是不是「拿状态档（hover / selected）当底」。 */
const paintsDeepRung = (body: string): boolean =>
  [...body.matchAll(/background(?:-color)?:\s*([^;]+)/g)].some((m) =>
    DEEP_TOKENS.some((t) => (m[1] ?? "").includes(`var(${t}`))
  );

const ALL_BLOCKS = collectBlocks();
const BLOCKS = ALL_BLOCKS.filter((b) => paintsDeepRung(b.body));
const siteLabel = (file: string, site: SiteVerdict): string => `${file} :: ${site.needle}`;
const blocksFor = (file: string, needle: string): FoundBlock[] =>
  BLOCKS.filter((b) => b.file === file && b.selector.includes(needle));
const describeBlocks = (blocks: FoundBlock[]): string =>
  blocks
    .map((b) => `${b.file} :: ${b.selector}`)
    .sort()
    .join("\n  ");

describe("表面阶梯 · 数值律（16 组 = 八套皮肤 × 明暗，全部按应用自己那一份算）", () => {
  const rungs = Object.keys(SURFACE_LADDER_MIX) as Array<keyof typeof SURFACE_LADDER_MIX>;
  const surface = (
    skin: (typeof appearanceSkins)[number],
    scheme: "light" | "dark",
    rung: keyof typeof SURFACE_LADDER_MIX
  ): string =>
    mixHex(skin[scheme].background, skin[scheme].foreground, SURFACE_LADDER_MIX[rung][scheme]);

  it("两张表都非空（空表会让下面每一条变成「一条没测也全绿」）", () => {
    expect(appearanceSkins.length, "皮肤表空了").toBeGreaterThan(0);
    const pinned = STATE_RUNG_SITES.reduce((n, g) => n + g.sites.length, 0);
    expect(pinned, "普查表空了 = 结构律没在管任何一处").toBeGreaterThan(0);
    expect(BLOCKS.length, "一处深档底都没枚举到 = 普查器坏了，不是好消息").toBeGreaterThan(0);
  });

  it("正文 × 五档 全部 ≥ 7:1 —— 阶梯本身没病，别回来把阶梯砍了", () => {
    for (const skin of appearanceSkins) {
      for (const scheme of ["light", "dark"] as const) {
        for (const rung of rungs) {
          const r = contrastRatio(skin[scheme].foreground, surface(skin, scheme, rung));
          expect(
            r,
            `${skin.label} · ${scheme}：正文 / ${rung}(${SURFACE_LADDER_MIX[rung][scheme]}) 只有 ${r.toFixed(2)}:1`
          ).toBeGreaterThanOrEqual(7);
        }
      }
    }
  });

  it("次要与第三级 × 四个浅档（页底 / raised / card / muted）≥ 4.5:1", () => {
    for (const skin of appearanceSkins) {
      for (const scheme of ["light", "dark"] as const) {
        for (const [name, mix] of [
          ["次要", SECONDARY_TEXT_MIX],
          ["第三级", TERTIARY_TEXT_MIX]
        ] as const) {
          const text = mixHex(skin[scheme].background, skin[scheme].foreground, mix[scheme]);
          const onPage = contrastRatio(text, skin[scheme].background);
          expect(
            onPage,
            `${skin.label} · ${scheme}：${name}文字 ${text} / 页底 只有 ${onPage.toFixed(2)}:1`
          ).toBeGreaterThanOrEqual(4.5);
          for (const rung of ["raised", "card", "muted"] as const) {
            const r = contrastRatio(text, surface(skin, scheme, rung));
            expect(
              r,
              `${skin.label} · ${scheme}：${name}文字 ${text} / ${rung}(${SURFACE_LADDER_MIX[rung][scheme]}) 只有 ${r.toFixed(2)}:1`
            ).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  });

  it("状态档灰 `--text-on-state` × 五档全部 ≥ 4.5:1（浅 0.78 / 深 0.80 是量出来的）", () => {
    for (const skin of appearanceSkins) {
      for (const scheme of ["light", "dark"] as const) {
        const text = mixHex(
          skin[scheme].background,
          skin[scheme].foreground,
          ON_STATE_TEXT_MIX[scheme]
        );
        const onPage = contrastRatio(text, skin[scheme].background);
        expect(
          onPage,
          `${skin.label} · ${scheme}：状态档灰 ${text} / 页底 只有 ${onPage.toFixed(2)}:1`
        ).toBeGreaterThanOrEqual(4.5);
        for (const rung of rungs) {
          const r = contrastRatio(text, surface(skin, scheme, rung));
          expect(
            r,
            `${skin.label} · ${scheme}：状态档灰 ${text} / ${rung}(${SURFACE_LADDER_MIX[rung][scheme]}) 只有 ${r.toFixed(2)}:1`
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  /**
   * 反向：钉住「灰字压在 selected 档上**就是**不到线」这个前提。
   * 它一红，说明有人把灰字调深了或把阶梯砍浅了——那时②那张普查表要重审，
   * 而不是让结构律悄悄变成装饰。这一条的变异自证是 M9（台账 §二十九）：
   * `SECONDARY_TEXT_MIX` **两半一起**拧到 0.9 才红（报「汐 · 昼阁 · dark：… 已经到 6.30:1」）；
   * 只拧浅底那一半**不会红**，因为 `worst` 取的是 16 组最低，深底 0.72 那一半还压在 4.28。
   * 所以将来谁要拿这条当"改字色的门禁"，记得它看的是两半里的最紧者，不是一半。
   */
  it("前提仍在：次要 × selected 档对**最紧那一套**皮肤 < 4.5:1（否则结构律要重审）", () => {
    let worst = { r: 99, at: "" };
    for (const skin of appearanceSkins) {
      for (const scheme of ["light", "dark"] as const) {
        const r = contrastRatio(
          mixHex(skin[scheme].background, skin[scheme].foreground, SECONDARY_TEXT_MIX[scheme]),
          surface(skin, scheme, "selected")
        );
        if (r < worst.r) worst = { r, at: `${skin.label} · ${scheme}` };
      }
    }
    expect(
      worst.r < 4.5,
      `${worst.at}：次要 × selected 已经到 ${worst.r.toFixed(2)}:1 —— 阶梯或字色动过，请重审 STATE_RUNG_SITES 与头上那张表`
    ).toBe(true);
  });
});

describe("深档底 · 结构普查（画了状态档底就得自己写明字色，否则红）", () => {
  it("每一处深档底都被普查表**唯一**命中；表里每条针串也仍找得到规则", () => {
    /* 针串打平成「文件 + 串」一对，再问每一条块有没有被**自己那个文件**的针串接住。
       早先这里写成 `flatMap((g) => g.sites).every((s) => g.file ...)`——`g` 在 `every` 里
       早就出了作用域，vitest 直接 `g is not defined`。那是一种很坏的绿：普查律整个没跑。 */
    const pins = STATE_RUNG_SITES.flatMap((g) =>
      g.sites.map((s) => ({ file: g.file, needle: s.needle }))
    );
    const notCovered = BLOCKS.filter(
      (b) => !pins.some((p) => p.file === b.file && b.selector.includes(p.needle))
    );
    expect(
      notCovered.map((b) => `${b.file} :: ${b.selector}`).sort(),
      "这些深档底规则没进普查表（新族没登记）"
    ).toEqual([]);

    /* 「针串已经找不到规则」那一半**不在这里单列**：早先写过一行
       `BLOCKS.filter((b) => blocksFor(b.file, b.selector).length === 0)`，那是拿**块自己的选择器**
       当针串去查自己——恒等于 1 条，永远不会红，属于装饰。真正咬这一半的是下面 `ambiguous`
       里的 `n !== 1`：改了选择器或删了声明 ⇒ 命中 0 条 ⇒ 同样在这里红。
       变异跑过：往表里塞一条不存在的针串，本条以 `{ n: 0 }` 红。 */
    const ambiguous = STATE_RUNG_SITES.flatMap((g) =>
      g.sites
        .map((s) => ({ label: siteLabel(g.file, s), n: blocksFor(g.file, s.needle).length }))
        .filter((r) => r.n !== 1)
    );
    expect(ambiguous, "针串要么命中 0 条要么命中多条，必须在那一个文件里唯一").toEqual([]);
  });

  it("表里每一条都兑现自己的判词", () => {
    for (const group of STATE_RUNG_SITES) {
      for (const site of group.sites) {
        const label = siteLabel(group.file, site);
        const [block] = blocksFor(group.file, site.needle);
        if (block === undefined) throw new Error(`${label}：找不到规则，普查器或针串坏了`);
        expect(
          site.shadow !== undefined ||
            site.primary === true ||
            site.inheritFrom !== undefined ||
            site.exempt !== undefined,
          `${label}：判词四项全空 = 「画了深档底却什么都没写」`
        ).toBe(true);

        if (site.inheritFrom !== undefined) {
          /* 基规则按**整条选择器相等**找，不按子串：`.provider-profile-menu button`
             是 `.provider-profile-menu button:hover` 的子串，用子串会同时命中两条，
             而这里要的正是「那条不带状态伪类的规则」。 */
          const bases = ALL_BLOCKS.filter(
            (b) => b.file === group.file && b.selector === site.inheritFrom
          );
          expect(
            bases.length,
            `${label}：判词说字色继承自 ${site.inheritFrom}，那条基规则在本文件命中 ${bases.length} 条（要正好 1 条）`
          ).toBe(1);
          expect(
            bases[0]!.colors.some((c) => PRIMARYISH_COLORS.some((p) => c.startsWith(p))),
            `${label}：基规则 ${site.inheritFrom} 里没有正文级 color，继承过来的还是灰字`
          ).toBe(true);
        }

        if (site.primary === true) {
          expect(
            block.colors.some((c) => PRIMARYISH_COLORS.some((p) => c.startsWith(p))),
            `${label}：判词说要写明正文级字色，块里的 color 是 ${block.colors.join(" / ") || "（没有）"}`
          ).toBe(true);
        }
        for (const token of site.shadow ?? []) {
          expect(
            block.body.includes(`${token}: var(--text-on-state)`),
            `${label}：少了 ${token}: var(--text-on-state) —— 本族的灰字压在这档上会掉出 AA`
          ).toBe(true);
        }

        /* 三类豁免各配一条机器能查的附带判据：豁免不能顺手用来藏别的东西。 */
        if (site.exempt !== undefined) {
          expect(
            site.exempt.why.length,
            `${label}：豁免必须写清理由，否则半年后没人敢删`
          ).toBeGreaterThan(20);
          if (site.exempt.kind === "no-text-part") {
            expect(block.colors, `${label}：说要算无字部件，可块里写了 color`).toEqual([]);
          }
          if (site.exempt.kind === "inactive-control") {
            expect(
              inactiveControl(block.selector),
              `${label}：说要算失活控件例外，可选择器里没有失活形状`
            ).toBe(true);
          }
          if (site.exempt.kind === "accent-as-text") {
            expect(
              block.colors.length === 0 ||
                block.colors.some((c) => /var\(--(accent|danger|warning|success)/.test(c)),
              `${label}：说要算「强调色当字色」，可块里的 color 是 ${block.colors.join(" / ")}`
            ).toBe(true);
          }
        }
      }
    }
  });

  /**
   * 独立咬一遍「块自己把灰字写在 color 上」这一族：三种豁免都不该被它钻空子。
   * 这类写法必须与 shadow 同块出现——否则 `color: var(--text-soft)` 配 `--text-soft: var(--text-on-state)`
   * 是同一条声明里的两半，拆开任何一半都还是掉线状态。
   *
   * **只有失活控件这一类在这里也被跳过**，而且跳过条件不查普查表、只看选择器：
   * `:disabled` / `[aria-disabled]` / `[readonly]` 是 WCAG 1.4.3 Incidental 例外点名的
   * inactive user-interface control，写成选择器形状就能机器认出。
   * 另两类豁免（无字部件、accent 当字色）**不**被这条律跳过——那条律看的是「块里有没有灰字」，
   * 无字部件的块本来就没有 `color:`，accent 族的 `color:` 也不是灰字 token，天然不会被咬到。
   */
  it("块内直接写灰字 token 的，同一条规则里就得 shadow 那枚 token", () => {
    const offenders = BLOCKS.filter((b) => {
      /* 用的是头上那枚会先摘 `:not(...)` 的判据，不是本地再抄一份裸正则：
         `.x:hover:not(:disabled)` 里那个 `:disabled` 只是「没失活才 hover」的守卫，
         裸正则会把它当成失活控件放过，而这一档底**是真的**。 */
      if (inactiveControl(b.selector)) return false;
      return b.colors.some((c) => {
        const token = DIM_TOKENS.find((d) => c.startsWith(`var(${d}`));
        return token !== undefined && !b.body.includes(`${token}: var(--text-on-state)`);
      });
    }).map((b) => `${b.file} :: ${b.selector} → ${b.colors.join(" / ")}`);
    expect(
      offenders.sort(),
      "深档底 + 块内灰字而没有同块 shadow：要么 shadow 那枚 token，要么把 color 改成 var(--text-on-state)"
    ).toEqual([]);
  });

  it("`--text-on-state` 有真消费者（普查表一条 shadow 都没有 = 这条律是空的）", () => {
    const consumed = STATE_RUNG_SITES.reduce(
      (n, g) => n + g.sites.reduce((m, s) => m + (s.shadow?.length ?? 0), 0),
      0
    );
    expect(consumed).toBeGreaterThan(0);
    const shadowed = BLOCKS.filter((b) => b.body.includes("var(--text-on-state)"));
    expect(
      shadowed.length,
      `样式表里一处都没 shadow（${describeBlocks(shadowed)}）`
    ).toBeGreaterThan(0);
  });
});
