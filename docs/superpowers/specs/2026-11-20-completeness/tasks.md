# 任务清单 · 2026-11-20 完整性补完

> 依据：`docs/superpowers/specs/2026-11-20-completeness/spec.md`
> 顺序即实施顺序：先小后大，每步跑相关用例；最后统一门禁。

## T1 read_doc 行偏移

- [x] `packages/agent-runtime/src/tools.ts`：`read_doc` 规格加 `from`/`lines`，描述改人话
- [x] `apps/desktop/src/main/doc-tools-host.ts`：行切 + 段内截断 + 回执头
- [x] `apps/desktop/src/renderer/src/utils/tool-args.ts`：卡片文案带行号
- [x] `doc-tools-host.test.ts`：4 条用例

## T2 AI 记忆面板

- [x] `components/MemoryPanel.vue`（digest 可改、recaps 只读）
- [x] `stores/layoutStore.ts`：`SettingsTab` 加 `"memory"`
- [x] `components/SettingsPage.vue`：页签 + 渲染
- [x] `components/memory-panel-wiring.test.ts`；同步可能枚举页签的既有用例

## T3 小项

- [x] 「本轮全部接受」落在 CenterColumn（待审列表所在层，避免每张卡各复制一颗）
- [x] `proposal-card-wiring.test.ts` 增补
- [x] `search_docs` 三处参数描述改人话（只改字符串）

## T4 改文件名

- [x] contracts：`docRename` 通道、`DocRenameResult`、`RendererApi.renameDoc`
- [x] fs-store：`renameDocFile`（exists/missing/io-error 三档）
- [x] `book-service.renameDoc`：迁移 `chapterOrder` / `recaps`，重扫，回 `meta`
- [x] 主进程注册 + `ipc-guard` 规则 + preload
- [x] `useBookStore.renameDocFile` + 标签/当前稿换 relPath
- [x] `LeftSidebar.vue`：行菜单「改文件名」+ 复用行内输入
- [x] 夹具补齐（所有 `satisfies RendererApi`）
- [x] 用例：book-service、renderer-api、useBookStore、left-sidebar

## T5 propose_bible

- [x] contracts：`bible-proposal.ts`、工具名、档案白名单、事件两枚（**不塞 tool-call**：设定提案没有 docRelPath/anchor，塞进去审批与回放都要长分支）
- [x] agent-runtime：工具规格（`ToolOutcome` 不加字段，`bible-proposal` / `bible-written` 走独立事件）
- [x] doc-tools-host：`propose_bible` 分支 + `onBibleProposal`
- [x] agent-service：pending 判别联合 + `bible-approval.ts`
- [x] renderer：`BibleProposalCard.vue` + CenterColumn 三处卡位 + store 表
- [x] 用例：host / agent-service / contracts schema / 卡片接线

## T6 门禁

- [ ] `pnpm verify`
- [ ] `pnpm build`
- [ ] 真机自检四条（spec 验收 4）
