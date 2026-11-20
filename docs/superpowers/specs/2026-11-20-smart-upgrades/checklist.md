# 检查清单：2026-11-20 写作智能升级

> 逐条对照 `spec.md` 与 `tasks.md`；每条都已在 `pnpm verify`（513 份用例）与 `pnpm build` 之后复核。

## A. 全书摘要 + 人物状态卡

- [x] 章末摘要写回时一并产出「一句话摘要 + 人物状态」，落进 `book.json` 的 `digest` 一格；跨书返回的写入被丢弃，不覆盖新书（`book-service.test.ts`、`chapter-recap.test.ts`）。
- [x] 状态卡的生成与写回串行排队：同一本书连写两章不会互相覆盖；生成失败只告警，不影响摘要本身（`chapter-recap.test.ts`）。
- [x] 老书 / 生成失败时没有 `digest`，系统提示与升级前逐字一致——不留空标题（`system-pack.test.ts`）。
- [x] 状态卡排在【已装配的上下文】之前，渲染口径只有 `bookDigestBlock` 一处，占用条与真身同取（`system-pack.test.ts`、`agent-context-preview.ts`）。
- [x] 占用条把状态卡的字数与 token 计入，`empty` 判据也把它算进去（`agent-context-preview.ts:82`、`agent-service-history-window.test.ts`）。
- [x] 解析器按码点截断，代理对不会被劈成半个字；缺摘要段回 `null`，人物段可空（`book-digest.test.ts`）。

## B. 多模型分工 + 失败回退

- [x] 「后台杂活模型」是一份外键（`utilityProfileId`），指向不存在的档案会被 schema 与写入两侧拒绝（`provider.ts` 外键校验、`provider-settings.test.ts`）。
- [x] 取数只有 `configFor("chat" | "utility")` 一处判据；`config()` / `apiKey()` 是 chat 的投影，不再有第二套「启用中的那条」（`provider-settings.ts:291`）。
- [x] 降级顺序固定：指定档案 → 启用中的档案 → 其余可选档案；连接缺失或密钥为空一律跳过（`provider-settings.test.ts`）。
- [x] 删档案 / 删连接 / 全部停用后，`utilityProfileId` 自动失效并回落到主模型，不会留下悬空 id（`provider-settings.test.ts`）。
- [x] 新通道 `provider:set-utility` 走 `handleTrusted` + `setUtilityProfileInputSchema`，并在信任规则表里登记；preload 与 `RendererApi` 同步暴露 `setUtility`（`agent-ipc.test.ts`、`renderer-api.test.ts`、`ipc-guard.ts:423`）。
- [x] 渲染层模型面板有「后台杂活模型」下拉，第一项是「跟随主模型」（即 null）；选择失败的原话进 `error`（`ProviderSettings.vue`、`useProviderStore.utility.test.ts`）。

## C. 检索增强（不新增工具）

- [x] `search_docs` 增加 `source`：`docs` / `bible` / `recaps` / `all`，缺省 `all`；非法值当场拒绝并说清可选值（`doc-tools-search.test.ts`）。
- [x] 只有正文命中时，回执与升级前**逐字一致**（老用例一条未改仍然通过）。
- [x] 混合命中时按【正文】/【设定库】/【前情摘要】分节，各自带计数；设定库命中额外说明「不是文稿」（`doc-tools-search.test.ts`）。
- [x] `kind` 只作用于正文；搜设定库或摘要时说明该参数被忽略（`doc-tools-search.test.ts`）。
- [x] 检索实现整体住在 `doc-tools-search.ts`，`doc-tools-host.ts` 只保留一行转发；两端都不超 800 行预算（`pnpm verify` 行数闸）。
- [x] 工具描述更新为「一次可搜正文 / 设定库 / 章末摘要」，模型不必整章读盘就能找到全书事实（`packages/agent-runtime/src/tools.ts`）。

## 收尾

- [x] `pnpm verify` 全绿：prettier → 6 个 tsc → eslint（零警告）→ 包边界 → 行数预算 → 513 份用例。
- [x] `pnpm build` 全绿（main / preload / renderer 三份产物）。
- [x] 规格、任务清单与本清单均为简体中文；代码注释解释「为什么」而不只是「做了什么」。
- [x] 未覆盖项已写明：不做运行中的 HTTP 重发（模型分工只在配置层降级），状态卡不新增 `ContextKind`。
