# 本书读数的界面落点：四处把「这本书自己的数」摆给作者看

- 日期：2026-11-16
- 来源：用户原话「ui方面」＋在四个候选落点里选择「全部」。
- 前置：提示词侧的本读数已全部完成并全绿（`docs/superpowers/specs/2026-11-15-book-readings-ii/`）。
  本刀**不新增任何测量**、不改生成端提示词、不设任何质量阈值。
- 状态：待批准。批准后按 `tasks.md` 执行；不提交、不推送。

## 一、要解决的事

`style-profile.ts` / `dialogue-rhythm.ts` / `dialogue-repeat.ts` / `narration-person.ts`
量出的读数，目前**只进提示词**，作者在界面上看不到。四个落点全部要做：

1. 书稿体检对话框顶部：一张「本书腔调档案」读数卡（全书级）。
2. 右栏「去 AI 味」浮层：本章实时读数（随草稿变）。
3. 编辑器页脚：当前篇的常驻读数（随草稿变，极简）。
4. 左栏章节列表：偏离本书基线的那几章挂一枚「偏」标（按已保存正文量）。

纪律沿用前两刀：**只摆数、不判定**；样本不够就明说「不报」，不报 0、不猜。

## 二、新增文件（逐文件、逐函数）

### 2.1 `apps/desktop/src/renderer/src/utils/style-readout.ts`（新）

渲染层唯一的「读数 → 可渲染文字」转换处。数字真身全部来自 `@mochen/contracts`，
这里只做格式化与组装，**不重算任何一个公式**（铁律 6）。

```ts
export interface ReadoutRow  { label: string; value: string; hint: string }
export interface ReadoutChip { key: string; label: string; value: string; hint: string }
export interface ChapterDriftMark { severity: "warn" | "off"; title: string }

export interface BookStyleReadout {
  profile: StyleProfile | null;
  shape: DialogueParagraphShape | null;
  repeats: DialogueRepeat[];
  person: NarrationPerson | null;
}

export function bookStyleReadoutOf(contents: readonly string[]): BookStyleReadout;
export function readoutRowsOf(readout: BookStyleReadout): ReadoutRow[];
export function readoutNoteOf(readout: BookStyleReadout): string;
export function chapterChipsOf(content: string): ReadoutChip[];
export function chapterDriftMarksOf(
  profile: StyleProfile | null,
  chapters: readonly { relPath: string; title: string; content: string }[]
): Record<string, ChapterDriftMark>;
```

口径（逐条写死在函数里，界面不再拼）：

- `bookStyleReadoutOf`：`styleProfileOf(contents)` / `dialogueParagraphShapeOf(contents)` /
  `dialogueRepeatsOf(contents)` / `narrationPersonOf(contents)`，四份一次取齐。
- `readoutRowsOf` 的九行（顺序固定；2026-11-17 追加「句首」后为十行，见 §七）：
  1. 句长 —— `平均 X 字 · 长短句落差 Y`；`rhythm === null` ⇒ `句数不足 10 句，不报`。
  2. 段长 —— `平均 X 字 · 段长波动 Y`；`paragraph === null` ⇒ `段落不足 10 段，不报`。
  3. 对白 —— `X%`（`Math.round(ratio*1000)/10`）。
  4. 段末收在台词 —— `X%（A/B 段）`。
  5. 段末标点 —— 按 `period/question/exclamation/ellipsis/other` 顺序，只列占比 > 0 的档：
     `句号 40% · 感叹号 25% · 其他 35%`。
  6. 标点脾气 —— `STYLE_PROFILE_PUNCTUATION` 三枚各出现：`破折号 12.3 处/千字 · …`。
  7. 对白段落形态 —— `纯台词 12 段 · 台词＋动作 30 段`；`shape === null` ⇒
     `含对白段落不足 10 段，不报`。
  8. 台词复读 —— 前 3 条 `「知道了。」×4 · …`；空 ⇒ `没有出现 2 次以上的同一句台词`。
  9. 叙述人称 —— `第一人称 12 次 · 第三人称 210 次（引号外；人名不计入第三人称）`；
     `person === null` ⇒ `叙述样本不足 500 字，不报`。
- 每行 `hint` 只说「怎么量的 + 只摆不判」，不写「好/坏/该改」。
- `readoutNoteOf`：`profile === null` 时返回
  「完稿还不足 500 字，立不起这本书的腔调档案——开书前立手册，立出来的只会是别人的东西。」；
  否则返回一句「这九行只摆本书自己的数，不设阈值、不判定」的说明。
- `chapterChipsOf` 三枚（页脚与浮层共用，不设变体）：
  - `句长`：profile 可用时 `X 字`，否则 `样本不足`；
  - `对白`：`X%`，profile 不可用时 `样本不足`；
  - `纯台词段`：shape 可用时 `A/B 段`，否则 `—`。
  - `dialogueBalance(content).total < STYLE_PROFILE_MIN_CHARS` 时只返回一枚
    `{ key: "sample", label: "腔调", value: "样本不足 500 字" }`（不摆一串 `—`）。
- `chapterDriftMarksOf`：对每章 `styleDriftOf(profile, content)`；
  `checked === false` 或 `worst === null` 的章**不记**（一致/没法比都不挂标）；
  只记 `worst.severity`，`title` =
  `《标题》${drift.note}最明显：${worst.label} ${worst.draft}（本书常态 ${worst.base}）。${worst.advice}`。

### 2.2 `apps/desktop/src/renderer/src/utils/style-readout.test.ts`（新）

- `bookStyleReadoutOf` 四份读数同时取到（同一份 60 段样本）；
- 499 字 ⇒ `profile === null`、`readoutRowsOf` 九行仍返回但句长/段长/人称说「不报」；
- 500 字 ⇒ 非 null（门槛与 contracts 同值，不另写数字）；
- `chapterChipsOf` 两种形态（样本不足一枚 / 正常三枚）与数值格式；
- `chapterDriftMarksOf`：手工构造 `StyleProfile`，偏离章记 `warn/off` 且 `title` 含改法；
  短文不记；`profile === null` ⇒ `{}`；
- `readoutRowsOf` 的复读行按次数降序取前 3（顺序来自 contracts，不重排）。

### 2.3 `apps/desktop/src/renderer/src/stores/useStyleReadoutStore.ts`（新）

```ts
export const useStyleReadoutStore = defineStore("style-readout", () => {
  const marks = ref<Record<string, ChapterDriftMark>>({});
  function ensure(docs: readonly DocRef[], rootPath: string | null): Promise<void>;
});
```

- 去重键 = `rootPath + 各章 relPath`；同一键只扫一次，重复调用返回同一 Promise；
- 扫描走 `loadAllDocContents(docs)`（与体检同一通路），`styleProfileOf(contents)` 后调
  `chapterDriftMarksOf(profile, chapterEntries)`；
- 回来时键已变（换书/换章）则丢弃；读盘失败**静默**，`marks` 保持 `{}`（标注是锦上添花）；
- 样本口径与体检对话框一致：`contents` = 全部文稿（不另立第二套样本）。

### 2.4 `apps/desktop/src/renderer/src/components/EditorFooterMeta.vue`（新）

从 `DocumentPane.vue` 页脚搬出的 `.editor-footer-meta`（原文 772–787 行），职责不变：

- props：`mode: RightPaneMode`、`characterCount: number`、`readingTimeLabel: string`、
  `activeDoc: DocRef | null`、`stateText: string`；
- 文稿态保留「正文 N 字 / 约 M 分钟阅读 / ChapterQuota」三格；
- 保存状态仍读 `book.notice || stateText`，`is-dirty` 类名与告警色不动；
- 新增：文稿态末尾一枚 `<StyleReadoutChips :chips="chapterChipsOf(draft)" />`（见 2.6），
  `draft` 由 `book.draft` 读。

### 2.5 `apps/desktop/src/renderer/src/components/StyleReadoutChips.vue`（新）

```vue
<span class="style-chips" role="list" aria-label="腔调读数">
  <span v-for="chip in chips" :key="chip.key" class="style-chip" role="listitem" :title="chip.hint">
    <b>{{ chip.label }}</b>{{ chip.value }}
  </span>
</span>
```

根是 `<span>`：页脚 `.editor-footer-meta > span` 的既有排版规则直接生效，不新造容器。

### 2.6 `apps/desktop/src/renderer/src/components/ChapterDriftBadge.vue`（新）

- props：`relPath: string`；
- `watch(() => book.docs, …, { immediate: true })` 调 `styleReadout.ensure(book.docs, book.rootPath)`；
- `mark = styleReadout.marks[relPath]`；无标记不渲染；
- 模板：`<span class="tree-drift" :class="{ 'is-off': mark.severity === 'off' }" :title="mark.title">偏</span>`；
  文字恒为「偏」，档位靠颜色区分（`is-off` 用 `--warning`，warn 用 `--text-faint`）。

## 三、改既有文件

### 3.1 `apps/desktop/src/renderer/src/components/DocumentPane.vue`（现 800 行）

- 删除页脚 `.editor-footer-meta` 那 16 行，改为
  `<EditorFooterMeta :mode="mode" :character-count="characterCount" :reading-time="readingTimeLabel" :active-doc="activeDoc" :state-text="saveStateText" />`；
- 新增 1 行 import。预计落到约 792 行，仍 ≤ 800；
- `<footer class="editor-footer">` 本身**留在原地**（CSS `grid-row: 8` 的直系子元素不动），保存按钮不动。

### 3.2 `apps/desktop/src/renderer/src/components/SideNavTermsReport.vue`（现 569 行）

- 新增 `styleReadoutRows` / `styleReadoutNote` 两个 ref，扫描重置与 `.then` 里各加一行；
- 模板在「术语疑似」之前插入一节：

```vue
<p class="stats-section-head">本书腔调档案（样本 {{ readoutProfileChars }} 字）</p>
<div class="stats-readout">
  <p v-for="row in styleReadoutRows" :key="row.label" class="stats-readout-row" :title="row.hint">
    <span class="stats-readout-label">{{ row.label }}</span>
    <span class="stats-readout-value">{{ row.value }}</span>
  </p>
</div>
<p class="stats-note">{{ styleReadoutNote }}</p>
```

- `readoutProfileChars` 取 `profile?.charCount ?? 0`（在 `.then` 里与 rows 一起存）。

### 3.3 `apps/desktop/src/renderer/src/components/SlopPanel.vue`（现 379 行）

- 新增 `const chips = computed(() => chapterChipsOf(book.draft));` 与
  `const repeatLines = computed(() => bookStyleReadoutOf([book.draft]).repeats.slice(0, 3))`；
- 模板在说明段之后加一行读数条：

```vue
<div class="ai-slop-readout" aria-label="本章腔调读数">
  <StyleReadoutChips :chips="chips" />
  <span v-if="repeatLines.length > 0" class="ai-slop-readout-repeat">
    复读台词：{{ repeatLines.map((r) => `「${r.line}」×${r.count}`).join(" · ") }}
  </span>
</div>
```

- 不放判词、不给颜色告警。

### 3.4 `apps/desktop/src/renderer/src/components/LeftSidebar.vue`（现 787 行）

- 新增 1 行 import；章节行 `tree-label` 之后加
  `<ChapterDriftBadge v-if="section.id === 'chapter'" :rel-path="node.relPath" />`（2 行）。
  预计约 790 行，仍 ≤ 800。

### 3.5 `apps/desktop/src/renderer/src/utils/doc-checkup.ts`

- `loadAllDocContents` 的参数类型放宽为
  `readonly Pick<BookDoc, "relPath" | "kind" | "title">[]`（store 传 `DocRef` 也能用，
  不改任何实现）；返回类型不变。

### 3.6 样式（三个文件，只加规则）

- `styles/left-nav.css`：`.tree-drift`（10px、淡边框、`margin-left: 4px`）、
  `.tree-drift.is-off`（`color: var(--warning)`、`border-color: currentColor`）；
  `.stats-readout` / `.stats-readout-row`（两列 `grid`）/ `.stats-readout-label` / `.stats-readout-value`。
- `styles/editor-pane.css`：`.editor-footer .style-chips`（`flex: 0 1 auto; min-width: 0;
  overflow: hidden; gap: 8px; color: var(--text-faint)`）。
- `styles/ai-slop.css`：`.ai-slop-readout`（一行、可换行、`gap`）、`.ai-slop-readout-repeat`
  （`color: var(--text-tertiary)`）。
- 所有新类名都有模板消费者（dead-css-guard 的前提）。

### 3.7 测试

- 新增 `components/style-readout-wiring.test.ts`：四条接线各一条断言——
  `SideNavTermsReport.vue` 引 `bookStyleReadoutOf`/`readoutRowsOf` 并渲染 `stats-readout`；
  `SlopPanel.vue` 引 `chapterChipsOf`；`DocumentPane.vue` 渲染 `<EditorFooterMeta`；
  `LeftSidebar.vue` 渲染 `<ChapterDriftBadge`，且 `ChapterDriftBadge.vue` 引 `useStyleReadoutStore`。
- 改 `components/document-pane-wiring.test.ts`：页脚模板相关断言（157–170、194、260–268）
  改为读 `components/EditorFooterMeta.vue` 的模板；脚本断言（`saveStateLabel` 四个喂入）仍读
  `DocumentPane.vue`，不改松。

## 四、不变量（机器可判）

1. 四个界面元素全部从 `utils/style-readout.ts` 取文案/数字，界面里不出现第二次百分号拼装；
2. `readoutRowsOf` 固定十行顺序（2026-11-17 追加第十行前为九行）；样本不足时该行说「不报」，不出现 `0%`/`null`；
3. `chapterChipsOf` 在 499 字时只返回一枚「样本不足」chip；
4. `chapterDriftMarksOf` 只收 `warn|off`，一致章不产生键；
5. store 同一 `rootPath + relPath` 只扫一次；换书后旧结果被丢弃；
6. `DocumentPane.vue` / `SideNavTermsReport.vue` / `SlopPanel.vue` / `LeftSidebar.vue`
   全部 ≤ 800 行（`tools/check-source-line-budget.mjs`）；
7. 新增 CSS 类全部有模板消费者（`dead-css-guard.test.ts`）；
8. 不改任何 contracts 测量函数、不改 `prompt-assembly.ts`。

## 五、验收

1. `corepack pnpm typecheck` 通过；
2. `corepack pnpm vitest run apps/desktop/src/renderer/src/utils/style-readout.test.ts
   apps/desktop/src/renderer/src/components/style-readout-wiring.test.ts
   apps/desktop/src/renderer/src/components/document-pane-wiring.test.ts
   apps/desktop/src/renderer/src/components/dead-css-guard.test.ts` 全过；
3. `corepack pnpm verify` 输出 `VERIFY_EXIT=0`（Prettier / 6 份 tsc / ESLint / 包边界 /
   行数预算 / 全量 vitest）；
4. 如实报告通过项与未做项；不提交、不推送。

## 六、如实说明的口子

- **左栏「偏」标按盘上正文量**：草稿没保存前它不会跟着变；标注的含义是「上次扫描时的偏离」，
  与「本章清单」同一套留存口径。打开一本有章节的书会做一次与体检同成本的读取（一次性、失败静默）。
- **样本口径沿用体检现有那份（全部文稿）**：不为界面另立一套「只算章节」的口径，
  否则同一屏会出现两个「本书常态」。
- **页脚空间有限**：三枚读数在最窄右栏里可能被省略号截断（`overflow: hidden`），
  完整读数仍在「去 AI 味」浮层与体检卡片里。
- **不把读数做成告警**：四处的颜色只区分「偏离档位」，不出现红黄绿灯式的质量判决。

## 七、2026-11-17 追加：句首读数下沉 + 档案卡第十行

本节的动机与上一刀一致：**同一份口径，界面看得见**。不新增测量、不改判据。

### 7.1 下沉 `sentenceOpeningsOf` 到 contracts

- 新文件 `packages/contracts/src/sentence-opening.ts`：把原本只在
  `apps/desktop/src/main/prompt-assembly.ts` 里的 `openingOf` / 三个刻度搬下来，
  改名 `sentenceOpeningOf`（内部函数），公开：
  `SENTENCE_OPENING_CHARS = 2`、`SENTENCE_OPENING_MIN_COUNT = 2`、`SENTENCE_OPENING_TOP = 5`、
  `SentenceOpening { opening, count }`、`sentenceOpeningsOf(contents)`。
- `packages/contracts/src/index.ts` 从 `./sentence-opening.js` 全量转出。
- 口径逐字沿用生成端：切句走 `sentencesOf`，句首＝剥掉前置标点／符号／空白后的前 2 个码点，
  ≥2 次才上榜，按次数降序、同数 `localeCompare(zh)`，最多 5 条。

### 7.2 生成端改为调用同一真身

- `apps/desktop/src/main/prompt-assembly.ts`：删除本地常量和 `openingOf`，
  `import { sentenceOpeningsOf }`，并从 `@mochen/contracts` 原样转出三个刻度
  （`prompt-sentence-openings.test.ts` 的引用路径不变）。
- `sentenceOpeningSentence` 的措辞与行为不变：空榜返回 `""`，否则拼
  `「句首」（N 次）`，只做 `top.map`。

### 7.3 档案卡第十行（界面）

- `utils/style-readout.ts`：`BookStyleReadout` 增加 `sentenceOpenings: SentenceOpening[]`，
  `bookStyleReadoutOf` 同时取第六份读数；`readoutRowsOf` 在第 2 行插入「句首」，
  行序变为：句长、**句首**、段长、对白、段末收在台词、段末标点、标点脾气、
  对白段落形态、台词复读、叙述人称。
- 「句首」行文案由 renderer 组装：
  `「句首」×N · …`；空榜 ⇒ `没有出现 2 次以上的同一句首`。
  `hint`：`句首＝剥掉前置标点／引号后的前 2 个实字；同一句首出现 ≥2 次才上榜，最多 5 条。`
- `readoutNoteOf` 的「这九行」改为「这几行」（行数不再写死）。
- 不触碰 `SideNavTermsReport.vue`：卡片本来按 `readoutRowsOf` 的数组渲染，第十行自动出现。

### 7.4 用例与门禁

- 新增 `packages/contracts/test/sentence-opening.test.ts`：刻度 2/2/5；剥引号取两字；
  1 次不上榜；七个句首各 2 次只出 5 条；同数按字符序（`你又` 在 `他推` 前）。
- 适配 `apps/desktop/src/renderer/src/utils/style-readout.test.ts`：五份→六份读数、
  「固定十行」、`rows[1]` 含 `「他推」×20`、样本不足时该行为「没有出现 2 次以上的同一句首」。
- `prompt-sentence-openings.test.ts` 不动，用于证明生成端措辞与行为未变。
- 验收：`pnpm typecheck`、上述三个 vitest、`pnpm verify` → `VERIFY_EXIT=0`。

