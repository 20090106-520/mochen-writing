/**
 * 深档底「结构普查」的**表**（2026-11-21 从 appearance-surface-ladder.test.ts 拆出）。
 *
 * 为什么拆：那份测试贴到 800 行硬门禁（`tools/check-source-line-budget.mjs`），
 * 再加一条登记就得先拆文件。按「不共享状态」切：**表是数据，律是测试**——
 * 这两半不共享任何运行期状态，拆开各自都读得懂。
 * （同仓先例：`agent-store-fixture.ts` 也是为同一件事从 useAgentStore.test.ts 里拆出来的。）
 *
 * 表里的每一格是一处「画了状态档底」的规则，四种合法形状：
 * `primary`（块自己写明正文级字色）/ `shadow`（把本族灰字 token 在这一档升档）/
 * `inheritFrom`（块不写 color，字色由同文件那条基规则带着）/ `exempt`（三类豁免之一）。
 *
 * 加新规则时改这里；改完跑那份测试，它会逐条兑现各自的判词。
 */
export type Exempt =
  | { kind: "no-text-part"; why: string }
  | { kind: "inactive-control"; why: string }
  | { kind: "accent-as-text"; why: string };

export interface SiteVerdict {
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
export interface FileSites {
  file: string;
  sites: readonly SiteVerdict[];
}

/**
 * 普查表。四种合法形状：`primary`（块自己写明字色）/ `shadow`（把本族灰字 token 在这一档升档）/
 * `inheritFrom`（块不写 color，字色由同文件那条**整串相等**的基规则带着，且它必须是正文级）/
 * `exempt`（三类豁免之一），可以同时有；但四项全空就是「画了深档底却什么都没写」。
 */
export const STATE_RUNG_SITES: readonly FileSites[] = [
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
    // 设定导入清单（2026-11-24，bible:peek）：行 hover 换 --selected 档底，块里不写 color，
    // 字色由基规则 `.bible-import-row` 的 `color: var(--text)` 带着（与上面 toggle/jump 同一形）。
    file: "styles/bible-brief.css",
    sites: [{ needle: ".bible-import-row:hover", inheritFrom: ".bible-import-row" }]
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
      { needle: ".model-select-retry:hover", shadow: ["--text-soft"] },
      /* 右栏那块菜单（2026-11-21）：菜单行与选项行，hover 换状态档底、
         字色在块里升到正文级 ⇒ primary。 */
      { needle: ".model-select-menu-row:hover", primary: true },
      /* 子菜单头那枚返回箭头：同样换状态档底，字色升到正文级。 */
      { needle: ".model-select-menu-back:hover", primary: true },
      { needle: ".model-select-option:hover", primary: true },
      /* 子菜单的键盘高亮（2026-11-24）：↕ 走档时落在的那一行，状态档底与 hover 同一档、
         字色升到正文级 ⇒ primary；「当前档 ✓」是另一枚标记，不在这里。 */
      { needle: ".model-select-option.is-active", primary: true }
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
