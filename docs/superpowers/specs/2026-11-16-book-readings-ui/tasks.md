# 任务清单 · 本书读数的界面落点

## T1 读数呈现层

- [x] `utils/style-readout.ts`（新）：`bookStyleReadoutOf` / `readoutRowsOf` / `readoutNoteOf` /
      `chapterChipsOf` / `chapterDriftMarksOf` 与三个展示类型
- [x] `utils/style-readout.test.ts`（新）：四份读数、500 字门槛、九行顺序、chips 两形态、drift 标记

## T2 书稿体检卡片

- [x] `SideNavTermsReport.vue`：`styleReadoutRows` / `styleReadoutNote` / 样本字数，扫描时一次取齐
- [x] 模板在「术语疑似」前插入「本书腔调档案」九行读数 + 说明
- [x] `styles/left-nav.css`：`.stats-readout*` 规则

## T3 实时读数（浮层 + 页脚）

- [x] `StyleReadoutChips.vue`（新）
- [x] `EditorFooterMeta.vue`（新）：搬出 DocumentPane 页脚 meta，加 chips
- [x] `DocumentPane.vue`：改挂 `<EditorFooterMeta>`，行数 ≤ 800
- [x] `SlopPanel.vue`：`chapterChipsOf` + 复读台词一行
- [x] `styles/editor-pane.css` / `styles/ai-slop.css`：chips 规则

## T4 章节列表偏离标

- [x] `stores/useStyleReadoutStore.ts`（新）：`marks` + `ensure`（去重、换书丢弃、失败静默）
- [x] `ChapterDriftBadge.vue`（新）
- [x] `LeftSidebar.vue`：章节行挂标，行数 ≤ 800
- [x] `styles/left-nav.css`：`.tree-drift` / `.is-off`
- [x] `utils/doc-checkup.ts`：`loadAllDocContents` 入参放宽为结构类型

## T5 接线测试与既有测试适配

- [x] `components/style-readout-wiring.test.ts`（新）：四处接线
- [x] `components/document-pane-wiring.test.ts`：页脚断言改读 `EditorFooterMeta.vue`
- [x] `dead-css-guard.test.ts` 全绿（新类名都有消费者）

## T6 门禁与汇报

- [x] `corepack pnpm typecheck`
- [x] 相关 vitest（style-readout / wiring / document-pane / dead-css-guard）
- [x] `corepack pnpm verify` → `VERIFY_EXIT=0`
- [x] 汇报通过项与未做项（不提交、不推送）

## T7 2026-11-17 追加：句首读数下沉 + 档案卡第十行

- [x] `packages/contracts/src/sentence-opening.ts`（新）：三个刻度 + `sentenceOpeningsOf`
- [x] `packages/contracts/src/index.ts` 转出；`test/sentence-opening.test.ts`（新）
- [x] `prompt-assembly.ts` 改为调用 contracts 真身并转出三常量（措辞与行为不变）
- [x] `utils/style-readout.ts`：`sentenceOpenings` 读数 + 「句首」行（十行）
- [x] `utils/style-readout.test.ts`：六份读数、十行顺序、样本不足文案
- [x] 门禁：`pnpm typecheck`、三个相关 vitest、`pnpm verify` → `VERIFY_EXIT=0`

