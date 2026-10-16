---
title: "Export dialog: format table, range selection, IPC assembly and the four visible-failure exits"
status: accepted
tags:
  - "architecture"
  - "renderer"
---

## Purpose & Scope

本规范对「导出这一格怎么出、怎么接、怎么不各说各话」有规范力：`apps/desktop/src/renderer/src/components/ExportDialog.vue` 这一份组件——七档格式表、导出范围（章节多选 / 全选 / 全不选）、四枚选项开关（元信息 / 页码 / 章节分隔符 / frontmatter）、异步组装（走 IPC 到主进程）、预计大小与文件名两格预览、复制与保存两枚动作钮，以及「失败要看得见」的四条出口（组装失败 / 零章 EPUB / 复制被挡 / 章节正文读不出来），都在这一层。它是渲染层唯一一处导出 UI：**判定与文案一律不住 `<script setup>`**——复制三道闸与空选判定住 `utils/export-clipboard`，尺寸估算与字节格式化住 `@mochen/fs-store/export-shared`，重名清理住 `packages/fs-store`——这里只剩挂线。

Depended on by: `App.vue`（挂载 + `:visible="layout.panelVisibility.export"` + `@close`）、`DocumentPane.vue`（右栏头部的 `aria-label="导出作品"` 入口 → `layout.openExport()`）、`stores/layoutStore`（可见态唯一真身 `panelVisibility.export` / `openExport` / `closePanel("export")`）、主进程 `index.ts` 的 `file:build-export` handler 与 `file:save-file` 桥、`preload/renderer-api.ts` 的 `buildExport` / `saveFile` 转发、`composables/useModalFocus`（焦点与 Esc）、`export-dialog-wiring.test.ts`（按源码字面量钉接线）。

Out of scope:

- 组装真身 —— EPUB 装配 / zip 写入住 `packages/fs-store`（`export-service` 那条链，含 `node:zlib`）；渲染层**只许**引零 Node 依赖的 `export-shared` 子路径，引 `export-service` 就是首屏白屏（`tools/check-package-boundary.mjs` 会报）。
- 复制三道闸与空选判定 —— 住 `utils/export-clipboard` 的 `decideCopy` / `shouldAssemble`。
- 焦点与 Esc —— 住 `composables/useModalFocus`（本组件不留第二份判定）。
- 可见态 —— 住 `stores/layoutStore`。
- 重名清理与降级命名 —— 住 `packages/fs-store` 的 `sanitizeDocFileName` / `FALLBACK_EXPORT_NAME`。
- 导出格式的联合类型与选项口径 —— 住 `packages/contracts/src/export.ts`。

## Surface

- `ExportDialog.vue` — @apps/desktop/src/renderer/src/components/ExportDialog.vue — 渲染层唯一导出 UI 壳；props `visible`；emit `close`。
- `panelRoot` + `useModalFocus({ root, close, isOpen })` — 同文件 — 焦点与 Esc 的唯一接线（不自留判定）。
- `chapterDocs` — 同文件 — 可导章节 = `docs` 里 `kind === "chapter"` 的那一族。
- `selectedChapters` / `toggleChapter` / `selectAll` / `selectNone` — 同文件 — 章节勾选集（`Set<string>`，键是 `relPath`）与它仅有的三个写口。
- `format` / `includeFrontmatter` / `separatorBetweenChapters` / `includeMeta` / `includePageNumbers` — 同文件 — 五枚导出选项（页码只在 print 档、后两枚在 json 档不出现）。
- `formatOptions` — 同文件 — 七档格式表（id 与 `ExportFormat` 双向对齐，每档带 label 与人话 desc）。
- `docsWithContent` / `loadingContent` / `loadDocsForExport` / `contentLoadError` — 同文件 — 批量取正文（`Promise.allSettled`，只留 fulfilled；rejected 的篇数写进 `contentLoadError`，让它看得见）。
- `refreshPreview` / `assembleToken` / `previewResult` / `assembleError` — 同文件 — 组装（IPC）与竞态令牌、失败句。
- `estimatedSize` — 同文件 — `estimateExportSize` + `formatByteSize`；内容未到位时是「计算中…」。
- `saveToFile` / `exporting` / `copyToClipboard` / `copyDone` — 同文件 — 两枚动作钮。
- `decideCopy` / `shouldAssemble` — @apps/desktop/src/renderer/src/utils/export-clipboard.ts — 复制三道闸与空选判定的真身。

States: 可见（真身 `layout.panelVisibility.export`）→ 章节勾选（空 / 部分 / 全部；**空集是「不能导」，不是「导全部」**）→ 组装态（未组装 / 在途 / 成功 / 失败）→ 两枚钮的禁用（复制：无内容或组装失败；保存：在途或无勾选）。

## Normative Behavior

1. WHEN 开合对话框，the 组件 MUST 只读 props.visible，可见态的真身住在 `layoutStore.panelVisibility.export`；组件 MUST NOT 自持 `exportOpen` 一类本地布尔（「整个导出功能从来没打开过」那次事故的根因）。
2. WHEN 装焦点与 Esc，the 组件 MUST 走 `useModalFocus` 一处（`root` = `panelRoot`、`close` = emit close、`isOpen` = 可见态），MUST NOT 在本组件里留第二份 Esc / 焦点判定。
3. WHEN 渲染格式表，the 组件 MUST 表驱动 `formatOptions`，七枚 id MUST 双向对齐 `ExportFormat`；每档 MUST 有自己的 label 与人话 desc（空 desc 不许）。
4. WHEN 切到非 print 档，the 组件 MUST 把 `includePageNumbers` 关回 false；页码开关 MUST 只在 print 档出现。
5. WHEN 选项区渲染，the 组件 MUST 在 json 档隐藏「章节间加分隔符」与「保留 frontmatter」两枚。
6. WHEN 打开对话框，the 组件 MUST 默认全选可导章节（仅在当前勾选为空时）并加载其正文；WHEN 勾选变化，the 组件 MUST 重取正文（`loadDocsForExport`）。
7. WHEN 组装导出内容，the 组件 MUST 走 `window.mochen.buildExport` 那条 IPC，MUST NOT 在渲染层引 `export-service` 或任何 `node:` 依赖（白屏回归线）。
8. WHEN 组装的两个实参出网，the 组件 MUST 先 `toRaw`（`docsWithContent` 是 `ref([])`、`meta` 来自 `storeToRefs`，两者都是 Vue 反应式代理；Electron 在 send 端做结构化克隆，遇代理当场抛「An object could not be cloned.」）。
9. WHEN 组装在途而选项又变，the 组件 MUST 用 `assembleToken` 在**成功与失败两条路**都判一次（`if (token !== assembleToken) return;`），MUST NOT 让慢的那次盖掉后一次。
10. WHEN 组装结果落盘，`previewResult` MUST 是 `ref`，MUST NOT 是 `computed`（组装是异步的，computed 里 await 拿不到结果）。
11. WHEN 一枚章节都没勾，the 组件 MUST 经 `shouldAssemble(selectedChapters.size)` 早退、**根本不发**组装 IPC，并在预览区直说为什么是空的；MUST NOT 把空集传成 `docRelPaths: []`（服务层口径是「[] = 全部章节」，两处相反就是「预览摆全书、导出钮却禁着」）。
12. WHEN 点复制，the 组件 MUST 只经 `decideCopy` 的三道闸（组装失败 / EPUB / 空或全空白）取结论，`blocked` 分支 MUST 排在 `navigator.clipboard.writeText` 之前；MUST NOT 在组件里自判 `format` 或 `content`。
13. WHEN 点保存，the 组件 MUST 走 `window.mochen.saveFile`，二进制 MUST 优先于文本（`result.bytes ?? result.content`，两处都是），且浏览器降级分支 MUST 按 format 给 mime（含 `application/epub+zip`）。
14. WHEN 保存之前，the 组件 MUST 先拦「零章的 EPUB」（`bytes === null && format === "epub"`）并说清为什么，且 MUST 排在打开保存对话框之前。
15. WHEN 保存成功，the 组件 MUST 提示文件名与大小并 `emit("close")`；WHEN 失败，the 组件 MUST 提示原因。
16. WHEN 组装失败，the 组件 MUST 把中文写进 `assembleError` 并由模板渲染它，MUST NOT 静默留一份空预览——那条 class MUST 真的在内联样式里写了规则（且模板里出现几次、样式里就得有几条）。
17. WHEN 正文尚未到位，`estimatedSize` MUST 显示「计算中…」，MUST NOT 拿 0 字节冒充估算。
18. WHEN 批量取正文，the 组件 MUST 先清上一轮的告警；WHEN 有章节读不出来（`Promise.allSettled` 的 rejected），the 组件 MUST 把「有几篇没读出来」写进 `contentLoadError` 并由模板渲染它（可见中文），MUST NOT 静默丢弃；WHEN 全都读得出来，MUST 让该告警为空串。

## Constraints & Invariants

- Constraint: 本文件是 §候选池里 653 行 / 3 提交那一格 —— 判定一律往外拆 `utils/export-clipboard` 与 `@mochen/fs-store/export-shared`、接线住 `export-dialog-wiring.test.ts` 读源文件，见 `conventions/source-line-budget.rule.md`。
- Constraint: 渲染层 MUST NOT 引 `export-service` —— `export-shared` 是「渲染层可引」这个结论的唯一凭据，它自己也 MUST 零 `node:` 引用。
- Invariant: **空集与「全部」是两件事** —— 空勾选只能早退，MUST NOT 与 `docRelPaths: []` 混用（同一条口径只有一处）。
- Invariant: 复制三道闸只有一份真身（`utils/export-clipboard` 的 `decideCopy`）—— 组件里出现 `format.value === "epub"` 或 `content.trim() === ""` 就是第二份。
- Invariant: 导出选项的真身是 `packages/contracts/src/export.ts` —— 格式表 id 与 `ExportFormat` 双向对齐，漏一个按钮或塞一个不存在的 id 都会红。
- Invariant: 失败必须看得见（`conventions/failures-must-be-visible.rule.md`）—— 组装失败、复制被挡、保存失败、**章节正文读不出来**四条路都 MUST 在屏上有一句中文。
- Invariant: 竞态令牌 MUST 在成功与失败两条路上各判一次（数次数，不是「至少有一处」）。

## Failure Behavior

1. IF 组装失败，THEN the 组件 MUST 把理由写进 `assembleError` 并禁用复制钮，MUST NOT 让界面留一份空预览当结果。
2. IF 组装还没回来，THEN 复制钮 MUST 禁用（`previewResult.content === '' || assembleError !== ''`），MUST NOT 让「已复制」报在一个空串上。
3. IF 零章的书选了 EPUB 档，THEN 保存 MUST 在打开保存对话框之前被拦住并说清原因，MUST NOT 产出一个空壳文件。
4. IF 剪贴板 API 抛（无权限 / 非安全上下文），THEN the 组件 MUST 提示「无法访问剪贴板」，MUST NOT 静默把按钮切成「已复制」。
5. IF 保存失败，THEN the 组件 MUST 提示「文件未能保存，请检查目录权限」。
6. IF 用户取消保存（`saveFile` 返回 falsy），THEN the 组件 MUST 静默返回，MUST NOT 报「导出完成」。
7. IF 某篇章节正文读不出来（`Promise.allSettled` 的 rejected），THEN 该篇 MUST 被丢出组装集（只留 fulfilled），且屏上 MUST 出现一句可见中文（`contentLoadError`，写明有几篇没读出来），MUST NOT 静默丢弃（`conventions/failures-must-be-visible.rule.md`）。
8. IF 渲染层读到 `window.mochen` 缺席（纯浏览器里打开），THEN 保存 MUST 退回 Blob 下载，MUST NOT 整个动作失效。

## Conformance

符合 = 全部 MUST 满足、全部 invariant 成立、全部失败规则可观测。

```txt
Given 一本书有三个章节、导出对话框刚打开（默认全选）
When 用户点「全不选」
Then 组件不发组装 IPC（shouldAssemble 早退并清空预览）、预览区显示「没勾选任何篇章——勾上要导出的章节才会有预览。」、保存钮禁用
```
