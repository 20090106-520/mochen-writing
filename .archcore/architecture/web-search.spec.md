---
title: "Free web search source chain: multi-source fallback, coverage gate and cooldown"
status: accepted
tags:
  - "architecture"
  - "main-process"
---

## Purpose & Scope

本规范对「一次免费联网搜索怎么出网、挑源、判重、回执」有规范力：`apps/desktop/src/main/web-search.ts` 这一份文件，源链主入口 `webSearch`、三源解析器（DuckDuckGo / 必应 / 360）、共用归一 `normalizeResults`、来源键回执 `webSearchReceipt`、冷却与失败簿记（`coolDown` / `runSourceChain`）的取证都在这一层。它是主进程唯一一条「抓搜索页 HTML + 正则解析」的只读出网通路，无 API key、无第三方搜索 SDK。

Depended on by: `agent-service.ts`（`webSearch(query, { fetchImpl: abortableFetch(fetch, signal) })`，须接**当轮那只 AbortController**）、`doc-tools-host.ts`（按 `WebSearchError.kind` 分流、非本错误一律换中文兜底）、`provider-fetch.ts`（`abortableFetch` 的 `WebFetchLike` 类型）、`web-read.ts`（同一套 fetch 纪律与类型）。

Out of scope:

- 抓回来的正文怎么用、写不写盘 —— 归 `doc-tools-host.ts` 与 `web-read.ts`；本层「一个字都不落盘」。
- 卡片与回执在界面上的排版 —— 归渲染层；本层只出给模型读的那份文本。
- 来源键的算法本体 —— 真身住 `@mochen/contracts` 的 `sourceKey`，本层只调它。

## Surface

- `webSearch(query, options)` — @apps/desktop/src/main/web-search.ts — 源链主入口：跑链 → 判重 → 全落空则抛 `WebSearchError`，答上就回 `WebSearchOutcome`。
- `runSourceChain` — 同文件 — 只管「源链怎么走」：按序试、该进冷却的进冷却、全挂了抛；判重与措辞不归它。
- `serveResults` — 同文件 — 跨搜索判重：只跟**紧邻的上一次**比、只在 TTL 内有效，并刷新记忆。
- `coolDown(sourceId, at)` — 同文件 — 打进冷却，时长按**连续失败次数**翻倍，封顶 `SOURCE_COOLDOWN_MAX_MS`。
- `cooldownUntil` / `consecutiveFailures` / `lastServed` — 同文件（模块级唯一真身）— 冷却表 / 失败计数 / 判重记忆。
- `resetWebSearchState()` — 同文件 — 清空上述三份模块级状态的**唯一**复位口（测试与探针用）。
- `WebSearchError` — 同文件 — 源链唯一会抛的错误类型，带 `kind: "unavailable" | "empty"`。
- `WebSearchOutcome` / `WebSearchResult` / `SourceAttempt` — 同文件 — 回执与单源尝试的形状。
- `WEB_SEARCH_SOURCES` / `WebSearchSource` / `WebFetchLike` — 同文件 — 源链顺序（即优先级）与注入口。
- `normalizeResults` / `titleEchoKey` — 同文件 — 各源共用的去重 + 截断 + 截条数。
- `parseDuckDuckGoHtml` / `parseSo360Html` / `parseBingHtml` — 同文件 — 三源解析器（各自整块切，不扫全页）。
- `isThrottled360Page` / `isSo360NoiseCard` / `bingCoverage` / `BING_MIN_COVERAGE` — 同文件 — 频控页、噪音卡、质量闸门。
- `webSearchReceipt(outcome)` — 同文件 — 给模型读的回执排版（来源键编号）。
- `WEB_SEARCH_RESULTS_LIMIT` / `WEB_SEARCH_SNIPPET_LIMIT` / `WEB_SEARCH_SOURCE_TIMEOUT_MS` / `WEB_SEARCH_URL_LIMIT` / `SOURCE_COOLDOWN_MS` / `SOURCE_COOLDOWN_MAX_MS` / `SOURCE_DEDUP_TTL_MS` — 同文件 — 七枚公开常量。

States: 空闲 → 一轮搜索（按序试源）→ 答上（回 `WebSearchOutcome`，该源清零）或全落空（抛 `WebSearchError`）；源被拒 / 连不上则进冷却（指数退避），相邻两次搜索之间判重记忆生效。

## Normative Behavior

1. WHEN 发起一轮搜索，the 层 MUST 按 `WEB_SEARCH_SOURCES` 顺序试源（DuckDuckGo → 必应 → 360 兜底），答上即止。
2. WHEN 一个源在冷却期内（`until > now()`），the 链 MUST 跳过它并写进 `skipped`，MUST NOT 去试。
3. WHEN 一个源答上（`ok` 且结果非空），the 链 MUST 清零它的 `consecutiveFailures` 与 `cooldownUntil`。
4. WHEN 一个源返回 `ok` 但 0 条、或 `reason === "empty"`，the 链 MUST 视作「源是好的、这次没搜着」——不进冷却、继续试下一个。
5. WHEN 一个源返回 `network` 或 `unavailable`，the 链 MUST 调 `coolDown` 并把它记进 `broken`。
6. WHEN 源自带 `hint`（empty 档），the 链 MUST 收集它，全链落空时择优透出一句。
7. WHEN 源链跑完，the 层 MUST 在**源链之后**才判重（`serveResults`），MUST NOT 在每个源答上时判。
8. WHEN 判重后结果一条不剩，the 层 MUST 抛 `WebSearchError(kind:"empty")` 并说清是「重复」而非「没搜到」。
9. WHEN 判重，the 层 MUST 只跟紧邻上一次比、只在 `SOURCE_DEDUP_TTL_MS` 内有效，并刷新记忆为**本轮全部**结果的键。
10. WHEN 拼一条回执，the 层 MUST 用 `sourceKey(url)` 而非序号作编号，并 MUST NOT 在页脚放举例的键。
11. WHEN 各源出结果，the 层 MUST 经同一份 `normalizeResults`（去重 / 摘要截断 / 截条数），MUST NOT 一个源一个口径。
12. WHEN 归一，the 层 MUST 先剔空标题与非 `http(s)` 链接，并归一掉跟踪参数与 `#` 锚点。
13. WHEN 摘要超长，the 层 MUST 截断并补省略号，断点优先落在标点或空白上。
14. WHEN 单条超时，the 层 MUST 用 `AbortSignal.timeout(WEB_SEARCH_SOURCE_TIMEOUT_MS)`，且**读 body 必须在源自己的 `try` 内**。
15. WHEN 360 回 200 + 频控页，the 层 MUST 按 `unavailable` 处置（MUST NOT 当「搜了没结果」）。
16. WHEN 必应结果 coverage `< BING_MIN_COVERAGE`，the 层 MUST 归 `empty` 并带一句「压成 2–4 个关键词」的 hint，MUST NOT 把词典条目递出去。
17. WHEN 360 结果含噪音卡（回显问题卡、落回 360 搜索/AI 页、聚合落地页），the 层 MUST 按 `isSo360NoiseCard` 剔掉。

## Constraints & Invariants

- Constraint: 本文件正贴 800 行预算顶（796 / 800）—— 只读工具、单文件自足，改动前先看 `conventions/source-line-budget.rule.md`。
- Constraint: 真实出网只在本层，`fetchImpl` 一律注入 —— 渲染层碰不到网络，测试给假实现。
- Constraint: 只读工具 —— 结果只回给模型看，**一个字都不落盘**；要保存由模型整理后走 `write_doc`（用户审批）。
- Constraint: query 不改写 —— 长问句压关键词这件事交给模型自己做，本层不替它猜（必应退化无可靠静态预测器）。
- Invariant: 源链顺序的真身只有 `WEB_SEARCH_SOURCES` 一处；冷却表 / 失败计数 / 判重记忆是模块级状态，唯一复位口是 `resetWebSearchState`。
- Invariant: `WebSearchError` 是源链唯一会抛的类型，`kind` 必须分 `unavailable`（源坏了 / 被拒 / 在冷却）与 `empty`（源都好、这说法没搜着）—— 合成一句就把两种下一步动作搅在一起。
- Invariant: 调用方必须按 `kind` 分流；非 `WebSearchError` 的异常 MUST NOT 把英文 message 透给用户（`doc-tools-host.ts` 换中文兜底）。
- Invariant: 来源键真身只有 `contracts` 的 `sourceKey` —— 回执与工具卡两边都调它，本层不另立第二份。
- Invariant: 三态失败（`network` / `unavailable` / `empty`）必须分得开 —— 前两种进冷却、第三种不进，判据落在 `reason` 上而不是 message 串。
- Invariant: 共用归一只有 `normalizeResults` 一份；噪音判据收在 360 自己一侧（`isSo360NoiseCard`），共用层不替别的源写。
- Invariant: 源抛异常不许掐断整条链 —— `runSourceChain` 的第二道 try 把「一个坏源」降级成记一条失败，继续试下一个。

## Failure Behavior

1. IF 源 `run` 抛异常，THEN the 链 MUST 记一条 `network` 失败、进冷却、继续试下一个，MUST NOT 掐断整条链（否则「三个源都试一遍」实际只试了一个）。
2. IF 页面非 2xx，THEN the 层 MUST 把 403 归 `unavailable`、其余归 `network`。
3. IF 360 回 200 + 访问异常页，THEN the 层 MUST 归 `unavailable`（不认这一页就会每轮重试、每轮被挡）。
4. IF 必应塌成词典（coverage 低于闸门），THEN the 层 MUST 归 `empty` 并透出 hint，MUST NOT 递错货。
5. IF 全链落空且一个坏源都没有，THEN the 层 MUST 抛 `empty`（有 hint 就透 hint[0]），MUST NOT 混成 `unavailable`。
6. IF 全链落空且至少一个坏源，THEN the 层 MUST 抛 `unavailable` 并把坏源列全。
7. IF 所有源都在冷却、一个都没试，THEN the 层 MUST 抛 `unavailable` 并带 `waitHint`（说清最长还要等 N 分钟）。
8. IF 判重后一条不剩，THEN the 层 MUST 抛 `empty` 说「重复」并给下一步出路（换更具体的词 / 用上一轮来源）。
9. IF 源答上一次，THEN the 层 MUST 清零其失败计数 —— 否则「断网三秒 + 之后一直正常」会一路涨到一小时封顶（那是在惩罚早就恢复的源）。
10. IF 源读 body 超时，THEN the 源 MUST 回 `network` 失败回执，MUST NOT 让 `AbortError` 抛出源（写在 catch 之外就会这样）。

## Conformance

符合 = 全部 MUST 满足、全部 invariant 成立、全部失败规则可观测。

```txt
Given 三个源都在冷却期内（cooldownUntil 未到期）、且 DuckDuckGo 与必应此前都只回 empty
When 发起一轮 webSearch
Then 一个源都不去试，抛 WebSearchError(kind:"unavailable")，message 带「最长还要等 N 分钟」
```
