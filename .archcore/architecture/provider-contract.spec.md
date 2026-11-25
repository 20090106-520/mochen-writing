---
title: "The provider contract: connection/profile shapes, presets, and three-generation migration"
status: accepted
tags:
  - "architecture"
  - "contracts"
  - "api"
---

## Purpose & Scope

本规范对「模型供应商这一面的形状真身住哪、哪些判定只许有一份」有规范力：`packages/contracts/src/provider.ts` 这一份契约面——连接 / 模型档案 / 草稿 / 视图 / 保存回执 / 体检结果 / 拉模型结果这几组 zod 形状与 TS 类型、内置供应商清单与分组表、按主机名认服务商、自定义连接的卡片名、密钥头、模型级窗口与推理档的落盘形状、v1→v2→v3 三代配置迁移、本机端点那几句常量。它是**纯形状 + 纯函数**的一份：**不出网、不写盘、不读存储**——出网在 `main/provider-fetch.ts` 与 `main/provider-models.ts`，密钥落盘在 `credential-store` / `provider-settings`。凡是「同一件事在两处各写一份就会不一致」的判据（密钥头、最高档思考的字、外键完整性、迁移连接 id），真身都在这里。

**2026-11-21 增补**：思考档枚举、最高档在线上叫什么、以及**模型能力表**（哪个模型多大上下文、认哪几档）搬进了叶子模块 `packages/contracts/src/model-capability.ts`。搬的理由：档案形状（`providerProfileSchema` 的 `thinkingLevel`）也要用那个枚举，两边分住会形成 `provider → model-capability → provider` 的循环引用——**两份真身分家**比循环更难查。搬完之后本文件只从那边取类型，不重复定义。

Depended on by: `main/provider-store.ts`（读 / 写 config.json 与迁移的落盘侧）、`main/provider-models.ts` / `main/provider-fetch.ts`（出网与拉名单）、`main/provider-settings.ts`（密钥与档案的装配）、`renderer/components/ModelProfileDialog.vue` 与 `ComposerBox.vue` 的模型 chip（读视图、草稿、识别结果）、`renderer/components/ModelSelect.vue` 的能力区（读窗口与档位）、`packages/agent-runtime/src/provider-client.ts`（只 import 类型，`AuthHeader` / `ThinkingWire` 等）。

Out of scope:

- 出网（`{baseURL}/models`、`/chat/completions`）与失败归类 —— 住 `main/provider-fetch.ts` / `main/provider-models.ts`（`networkFailureOf`）。
- 密钥的落盘与读取（只回存在位）—— 住 `credential-store` 与 `main/provider-settings.ts`；本文件只出 `maskApiKey` 的形状。
- 通道登记与信任分档 —— 住 `contracts/ipc.ts` 与 `conventions/ipc-channel-registration.rule.md`（本文件不登记通道）。
- 界面渲染（分组下拉怎么摆、卡片长什么样）—— 住渲染层组件；本文件只给表与视图数据。

## Surface

- `providerConfigSchema` / `ProviderConfig` — 同文件 — v1 旧形状（`{baseURL, model}` + 两个带默认的后加键），只为迁移能被认出而留。
- `AuthHeader` — 同文件 — 密钥头两档（唯一真身）。
- `ThinkingWire` / `THINKING_WIRE_LABELS` / `THINKING_WIRE_TOP_VALUE` — **`model-capability.ts`** — 最高档思考在线上叫什么（唯一真身）。2026-11-21 从本文件搬过去（叶子模块，避免与档案形状形成循环引用）。
- `THINKING_LEVELS` / `thinkingLevelSchema` / `THINKING_LEVEL_LABELS` / `STANDARD_THINKING_LEVELS` / `thinkingWireValueOf` / `nextThinkingLevel` — **`model-capability.ts`** — 思考档枚举与出站映射（唯一真身）。
- `ModelCapability` / `MODEL_CAPABILITIES` / `capabilityOf` / `thinkingLevelsOf` / `defaultThinkingLevelOf` / `CONTEXT_WINDOW_PRESETS` / `contextWindowLabel` — **`model-capability.ts`** — **模型能力表**（对着厂商文档抄的事实集；查不到就是查不到，不猜）。
- `effectiveContextWindowOf` — 同文件 — 这个模型按哪个窗口算预算（档案 ⇒ 能力表 ⇒ 连接级 ⇒ 默认值）。
- `ProviderGroup` / `ProviderPreset` / `PROVIDER_PRESETS` / `PRESET_BY_ID` / `presetOf` / `PROVIDER_DIALOG_GROUPS` — 同文件 — 预设清单与分组表（表驱动）。
- `CUSTOM_PROVIDER_ID` / `CUSTOM_PROVIDER_LABEL` / `customConnectionLabel` / `providerLabelOf` / `defaultAuthHeaderOf` — 同文件 — 自定义那一档的 id、通用名、带主机名的卡片名、默认头。
- `DetectedProvider` / `PROVIDER_HOST_ALIASES` / `EXTRA_PROVIDER_NAMES` / `detectProviderByBaseURL` — 同文件 — 按主机名认服务商（含别名表、清单外聚合站、主机名兜底）。
- `providerConnectionSchema` / `ProviderConnection` / `providerProfileSchema` / `ProviderProfile` / `providerStoreFileSchema`（含 `superRefine` 外键）/ `ProviderStoreFile` — 同文件 — config.json v3 的形状真身。
- `providerStoreV2Schema` / `LEGACY_CONNECTION_ID` / `guessProviderIdOf` / `MigrationOutcome` / `migrateProviderStore` — 同文件 — v2 旧形状与三代迁移。
- `ProviderConnectionView` / `ProviderProfileView` / `ProviderView` / `ProviderSaveResult` — 同文件 — 递到界面的视图与保存回执（回执多一个主进程分配的 id）。
- `connectionDraftSchema`（收紧的地址正则）/ `profileDraftSchema` / `ConnectionDraft` / `ProfileDraft` — 同文件 — 保存口的草稿形状（与读取路径分工）。
- `VerifyResult` — 同文件 — 连通性体检的三档（软校验）。
- `maskApiKey` — 同文件 — 密钥只回掩码（`••••` + 末四位）。
- `OLLAMA_BASE_URL` / `OLLAMA_FILL_LABEL` / `LOCAL_MODEL_KEY_NOTE` — 同文件 — 本机端点三条常量。
- `ModelListQuery` / `modelListResultSchema` / `ModelListResult` — 同文件 — 拉模型名单的入参与结果（判别联合）。

States: 读取路径（旧存档 → 宽松 schema → 迁移三态）→ 保存路径（收紧 schema → 主进程落盘 → 回执带 id）→ 识别路径（地址 → 别名表 / 聚合站 / 主机名兜底 → `DetectedProvider`）→ 展示路径（视图 / 掩码 / 体检三档 / 拉名单两态）。

## Normative Behavior

1. WHEN 全仓要定连接 / 档案 / 草稿 / 视图的形状，the 契约面 MUST 是本仓唯一一份，MUST NOT 在 main 或 renderer 里另写一份 zod。
2. WHEN 读旧 `config.json`，the 契约面 MUST 用 `.default(...)` 兜住后加的键（`authHeader` / `thinkingWire`），MUST NOT 让没这两项的老存档整份判失败（那会读成「还没有模型」的假死）。
3. WHEN 保存新配置，the 契约面 MUST 走 `connectionDraftSchema` 收紧那条正则（只许 https 或本机回环 http）；而**读取**旧存档的 schema MUST 保持宽松（收紧会把老 store 整份判坏，出网那头另有闸兜底）。
4. WHEN 迁移任意一代配置，the 契约面 MUST 经 `migrateProviderStore` 三态（已是 v3 原样、v2 造一条连接、v1 造连接 + 一条启用档案），MUST 只有三代都认不出才抛，抛的那句 MUST 是能直接给用户看的中文。
5. WHEN 造迁移出来的那条连接，the 契约面 MUST 用固定 `LEGACY_CONNECTION_ID`（`"legacy"`），MUST NOT 用随机 id（同一份老配置反复迁移要落到同一个密钥桶）。
6. WHEN 迁移，the 契约面 MUST 保持档案 id 一个不变（卡片顺序、启用状态、外部引用都指着那些 id）。
7. WHEN 迁后要定这条连接挂在哪家，the 契约面 MUST 经 `guessProviderIdOf`（规范化尾斜杠与大小写后比对预设 baseURL），MUST NOT 猜 —— 认不出老实归 `custom`。
8. WHEN 校验 store 文件，the 契约面 MUST 在 schema 最后关卡做外键完整性（每条档案挂在一条真实存在的连接上），MUST NOT 留「形状合法但语义悬空」到发请求才炸。
9. WHEN 认一条地址是哪家，the 契约面 MUST 经 `detectProviderByBaseURL`（离线、按主机名 + 后缀匹配 + 别名表），MUST NOT 出网去问服务端「你是谁」。
10. WHEN 认出某家，the 契约面 MUST 一并带出该家的 `authHeader` / `keyUrl` / `suggestedModels`（只给名字不算认出来——MiMo 那样手填地址会永远 401）。
11. WHEN 认不出来，the 契约面 MUST 回 `known:false` + 「自定义 · 主机名」，MUST NOT 抛、MUST NOT 返回空串（地址框会反复调它）。
12. WHEN 是清单外但认得出的聚合站，the 契约面 MUST 只给名字（`presetId` / `keyUrl` 空、`suggestedModels` 空）——那些没有出处，不给。
13. WHEN 没有 `models` 出处，the 契约面 MUST 给 `suggestedModels: []`，MUST NOT 猜一个模型名（猜出来的会让「保存」看起来有值，发出去多半 404）。
14. WHEN 显示自定义连接的卡片名，the 契约面 MUST 经 `customConnectionLabel` 带上主机名；解析失败 MUST 退通用名，MUST NOT 抛、MUST NOT 给空串。
15. WHEN 决定密钥发进哪个头，the 契约面 MUST 读连接自己的 `authHeader`（MiMo 是 `api-key`，其余 Bearer），MUST NOT 全局写死 `Authorization: Bearer`。
16. WHEN 决定最高档思考在线上发什么字，the 契约面 MUST 读 `THINKING_WIRE_TOP_VALUE` 配连接自己的 `thinkingWire`，MUST NOT 全局写死 `high`（发 `high` 给只认 `xhigh` 的端点会被整笔 400）。
17. WHEN 界面要解释两档是什么意思，the 契约面 MUST 只读 `THINKING_WIRE_LABELS`（唯一真身），MUST NOT 在组件里另写一份中文。
18. WHEN 把密钥递到界面，the 契约面 MUST 只给 `maskApiKey(key)` 的掩码与 `hasKey` 布尔，MUST NOT 递明文。
19. WHEN 做连通性体检，the 契约面 MUST 用三档 `VerifyResult`（`ok` / `unreachable` / `unverified`），它是软校验、不决定能不能存，MUST NOT 压成布尔。
20. WHEN 拉模型名单，the 契约面 MUST 用 `modelListResultSchema` 判别联合；失败 MUST 是一条可执行中文理由（含「这个地址没返回任何模型」），MUST NOT 只回空数组。
21. WHEN 摆本机端点，the 契约面 MUST 只给 `OLLAMA_BASE_URL` / `OLLAMA_FILL_LABEL` / `LOCAL_MODEL_KEY_NOTE` 三条常量，且本机端点 MUST NOT 进 `PROVIDER_PRESETS`（用户裁定不要本地的）。
22. WHEN 摆供应商下拉，the 契约面 MUST 表驱动 `PROVIDER_DIALOG_GROUPS`（国内 / 国外 / 自定义，末尾永远跟 `custom`）。
23. WHEN `providerSave` 回执要给 id，the 契约面 MUST 由主进程回传 `ProviderSaveResult.connectionId`，MUST NOT 让调用方拿地址回头 `find`（同址双账号必然拿到先存那条）。
24. WHEN 算「这个模型按哪个窗口算预算」，the 契约面 MUST 经 `effectiveContextWindowOf`（档案填过 ⇒ 能力表 ⇒ 连接级），MUST NOT 在主进程与界面各算一遍（两边分头算，占用条的分母与历史切多少就会对不上）。
25. WHEN 能力表里没有这个模型，the 契约面 MUST 回「不知道」（`capabilityOf` 给 `null`、档位回落 `STANDARD_THINKING_LEVELS`），MUST NOT 拿相近的名字顶替、也 MUST NOT 猜一个窗口——猜出来的会让占用条的分母说谎。
26. WHEN 能力表里那个模型**不认 `reasoning_effort`**（百炼用 `enable_thinking`、智谱与 MiMo 用 `thinking.type`、gpt-4o 不是推理模型），the 契约面 MUST 把它的档位集合给成**空数组**，MUST NOT 给一个按下去没反应的控件。
27. WHEN 档案上没存过档位，the 契约面 MUST 用**该模型的默认档**（能力表给的；MiniMax-M3.1-Flash 是 `max`），MUST NOT 一律按 `off` 起手——那一族省略时默认就是 `max`。

## Constraints & Invariants

- Constraint: 契约面是**纯形状 + 纯函数**——不出网、不写盘、不读存储；一旦这里发出请求或落盘，出网闸与密钥分份存储两条约束都会被绕开。
- Constraint: `PROVIDER_PRESETS` 是「有官方文档与密钥页」的清单；聚合站只进 `PROVIDER_HOST_ALIASES` + `EXTRA_PROVIDER_NAMES`，MUST NOT 混进预设表。
- Invariant: 密钥头真身只有一份（连接上的 `authHeader`）—— 预设表那一列与 `detectProviderByBaseURL` 的结果必须同源（测试钉住「两处不许各写一份」）。
- Invariant: 最高档思考的线上字只有一份（`THINKING_WIRE_TOP_VALUE`）—— 凡发请求处都读它，写死字面量就是第二份。
- Invariant: **模型能力表只有一份**（`MODEL_CAPABILITIES`，住在 `model-capability.ts`）—— 窗口与档位集合不许在组件、store、主进程各存一份；表里每一格都有厂商文档出处，抄不着的模型不进表。
- Invariant: 档案上的两格能力（`contextWindow` / `thinkingLevel`）是**模型级**的落点—— 同一端点下不同模型的窗口差着一个数量级，挂在连接上就等于「换模型不换窗口」。
- Invariant: 连接与档案的外键完整性只在 schema 这道最后关卡拒 —— 挪到发请求时才判，用户看到的是「配置好好的却发不出去」。
- Invariant: 迁移连接 id 固定 `legacy`、档案 id 不变 —— 这两条一破，「迁后改的密钥」就会在下次迁移后读不到。

## Failure Behavior

1. IF v3 形状不合法（比如半份 connections），THEN the 契约面 MUST NOT 静默降级去按 v2 读（半份会被当成老配置），MUST 走抛错那条。
2. IF 三代都认不出，THEN the 契约面 MUST 抛一句中文（跨 IPC 直接给用户看），MUST NOT 留半套结构。
3. IF 地址还没填完（坏输入），THEN 识别 MUST 不抛、不返空串（地址框会反复调它）。
4. IF 某条档案的 `connectionId` 在文件里不存在，THEN schema MUST 在读配置时就拒，且理由 MUST 点出是哪个模型挂错了。
5. IF 自定义地址解析不出主机名，THEN 卡片名 MUST 退通用名，MUST NOT 让整张视图挂掉。
6. IF 上游失败理由可能含密钥或地址，THEN the 契约面 MUST NOT 让密钥或上游原文进 `reason`（那是下一层出网件要守的，形状这层只保证 `reason` 是给人看的一句）。
7. IF 保存口给的地址既不是 https 也不是本机回环，THEN MUST 拒；读取旧存档 MUST 不受这条影响。

## Conformance

符合 = 全部 MUST 满足、全部 invariant 成立、全部失败规则可观测。

```txt
Given 用户存档里是 v2（地址全局一份）的 config.json，且地址是 https://api.xiaomimimo.com/v1
When 主进程读配置、跑 migrateProviderStore 走到 v3
Then 造出一条 id 固定为 legacy、authHeader 为 api-key 的连接，档案全部挂上去且 id 一个不变；
     把地址粘进对话框时 detectProviderByBaseURL 认出小米 MiMo 并带回 api-key 头，
     而认不出的地址退回「自定义 · 主机名」、不抛不猜
```
