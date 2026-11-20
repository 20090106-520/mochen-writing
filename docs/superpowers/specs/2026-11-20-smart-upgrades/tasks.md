# 任务清单：2026-11-20 写作智能升级

> 依据：同目录 `spec.md`。每项完成后跑对应用例；全部完成后跑 `pnpm verify` 与 `pnpm build`。

## A. 全书摘要 + 人物状态卡

- [x] A1 `packages/contracts/src/book.ts`：加 `BookDigest`、两个上限常量、`BookMeta.digest?`、schema 可选项、`parseBookDigest` 纯函数。
- [x] A2 `packages/contracts/src/index.ts`：确认从 `book.js` 导出（若已有 `export *` 则无需改动）。
- [x] A3 `packages/contracts/test/book-digest.test.ts`：解析 / 截断 / schema 两态用例。
- [x] A4 `apps/desktop/src/main/chapter-recap.ts`：`DIGEST_SYSTEM_PROMPT`、`ChapterRecap.digestize`、`RecapBook.current().meta.digest`、`mergeDigest`、队列串行更新状态卡。
- [x] A5 `apps/desktop/src/main/book-service.ts`：`BookService.mergeDigest` + 在既有 `enqueueMetaWrite` 内只并一格实现。
- [x] A6 `apps/desktop/src/main/system-pack.ts`：新增 `bookDigestBlock`，状态卡作为 `buildContextPack` 的**第二参数**置于上下文段之前（调用方只有 agent-service 一处，放进 `ContextPackInput` 会把那行调用撑破 800 行预算，理由写在函数注释里）。
- [x] A7 `apps/desktop/src/main/agent-service.ts`：上下文包传入 `current.meta.digest ?? null`。
- [x] A8 `apps/desktop/src/main/agent-context-preview.ts`：状态卡字数 / token / `empty` 计入占用条。
- [x] A9 `chapter-recap.test.ts`、`system-pack.test.ts`：新增 A 段用例。
- [x] A10 跑 A 相关 vitest。

## B. 多模型分工 + 失败回退

- [x] B1 `packages/contracts/src/provider.ts`：`utilityProfileId?`（store schema + 外键校验）、`ProviderView.utilityProfileId?`、`setUtilityProfileInputSchema`。
- [x] B2 `apps/desktop/src/main/provider-settings.ts`：`configFor("chat" | "utility")` 四级解析、`setUtilityProfile`、`config()` / `apiKey()` 改为它的投影、删档案 / 删连接时清悬空引用。
- [x] B3 `apps/desktop/src/main/agent-service.ts`：写作轮继续走 `config()`——它现在是 `configFor("chat")` 的投影，判据只有一处。
- [x] B4 `apps/desktop/src/main/chapter-recap.ts`：摘要与状态卡改用 `configFor("utility")`。
- [x] B5 `packages/contracts/src/ipc-channels.ts` + `apps/desktop/src/main/agent-ipc.ts`：新通道 `provider:set-utility`，`handleTrusted` + schema + 中文单句错误。
- [x] B6 `apps/desktop/src/preload`：暴露 `provider.setUtility(profileId | null)`。
- [x] B7 `apps/desktop/src/renderer/src/stores/useProviderStore.ts`：`setUtility` 动作。
- [x] B8 `apps/desktop/src/renderer/src/components/ProviderSettings.vue`：模型面板顶部「后台杂活模型」下拉（跟随主模型 / 各档案）。
- [x] B9 `provider-settings.test.ts`、`agent-ipc.test.ts`、`ipc-guard.ts`（信任规则 + 覆盖表）、`useProviderStore` 两份用例、`chapter-recap.test.ts`：B 段用例与夹具更新。
- [x] B10 跑 B 相关 vitest。

## C. 检索增强（不新增工具）

- [x] C1 新建 `apps/desktop/src/main/doc-tools-search.ts`：整段迁出 `search_docs` 实现，导出 `SearchSources` / `runSearchDocs`。
- [x] C2 `apps/desktop/src/main/doc-tools-host.ts`：删除本地检索实现，改为一行转发；`DocToolHostDeps` 加 `bible?` / `recaps?`；确认总行数 < 800。
- [x] C3 `doc-tools-search.ts`：新增 `source`（`docs|bible|recaps|all`，缺省 `all`）、故事圣经与章末摘要检索、分节回执与「设定库条目不是文稿」提示；`kind` 仅作用于 docs。
- [x] C4 `apps/desktop/src/main/agent-service.ts`：给工具宿主接 `bible` / `recaps` 只读来源（`turnContext.searchSources()`）。
- [x] C5 `packages/agent-runtime/src/tools.ts`：更新 `search_docs` 描述（正文 / 设定库 / 前情，优先于整章读盘）。
- [x] C6 `doc-tools-search.test.ts` 改造 + 新用例；`doc-tools-host.test.ts` 保留转发冒烟。
- [x] C7 跑 C 相关 vitest。

## 收尾

- [x] D1 更新受影响的既有夹具与快照（不新增无关文件）。
- [x] D2 `pnpm verify` 全绿。
- [x] D3 `pnpm build` 全绿。
- [x] D4 如实汇报：改了哪些文件、行为变化、验证结果与未覆盖项。

## 验收标准

1. 写完一章后 `book.json` 出现 `recaps[章]` 与 `digest`；下一轮系统提示最前面有「全书摘要与人物状态」。
2. 把「后台杂活模型」设成另一条档案后，摘要请求打到那条模型；删掉该档案后自动回到主模型。
3. 模型用 `search_docs` 一次能拿到正文命中、设定库命中与前情摘要命中，且回执标明来源。
4. `pnpm verify` 与 `pnpm build` 均通过。
