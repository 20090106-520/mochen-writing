# 任务清单 · 输入卡玻璃拟态重画（2026-10-17）

> 规范：[spec.md](./spec.md)。TDD：先写失败判据 → 再实现 → 转绿 → 真机复验 → 提交推送 → CI → README/台账。

- [x] T1 先写失败判据
  - [x] T1.1 `components/conversation-chain-wiring.test.ts`：「输入卡装饰」describe 追加 6 条设计稿断言（28px 圆角 / `--glass-highlight` / 工具条 64px / 发送键 46×46 / 圆钮 38×38 / 模板 `composer-prefix` 且 `/` 在 textarea 前）+ theme-runtime 玻璃规则断言
  - [x] T1.2 `components/composer-card-wiring.test.ts:282-293`：`.round-tool-button` 的 30px → 38px
  - [x] T1.3 `interaction.css` `.composer-chip[aria-pressed="true"]`：999px 胶囊 + `--glow-deep`/`--glow-net` 分流断言（落在 `conversation-chain-wiring.test.ts`，只留一份）
  - [x] T1.4 跑 `vitest run conversation-chain-wiring composer-card-wiring` → **确认红（7 处）**

- [x] T2 实现 · token 层
  - [x] T2.1 `styles.css` `:root` 新增 `--glass-highlight` / `--glow-deep` / `--glow-net`

- [x] T3 实现 · 主题层
  - [x] T3.1 `theme-runtime.css`：`.composer-input-surface` 已移出 `:where(...)` 组
  - [x] T3.2 `theme-runtime.css`：新增 `html[data-theme] .composer-input-surface` 玻璃规则（照 `.left-sidebar` 先例）
  - [x] T3.3 聚焦规则原样保留（`message-markdown-wiring` 仍绿）

- [x] T4 实现 · 卡片段（`styles/agent-pane.css`，`deepwrite-composer-card` 段内，零色值字面量）
  - [x] T4.1 `.composer-input-surface` 圆角 21→28 + `inset 0 1px 0 var(--glass-highlight)`（3 层 `--shadow-color` 保留）
  - [x] T4.2 新增 `.composer-input-zone` / `.composer-prefix`
  - [x] T4.3 `.composer-textarea` padding `2px 0` + `flex:1; min-width:0`（field-sizing / max-height:150px 保留）
  - [x] T4.4 `.composer-toolbar` `min-height:64px`、`gap:12px`、`padding:0 20px`（border-top / position:relative 保留）
  - [x] T4.5 `.round-tool-button` 30→38 + 玻璃底/描边/顶沿高光（50% 圆角、禁用态保留）
  - [x] T4.6 `.send-button` 30→46 + 描边/顶沿高光（neutral-solid 对与三态保留）
  - [x] 注：圆钮淡底由 `--hover` 改为 `--text` 8% —— `--hover` 是**深档**，会触发 `appearance-surface-ladder` 深档普查（实测红），而它是静态玻璃面不是状态档底

- [x] T5 实现 · 模板（`components/ComposerBox.vue`）
  - [x] T5.1 `<textarea>` 包进 `.composer-input-zone`，前插 `<span class="composer-prefix" aria-hidden="true">/</span>`

- [x] T6 实现 · chip 激活态（`styles/interaction.css`）
  - [x] T6.1 `[aria-pressed="true"]` 改胶囊 + 发光描边（底仍 `--selected`）
  - [x] T6.2 `[data-chip="thinking"]` / `[data-chip="web-search"]` 分流紫/蓝光晕

- [x] T7 判据转绿
  - [x] T7.1 两份守卫全绿（43 条通过）
  - [x] T7.2 邻近守卫 12 份全绿（193 条通过）
  - [x] T7.3 全仓 `corepack pnpm verify` 全绿：364 文件 / 4763 通过 / 2 跳过 / `VERIFY_EXIT=0`

- [x] T8 真机复验
  - [x] T8.1 `corepack pnpm build` 成功
  - [x] T8.2 CDP 量测（浅色）：surface 圆角 28px / 玻璃底 `rgba(228,240,236,.64)` + `blur(8px) saturate(1.08)` / 顶沿高光 `inset 0 1px 0 rgba(255,255,255,.55)` + 三层影 / zone 高 88 内边距 `20 22 12` / 工具条高 64 内边距 `0 20` gap 12 + 分隔线 / 发送键 46×46 / 圆钮 38×38 / `.composer-prefix` = `/`（aria-hidden）；截图目检通过
  - [x] T8.3 暗色：走应用自身「设置 → 外观 → 深色」切成真暗色后量测并截图 —— 玻璃底转 `rgb(28 51 48 / .64)`、两枚激活胶囊描边与光晕（紫 #9A7BFF / 蓝 #5AA8FF）清晰可辨、字色 `rgb(223,242,236)`、档底 `rgb(54,76,74)`；目检通过；已把外观与两枚 chip 复位为原状（浅色 / 均未按下）

- [ ] T9 收口
  - [ ] T9.1 `git commit` + `push`（feat 分支）
  - [ ] T9.2 读真实 CI（私有仓走 Windows 凭据管理器取 token 调 REST）
  - [ ] T9.3 README「## 门禁」节换绑真实读数 + `tools/readme-claims.test.mjs` 回填链注释
  - [ ] T9.4 台账 `docs/superpowers/plans/2026-10-09-full-scan-report.md` 补记第一百二十六节
  - [ ] T9.5 工作树干净、未收口项如实留档
