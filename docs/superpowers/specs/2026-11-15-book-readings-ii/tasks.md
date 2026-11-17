# 任务清单 · 本书读数第二刀

## T1 段落节奏读数

- [x] `packages/contracts/src/style-profile.ts`：新增 `PARAGRAPH_SPREAD_MIN_PARAGRAPHS = 10`（注明样本门槛）
- [x] `StyleProfile` 新增 `paragraph: { mean; spread } | null`，在 `styleProfileOf` 复用已有 `paragraphs`
- [x] `prompt-assembly.ts` 的 `styleProfileSentence` 追加段长读数；`null` 时不报这一项

## T2 叙述人称粘性

- [x] `packages/contracts/src/dialogue.ts`：`scanQuotes` 行间补 `visit("\n", false)`；新增导出 `narrationOf`
- [x] `packages/contracts/src/narration-person.ts`（新）：`NarrationPerson` + `narrationPersonOf`
- [x] `packages/contracts/src/index.ts`：导出 `./narration-person.js`
- [x] `prompt-assembly.ts`：新增 `narrationPersonSentence`，`defaultPromptFor` 按非空注入

## T3 章尾回声

- [x] `packages/contracts/src/book.ts`：`DocRef.closing?: string` + schema
- [x] `packages/fs-store/src/scan.ts`：`closingLineOf`，`docMetaOf` / `docRefOf` 带上 `closing`
- [x] `packages/agent-runtime/src/context.ts`：docs 入参加 `closing`；`AssembledContext.closings?`；装配末尾同构计算
- [x] `prompt-assembly.ts`：新增 `closingsSentence`，紧跟 `openingsSentence` 注入

## T4 测试

- [x] contracts：`style-profile.test.ts` 段落读数与门槛
- [x] contracts：`dialogue.test.ts` 的 `narrationOf` 排除引号内、保留行界
- [x] contracts：`narration-person.test.ts`（新）四类代词 / 排除「其他」/ 门槛 / `dominant`
- [x] fs-store：`scan-excerpt.test.ts` 的 `closing`
- [x] main：`prompt-narration-person.test.ts`（新）三分支 + 当前章不算 + 空样本
- [x] main：`prompt-closings.test.ts`（新）不足两章 / 纯符号过滤 / 取末 5 条 / 叮嘱
- [x] 顺带修既有深比较夹具：`book-service-create-doc-io.test.ts` 的 DocRef 期望补 `closing: ""`

## T5 门禁

- [x] `pnpm typecheck`
- [x] 相关包 vitest（6 个文件、65 用例全过）
- [x] `pnpm verify` → `VERIFY_EXIT=0`（482 个测试文件全过）
- [x] 汇报：如实列出通过项与未做项（不推送远端）
