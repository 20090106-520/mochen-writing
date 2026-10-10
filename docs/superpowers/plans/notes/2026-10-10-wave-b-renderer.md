# 第 2 波（B 段）：P2-13 mirror 条件挂载 + P2-14 切标签取消自动保存窗

日期：2026-10-10 · 分支：`feat/plan3-interaction-and-assembly` · 总单：`docs/superpowers/plans/2026-10-09-full-scan-report.md` 第五节 P2 表

## 一、P2-13 每键全篇重渲（mirror 常驻挂载）

### 改动

- `apps/desktop/src/renderer/src/components/DocumentPane.vue`
  - 模板 L713：mirror 层加 `v-if="findVisible"` —— 面板关着时这一层连 DOM 都不在，
    `highlightMirrorHtml` computed 无人读、彻底不重算（computed 天然懒算）。
    挂载条件与 textarea 让位类 `.document-editor--with-find`（同绑 `findVisible`）逐字同判据，两层同开同关；
    文稿态与骨架态两道父闸由既有链路保证（编辑区 `v-if="mode === 'manuscript' && bodyState !== 'empty' && …"`、
    mirror 在骨架 `v-if="bodyState === 'loading'"` 的 `v-else` 支里）。
  - script L284-290：新增 `watch(findVisible, …)` —— 面板打开那一瞬新挂的层 scrollTop=0 而 textarea 可能已滚到半篇，
    `nextTick()` 后补一次 `syncMirrorScroll()`，把「打开面板 → 打字」对齐路径钉死（这是「别只加 v-if」的另一半）。
  - script L265-266：`highlightMirrorHtml` 的 docblock 改写（摆不摆=接线、内容闸=computed、切法=utils/find-mirror，铁律 6）；
    `syncMirrorScroll` 的空闸 `if (!ta || !mirror) return;` 原样保留并加了一行说明（条件挂载后 ref 会是 null）。
  - 行数回吐：压缩了 5-㉒ 的 `editorLayoutStyle` 大注释（18→11 行，关键事实保留并指向
    writing-preferences-contract 用例）与本次新增注释，794→795（预算内）。
- `styles/editor-pane.css`：**未改**。mirror 是 `position:absolute; inset:0` 脱离文档流的层，挂与不挂都不参与
  wrap 布局；排版逐项对齐（字号/行距/padding/折行/滚动条占位）由既有 `editor-mirror-parity.test.ts` 钉着，
  新的挂载契约不需要 CSS 配合改动。新接线用例顺带钉住 `position:absolute; inset:0`（防止哪天改成流内元素让条件挂载推动 textarea）。
- `utils/find-mirror.ts` 及其测试：**未改**（切分判定没有变化，6 条用例原样通过）。

### 用例（新增 `components/find-mirror-mount-wiring.test.ts`，读源码接线型，7 条）

钉：① mirror 标签带精确 `v-if="findVisible"` 且全模板只此一枚；② 挂载开关与让位类同判据；
③ 挂载链两道父闸在（editor-pane-left 限文稿、骨架 v-if→wrap v-else→mirror 次序）；④ `syncMirrorScroll` 空闸不许丢；
⑤ 打开面板同拍 nextTick 跟一次滚动；⑥ 组件里零 `<mark` 拼接（切法只住 utils/find-mirror）；⑦ CSS 脱流定位仍在。

### previewHtml 分栏代价的结论（不改，理由）

预览区那格（L737-746）本来就是 `v-if="mode==='manuscript' && bodyState!=='empty' && (viewMode==='preview'||viewMode==='split')"`
条件渲染：edit 模式下它不挂载、`previewHtml` computed 无人读就不重算，天然懒算，无每键代价；
split 模式每键重算是注释里刻意的「草稿到预览零延迟」设计。故 P2-13 对 previewHtml **不动**（不为改而改）。

## 二、P2-14 切标签「按新路径写旧内容」窗口

### 改动

- `apps/desktop/src/renderer/src/stores/useBookStore.ts` L316-320：`openDocTab` 开头加 `this.cancelAutoSave();`
  （选「切标签先取消」形状，判定真身住既有 `cancelAutoSave`，这里只接线；`activateTab`/`cycleTab`/`closeTab`/`createDoc`
  全部走 `openDocTab` 这一个入口，一处收口）。注释说明危险窗形状与「字不丢：stashActive 存档」。
  L584 的 `cancelAutoSave` docblock 补上第三个调用方。行数回吐：`openDocTab` docblock 3 行并 2 行，796→799。
- 语义交代：取消只是不再自动落**旧稿**；A 篇未保存的字由 `onEdit` 里既有的 `stashActive()` 留在
  `draftsByPath`（用例钉住 dirty 与正文都在），等切回编辑、手动保存、关标签（`closeTab` 的 flush）或退出兜底落盘。

### 用例（`stores/useBookStore.autosave.test.ts` 新增 describe，2 条，沿用本文件桩风格）

1. 「A 脏 + 静默窗挂着、B 读盘在途：窗到点时一个字都不许发出去」：用 `mockImplementationOnce` 吊住 B 的 `readDoc`，
   让 2000ms 窗正好落在「指针= B、正文= A」的危险窗；断言 `writeDoc` 一次没发（修法即取消），
   并断言 A 的暂存副本仍是 A 的字且 dirty、再空转 60s 无「迟到复活」的保存。
2. 「切到有暂存副本的标签（零延迟）：同样取消」：B 脏 → 切回 A（走暂存同步通路）→ 空转 60s，`writeDoc` 零次；
   B 的字在暂存里未丢。

## 三、TDD 红→绿证据（断言原文摘录）

红（改实现前，`~/dw-gate/b-red.log`，EXIT=1，5 failed | 8 passed）：

```
AssertionError: mirror 必须按 findVisible 条件挂载: expected '\n            ref="highlightMirrorEl"…' to contain 'v-if="findVisible"'
AssertionError: expected '\nimport { computed, ref, watch } fro…' to match /watch\(findVisible,[\s\S]*?\{[\s\S]*?await nextTick…/
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times   （autosave 两条）
```

（P2-14 红那一发的实际参数即危险窗形状：`("chapters/02-b.md", "A 篇没落盘的字\n", "fp-a")`，日志在 b-red.log。）

绿：定向 3 文件 19 条全过（`~/dw-gate/b-green.log`，EXIT=0）；
格式化后定向 14 文件 186 条全过（`~/dw-gate/b-final.log`，EXIT=0）；
渲染层全套 191 文件 / 2470 条全过（`~/dw-gate/b-reg.log`，EXIT=0，`--maxWorkers=1`）。

## 四、变异（证明断言有鉴别力；均用 Edit 改回并回读确认生产形态）

| 变异 | 结果 |
| --- | --- |
| 删 mirror 的 `v-if="findVisible"` 行 | 接线用例红 2 条（`~/dw-gate/b-mut1.log`，EXIT=1）：`expected … to contain 'v-if="findVisible"'` |
| 删 `watch(findVisible,…)` 整块 | 接线用例红 1 条（`~/dw-gate/b-mut2.log`，EXIT=1）：`to match /watch\(findVisible,…/` |
| 删 `openDocTab` 里 `this.cancelAutoSave();` 一行 | autosave 新增 2 条全红（`~/dw-gate/b-mut3.log`，EXIT=1）：`vi.fn() … actually been called 1 times` |

三个变异后都用 Edit 恢复；生产形态已回读（v-if L713、watch L284、cancelAutoSave L319 在场，git diff 复核）。

## 五、门禁

- 类型：`pnpm exec tsc --noEmit -p apps/desktop/tsconfig.web.json` → **EXIT=0**，日志 0 个 `error TS`（`~/dw-gate/b-tsc.log`、`~/dw-gate/b-tsc2.log`，后者是 prettier 写后复跑）。
- 行数：`node tools/check-source-line-budget.mjs` → **EXIT=0**「行数预算通过（585 份，含 .mjs/.cjs）」（`~/dw-gate/b-budget.log`）。
  本文件 DocumentPane.vue 795、useBookStore.ts 799，均在 800 内且已按「加多少搬多少」压缩了旧注释。
  备注：中途一次预算闸曾报 `apps/desktop/scripts/gen-scene-svgs.mjs 851 行` —— 那是并行 agent 正在扩闸（.mjs 进射程）的在途态，
  非我点名文件、我未触碰；复跑时该文件已被其 owner 处理，闸转绿。
- prettier：4 个点名文件 `--check` 全过（新接线用例先红后 `--write`，之后全绿）。

## 六、没做的部分与原因

1. **面板开着但查询为空时正文「隐形」的既有观感问题**：`highlightMirrorHtml` 对空查询返回空串，而让位类只看 `findVisible`——
   这是改动前就存在的行为（mirror 常驻时同样渲染空串），本次刻意保持行为不变（修它属于另一条判定，需产品拍板「空查询时 mirror 铺全文还是不让位」）。
2. **保存通路「世代快照」形状没采用**：总单给的两选一里选了 `cancelAutoSave` 方案——它能被上述两条行为用例直接钉死；
   世代快照要动 `saveActive`/`draft-flush` 的判定面，波及并行 agent 的文件，风险大于收益。
3. **未 commit / stash / checkout / reset**；未碰 `packages/**`、`apps/desktop/src/main/**`、`useAgentStore.ts`、CSS（结论：无需改）。
4. 全仓 `pnpm verify` 未跑（范围外：会牵进并行 agent 在途文件）；跑的是渲染层全套 + 四道点名门禁。
