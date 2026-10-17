# 输入卡照「玻璃拟态梦幻版 AI 输入框」设计稿重画（2026-10-17）

## 一、这一刀要收的是什么

用户上传设计稿 `design.html`（标题「玻璃拟态梦幻版 AI 输入框 · agnes-3.0-flash」）并给出指令逐字：

> 「用这个对话框」

目标：把墨宸 AI 底部那张输入卡（`.composer-wrap / .composer / .composer-input-surface`）
改成设计稿的**玻璃拟态**观感与结构。用户此前已连续裁定同一条方向
（「输入卡装饰差」「对话框的装饰感觉不太行」），项目记忆明确「明确指令后直接落地、不反复询问」。

**明确不做的部分（边界）**：设计稿的极光渐变背景、漂浮光斑、星点、地面反光、toast
都是**演示页画布**，不是组件本体。本仓的背景归「皮肤广场」（`appearanceSkins` / `appearanceSkinVisual`）管，
这一刀**只动卡片本体**（尺寸 / 圆角 / 玻璃 / 分隔 / 两枚圆钮 / 发送键 / 激活胶囊），
**零新依赖、零新配色体系**——颜色一律走 token 与 `color-mix`。

## 二、设计稿规格（已核实，逐字取自 design.html）

| 元素 | 取值 |
| --- | --- |
| `.composer`（卡片） | `border-radius:28px`；`background:rgba(255,255,255,.18)`；`backdrop-filter:blur(22px) saturate(1.4)`；`border:1px solid rgba(255,255,255,.55)`；`box-shadow: 0 10px 40px rgba(120,110,220,.25), inset 0 1px 0 rgba(255,255,255,.7)` |
| `.input-zone` | `display:flex; align-items:flex-start; gap:10px; padding:26px 28px 20px; min-height:104px` |
| `.prefix-char` | `/`；`font-size:22px; line-height:30px; font-weight:500; flex:0 0 auto` |
| `#prompt` textarea | `flex:1; border:none; background:transparent; font-size:17px; line-height:26px; max-height:220px; padding:2px 0` |
| `.divider` | `height:1px; background:rgba(255,255,255,.35); margin:0 22px` |
| `.toolbar` | `height:64px; display:flex; align-items:center; gap:12px; padding:0 20px` |
| `.plus-btn`（加号） | `38×38` 圆；`background:rgba(255,255,255,.22)`；`border:1px solid rgba(255,255,255,.5)`；`box-shadow: inset 0 1px 0 rgba(255,255,255,.6), 0 2px 8px rgba(120,110,220,.14)` |
| `.mic-btn` | `38×38` 圆 |
| `.send-btn` | **`46×46` 圆**；`background:#17151F`；`border:1px solid rgba(255,255,255,.22)`；`box-shadow: 0 4px 14px rgba(23,21,31,.35), inset 0 1px 0 rgba(255,255,255,.18)`；过渡 `transform/box-shadow/background .18s` |
| `.pill`（激活胶囊） | `border-radius:999px`；`.pill-deep` 描边 `rgba(150,120,255,.9)` + 光晕 `0 0 14px rgba(154,123,255,.45)`；`.pill-net` 描边 `rgba(90,170,255,.9)` + 光晕 `0 0 15px rgba(90,168,255,.45)` |

工具条 11 项顺序：①加号 ②模型 ③深度 ④联网搜索 ⑤工具 ⑥/命令 ⑦弹性空白 ⑧工作模式 ⑨作品目录 ⑩麦克风 ⑪发送。
发送键图标＝向上箭头。**本仓 `composerChips()` 的数组顺序与 `<template>` 的渲染顺序已经与它逐项对齐（无需改动）**。

## 三、现状 → 目标 的差量（精确到文件/函数）

### 1) `apps/desktop/src/renderer/src/styles.css`（`:root`，约 88-101 行 token 族）

新增三枚 token（设计稿给的就是这三个名字，卡段有「零色值字面量」硬门禁，故只在这里落成 token）：

```css
--glass-highlight: color-mix(in srgb, #ffffff 55%, transparent);
--glow-deep: #9a7bff;
--glow-net: #5aa8ff;
```

> 只有 `--glass-highlight` 是卡段内新消费的变量；`--glow-deep / --glow-net` 在 `interaction.css`
> 的 chip 规则里消费（那一段不在 `cardSection` 内，但同样只用 token，保持一致）。

### 2) `apps/desktop/src/renderer/src/styles/theme-runtime.css`

**病因**：`html[data-theme] :where(.composer-input-surface, …)`（现 137-154 行）给输入卡一条
**不透明底** `background: var(--surface-raised)`，特异性 (0,1,1) 压过 `agent-pane.css` 里
`.composer-input-surface` (0,1,0) 的 `background` ⇒ 玻璃永远出不来。

**改法**（照 `.left-sidebar` 的先例，46-52 行）：

- 把 `.composer-input-surface,` 从 137-154 行那个 `:where(...)` 组里**移出**；
- 紧接该组之后新增一条**同特异性**的专属规则：

```css
html[data-theme] .composer-input-surface {
  border-color: var(--theme-line);
  background: var(--surface-raised);
  background-color: var(--skin-glass-card-fill);
  background-image: var(--skin-glass-sheen, none);
  backdrop-filter: blur(var(--skin-glass-blur, 0)) saturate(var(--skin-glass-saturate, 1));
  color: var(--text-primary);
}
```

- 现 194-196 行 `html[data-theme] .composer:focus-within .composer-input-surface { border-color: … }`
  **原样保留**（聚焦只提亮边框、不加光环，是 2026-10-10 的既定裁定，`message-markdown-wiring.test.ts:119-129` 钉着）。
- `--skin-glass-card-fill / --skin-glass-blur / --skin-glass-saturate / --skin-glass-sheen`
  四枚均**已由** `appearanceSkinVisual.ts`（614-630 行）在运行时 `setProperty`，无需新造。

### 3) `apps/desktop/src/renderer/src/styles/agent-pane.css`（`deepwrite-composer-card` 段，915→EOF）

- `.composer-input-surface`：`border-radius: 21px → 28px`；`box-shadow` **加一层顶沿高光**
  `inset 0 1px 0 var(--glass-highlight)`，保留原三层 `var(--shadow-color)`（判据要求 ≥3 层）。
- **新增** `.composer-input-zone`（`display:flex; align-items:flex-start; gap:10px;
  padding:20px 22px 12px; min-height:88px`）与 `.composer-prefix`
  （`flex:0 0 auto; color:var(--text); font-size:1.375rem; line-height:30px; font-weight:500; user-select:none`）。
- `.composer-textarea`：`padding: 14px 17px 6px → 2px 0`，加 `flex:1; min-width:0;`；
  **保留** `field-sizing: content` 与 `max-height: 150px`（`composer-card-wiring.test.ts:70-73` 钉着）。
- `.composer-toolbar`：`gap: 8px → 12px`、`padding: 5px 8px 8px → 0 20px`、加 `min-height: 64px`；
  **保留** `border-top`（`conversation-chain-wiring.test.ts:134-139` 钉着）与 `position: relative`。
- `.composer-toolbar-left / -right` 的 `gap: 4px` **不动**（宽度预算守卫敏感，见 `composer-toolbar-overflow.test.ts`）。
- `.round-tool-button`：`30×30 → 38×38`；加玻璃底 + 描边 + `inset 0 1px 0 var(--glass-highlight)` 顶沿高光
  （设计稿 `.plus-btn`）；**保留** `border-radius: 50%`、`place-items: center`、`:disabled` 的 `opacity: 0.42` 与 `cursor: not-allowed`。
- `.send-button`：`30×30 → 46×46`；加 `border: 1px solid color-mix(...)` 与 `inset 0 1px 0 var(--glass-highlight)`；
  **保留** `var(--neutral-solid)` / `var(--neutral-solid-contrast)` / `transition:` 与 `:hover/:active/:focus-visible` 三态选择器。

### 4) `apps/desktop/src/renderer/src/components/ComposerBox.vue`（模板）

把 `<textarea …>` 包进新的一行容器，并在其**之前**插入 `/` 前缀：

```html
<div class="composer-input-zone">
  <span class="composer-prefix" aria-hidden="true">/</span>
  <textarea v-model="draft" data-mochen-composer class="composer-textarea" rows="1" :placeholder="…" />
</div>
```

- `ComposerReferenceMenu`、计数条、语音提示行的**相对次序不动**（都在 `.composer-input-zone` 之外、
  `.composer-toolbar` 之前），锚点仍是 `.composer-input-surface`（`inline-reference-menu-wiring.test.ts:224-226` 钉着）。
- 前缀是**装饰**（`aria-hidden`），不影响 placeholder 与任何数据通路。

### 5) `apps/desktop/src/renderer/src/styles/interaction.css`（`.composer-chip` 激活态，165-169 行）

按下态从「只换底色」升级为设计稿的**激活胶囊 + 光晕**：

```css
.composer-chip[aria-pressed="true"] {
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--accent) 80%, transparent);
  background: var(--selected);              /* 保留：状态档底已有 contrast 普查钉住 */
  box-shadow:
    0 0 14px color-mix(in srgb, var(--accent) 40%, transparent),
    inset 0 1px 0 var(--glass-highlight);
  color: var(--text);
  font-weight: 500;
  --text-faint: var(--text-on-state);
}
.composer-chip[data-chip="thinking"][aria-pressed="true"] {
  border-color: color-mix(in srgb, var(--glow-deep) 90%, transparent);
  box-shadow: 0 0 14px color-mix(in srgb, var(--glow-deep) 45%, transparent), inset 0 1px 0 var(--glass-highlight);
}
.composer-chip[data-chip="web-search"][aria-pressed="true"] {
  border-color: color-mix(in srgb, var(--glow-net) 90%, transparent);
  box-shadow: 0 0 14px color-mix(in srgb, var(--glow-net) 45%, transparent), inset 0 1px 0 var(--glass-highlight);
}
```

> **取舍**：底色**不改成**设计稿的 `rgba(255,255,255,.26)` 半透明白——那会脱离本仓
> `appearance-surface-ladder.test.ts:261` 已登记的状态档底（`primary` + 对比度普查），
> 这在暗色皮肤下失控。设计稿的**签名**（999px 胶囊、发光描边、按类别区分紫/蓝光晕）全部保留。

### 6) 判据（先写失败，后实现）

**A. `components/conversation-chain-wiring.test.ts`「输入卡装饰」describe 新增**：
- `.composer-input-surface` 含 `border-radius: 28px`、含 `var(--glass-highlight)`，且 `var(--shadow-color)` 层数仍 ≥3；
- `.composer-toolbar` 含 `min-height: 64px`（并仍含 `border-top:`）；
- `.send-button` 含 `width: 46px` 与 `height: 46px`；
- `.round-tool-button` 含 `width: 38px` 与 `height: 38px`；
- 模板含 `class="composer-prefix"`，且 `/` 出现在 `<textarea` 之前；
- `theme-runtime.css` 的 `html[data-theme] .composer-input-surface` 含 `var(--skin-glass-card-fill)` 与 `backdrop-filter`。

**B. `components/composer-card-wiring.test.ts:282-293` 就地修正**：
`.round-tool-button` 的 `width/height` 断言 `30px → 38px`（设计稿裁定，非放宽）。

**C. `interaction.css` 的 `.composer-chip[aria-pressed="true"]`**：
新增断言含 `border-radius: 999px` 与 `var(--glow-deep)` / `var(--glow-net)`（按 `data-chip` 分流）。

## 四、不改动的既有判定（回读确认）

- `composer-card-wiring.test.ts:295-306` chip 基规则 `height:29px / border-radius:7px / border:0` —— **基规则不动**。
- `appearance-surface-ladder.test.ts:260-261` chip `:hover` 与 `[aria-pressed="true"]` 两条普查登记 —— 仍在、语义不变。
- `message-markdown-wiring.test.ts:119-149` 聚焦无光环 —— 保留聚焦规则原样。
- `density-tier.test.ts` 密度档不碰 `.composer-wrap` —— 不动 `.composer-wrap`。
- `cardSection("agent-pane.css" / "interaction.css")` 内**零** `#hex` / `rgb()` / `rgba()` —— 新增规则全走 token / `color-mix`。
- `theme-token-guard.test.ts` —— 新消费的 `--glass-highlight / --glow-deep / --glow-net` 在 `styles.css :root` 定义。

## 五、验收（AC）

1. `corepack pnpm verify` 全绿（含 800 行预算、六段 tsc、eslint、boundary、vitest）。
2. `corepack pnpm build` 成功；真机启动后 CDP 量测：卡圆角 ≈28px、工具条高 ≈64px、
   发送键 ≈46×46、圆钮 ≈38×38、`/` 前缀在场、激活深度/联网胶囊有发光描边（**含暗色皮肤各目检一次**）。
3. 与上面正文版心对齐（卡宽 == `.message-list` 版心，`composer-card-wiring.test.ts:354-393` 仍绿、真机量测一致）。
4. 提交推送 → 读真实 CI → README「## 门禁」节换绑 → 台账补记（第一百二十六节）。

## 六、未收口（如实留档）

- 设计稿的极光背景 / 光斑 / 星点属演示页画布，**不在本刀范围**（归皮肤广场）。
- 工具条 chip 的**基态**尺寸（高 29 / padding 0 7）沿用本仓既有宽度预算，不照抄设计稿的 `8px 16px`——
  照抄会打破 `composer-toolbar-overflow.test.ts` 的版心等式。改动只落在**激活态的形状与光晕**。
