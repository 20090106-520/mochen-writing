# 2026-11-21 · 模型能力表与模型下拉里的两枚开关

## 一、这一刀是怎么来的

用户拿 MiniMax Code 的模型菜单截图来问：**「像这样的东西没有弄上去没有修改」**——
截图上是两样东西：

1. 模型下拉右侧一块「**上下文窗口**」（`512K` ✓ / `1M`「用量较高」）；
2. 一块「**推理等级**」（`default` / `low` / `medium` / `high` / `xhigh` / `max`）。

本仓当时的状态（逐条核过代码，不是印象）：

| 截图里的东西 | 本仓当时 | 在哪 |
|---|---|---|
| 模型下拉列表（搜索 / 当前项 ✓ / 分组） | **有**，而且重排过三次 | `ModelSelect.vue`（提交 `ef51d80` / `904aa2d` / `6bffd16`） |
| 推理等级 | **有，但形态不同**：四档 `off\|low\|medium\|high`，且是**点击循环**的 chip | `contracts/src/per-run.ts`、`composer-chips.ts` |
| 上下文窗口 | **有，但形态不同**：**连接级手填数字**，收在模型设置的「高级选项」折叠区，默认 24000 | `ModelProfileDialog.vue` |
| 每行模型自带 thinking / context / effort 开关 | **没有** | —— |

最后那一项是**主动定案不做**的（`2026-11-08-minimax-code-benchmark.md` 第七节，
原先写着「上游 `/models` 不提供这些能力位，硬做就是编」，依据是第一百七十节）。

用户裁定要补，于是这一刀开工。

## 二、三条定案（用户 2026-11-21 拍板）

1. **补全**：能力表 + 模型下拉里的两枚开关。
2. **上下文窗口挂模型级**：每个模型各有窗口，不是连接级。
3. **推理等级每模型一档，切模型带着走**。

## 三、关键的一步：换数据源，而不是硬做

第一七〇节那句「硬做就是编」在**当时是对的**——上游 `GET {baseURL}/models` 只回
`id / object / created / owned_by / supported_endpoint_types`，而 `supported_endpoint_types`
一律是 `["openai"]`，区分不出模态，更给不出窗口与档位。

**解法不是从 `/models` 猜，是另找一份有出处的数据**：本仓自己维护一张
**模型能力表**（`packages/contracts/src/model-capability.ts` 的 `MODEL_CAPABILITIES`），
逐条对着**厂商官方文档**抄，每格带出处 URL。表里没有的模型一律走通用口径
（`STANDARD_THINKING_LEVELS` + 保守默认窗口 24000）——那是「按最常见的那套办」，
**不是对这个模型的断言**。

⇒ 这条「照搬 MiniMax Code」的路线第一次是**改了形状才搬得动**：不是那套 UI 搬不动，
是那份数据的上游给不出来。

## 四、查证过程里挖出的一条更要紧的事实

逐家查官方文档时发现：**本仓只发 `reasoning_effort`，而只有一部分模型认它。**

| 模型 | 认不认 `reasoning_effort` | 它用的是什么 |
|---|---|---|
| MiniMax-M3.1-Flash | 认 | `low`/`medium`/`high`/`xhigh`/`max`，省略时默认 `max`，**强制开启思考** |
| MiniMax-M3 | **不认** | 官方明写「其他模型会忽略该字段」 |
| Gemini 3 Flash / 3 Pro | 认 | 兼容层映射到 `thinking_level`（Flash 认 minimal/low/medium/high，Pro 只认 low/high） |
| DeepSeek 现行模型（flash / v4-pro） | 认 | `low`/`high`/`max`，默认 `high` |
| 阿里云百炼 qwen-* | **不认** | `enable_thinking`（布尔） |
| 智谱 GLM-4-* | **不认** | `thinking.type`；且 GLM-4 根本不支持思考 |
| 小米 MiMo-v2.6-* | **不认** | Chat 用 `thinking.type`；Responses 才用 `reasoning.effort` |
| gpt-4o / gpt-4o-mini | **不认** | 非推理模型 |
| OpenRouter 的 claude-sonnet-4.5 | **不认** | 用 `reasoning.effort`，不是顶层那个 |

⇒ 能力表里这些模型的档位集合是**空数组**（= 不认这一档控制）。
界面上那一枚据此**置灰并说明原因**，而不是摆一个按下去没反应的东西——
这与本仓「控件不许说自己不信的话」那条铁律是同一件事。

**顺带修掉的一个旧坑**：过去思考 chip 的「关闭」档对 gpt-4o 这类模型也摆着，
用户可以把它设成「深度」——那等于往一个不认这字段的端点发 `reasoning_effort=high`。
现在那类模型上这一枚直接是灰的。

## 五、做了什么

### contracts（`packages/contracts/src/`）

- **新叶子模块 `model-capability.ts`**：思考档枚举（扩到六档）、`ThinkingWire` 一族、
  能力表与它的查法、`effectiveContextWindowOf`、上下文窗口的常用档与写法。
  - 搬家的理由：档案形状（`providerProfileSchema` 的 `thinkingLevel`）也要用那个枚举，
    两边分住会形成 `provider → model-capability → provider` 的循环引用——
    **两份真身分家**比循环更难查。
  - `per-run.ts` 随之归并（内容全部搬进叶子模块，该文件删除）。
- **档案（= 模型）多两格**：`contextWindow?` 与 `thinkingLevel?`（老档案没有这两格照样读得出）。
- **窗口判据一处**：`effectiveContextWindowOf` = 档案填过 ⇒ 能力表 ⇒ 连接级 ⇒ 默认值。

### 主进程（`apps/desktop/src/main/provider-settings.ts`）

- `upsertProfile` 收那两格（`undefined` = 保持现状，`null` = 明确清空，与 `apiKey` 同一族语义）；
- `config()` 的 `contextWindow` 改走 `effectiveContextWindowOf`（占用条的分母与历史切多少都读这一格）。

### 渲染层

- `useProviderStore`：`activeCapability` / `activeThinkingLevels` / `activeThinkingLevel` /
  `activeContextWindow` 四个读数 + `setModelCapability` 写回 + `adoptActiveThinkingLevel` 同步。
- `useAgentStore`：`adoptThinkingLevel`（换模型时运行态跟着换）+ `cycleThinking(levels?)`
  （循环**在当前模型认的档位集合里**走，走不出去）。
- `ModelSelect.vue`：**改成两栏并排**（2026-11-21 按用户截图重做）——
  左栏是模型名单（搜索 / 正在用 / 列表），右栏是那块**级联菜单**
  （「模型 › / 推理等级 › / 自定义模型」，点进去右栏换成那一屏：档位 / 上下文窗口）。
  菜单那一块单独成组件 `ModelSelectMenu.vue`（不塞进 ModelSelect：那份已经贴着 800 行门禁）。
  - 截图里那一屏是「低 / 中 ✓ / 高」；本仓给的是**这个模型真认的档位**（能力表驱动），
    认不得的那一族那一行置灰并说明——摆一个按下去没反应的控件是本仓明令不许的。
- `composer-chips.ts`：思考 chip 的提示报的是**实际发出去的那个字**（能力表认得这个模型时，
  档位名就是线上那个字）；不认时置灰并说明。
- **写模型名与写模型能力，两件忙态各说各的**（收尾时补上的一条）：
  - store 里 `switching`（正在写回**模型名**）与 `capabilityWriting`（正在写回**这个模型的能力**）
    **是两个标记**：写窗口时若沿用 `switching`，屏幕上会闪「正在写回模型名…」——
    那是一句与当前动作无关的话（假话）。浮层里于是有两句：「正在写回模型名…」与「正在写入模型能力…」。
  - **写能力失败的理由搬进浮层看得到的那个通道**（`switchError`）：`error` 只给设置页，
    浮层里看不见——写窗口失败而屏上零解释，就是「点了没反应」。
    `setModelCapability` 因此**不动** `switching`（那是模型名那一件事的标记）。

### 顺带拆的两处（行数硬门禁）

- `appearance-surface-ladder.test.ts` 贴到 800 行 ⇒ **普查表拆成** `appearance-surface-ladder.sites.ts`
  （表是数据、律是测试，两半不共享状态；同仓先例：`agent-store-fixture.ts`）。
- `CenterColumn.vue` 贴到 800 行 ⇒ 三根线拆成 `composables/useModelCapability.ts`。

## 六、门禁

`pnpm verify` 全绿（prettier / tsc 六枚 / eslint / 包边界 / 行数预算 / vitest）。

新增用例：

- `packages/contracts/test/model-capability.test.ts`（能力表 / 六档 / 循环 / 出站映射 / 窗口判据）
- `apps/desktop/src/main/provider-settings-model-capability.test.ts`（档案两格的落盘与清空）
- `apps/desktop/src/renderer/src/stores/useProviderStore.model-capability.test.ts`（渲染层读数与写回）
- `apps/desktop/src/renderer/src/components/model-capability-wiring.test.ts`（接线契约）
- `composer-chips.test.ts` 补四条（能力表驱动的循环次序与「不适用」置灰）
- `useProviderStore.model-capability.test.ts` 补三条（写能力**不动** `switching`、失败理由进浮层通道、
  写成功后旧理由被清掉）
- `model-capability-wiring.test.ts` 补两条（两枚开关各有各的忙态文案、写能力的标记喂进浮层）

## 七、这一刀**没有**做的（如实记着）

1. **各家自己的思考开关字段没接**：百炼的 `enable_thinking`、智谱与 MiMo 的 `thinking.type`、
   OpenRouter 的 `reasoning.effort`——本仓仍然只发顶层 `reasoning_effort`。
   界面上对这些模型是把思考那一枚**置灰**（说清它无效），而不是替它们接上另一个字段。
   接上是另一刀：那是**新增出站字段**，得按「一个出站字段名只许一处映射点」那条律另做。
2. **Gemini 的 `minimal` 档没列**（只列 low/medium/high）——官方兼容层还认它，
   但它是**子集**，少列一档不会把用户送到上游不认的值上。
3. **`MiniMax-M2.5` 没动**：预置表里还有它，第三方来源称 2026-11-18 起对按量付费用户下线，
   **官方出处没查到** ⇒ 既没从预置表里删，也没在能力表里给（没有出处就是没有，不猜）。

## 八、同日补做的两件事（用户 2026-11-21 拍板）

1. **预置表里的退役模型名已按官方文档清理并换成在售型号**：
   - 百炼：`qwen-turbo`（官方任何一张表里都没有）→ 换成当前主推三档
     `qwen4-max` / `qwen3.7-plus` / `qwen3.8-flash`
     （官方《文本生成与视觉理解》推荐模型表，1M 上下文）。
     `qwen-max` / `qwen-plus` 官方仍可用但列为「旧版模型，不再作为首选推荐」，于是让位。
   - DeepSeek：`deepseek-chat` / `deepseek-reasoner`（2026-07-24 退役）→
     `deepseek-flash` / `deepseek-v4-pro`（官方《Models & Pricing》，都是 1M）。
   - Kimi：`moonshot-v1-8k` / `kimi-k2-0905-preview`（官方《模型列表》已下线）→
     `kimi-k3.1-pro` / `kimi-k3.1-pro-highspeed` / `kimi-k3`（都是 100 万 token 上下文）。
     **端点没换**（官方《API 概述》：base_url 仍是 `api.moonshot.cn/v1`），
     只是取密钥的控制台搬到 `platform.kimi.com/console/api-keys`。
   - 能力表侧同步补了 qwen4-max / qwen3.7-plus / qwen3.8-flash（1M，思考走 `enable_thinking`
     ⇒ 不认 `reasoning_effort`）与 kimi-k3.1-pro / kimi-k3（1M，顶层 `reasoning_effort`
     取 low/high/max，默认 max）。**已下线的那些老名字在能力表里仍留着窗口**（窗口是上限约束：
     老配置里可能还有这些模型名）。
   - 钉住它的用例：`provider-presets.test.ts` 两条（不许摆已下线型号 / 换成的是当前在售型号）。
2. **作品目录失效的那条记录已清掉**：
   `<appData>/recent-books.json` 里两条指向已删目录 `C:\Users\潇潇\Desktop\新建文件夹`
   的记录已清空（其中一条的路径还写成了 `C:////Users////…` 这种斜杠形状），
   启动时那条 `book:open` ENOENT 随之消失。**盘上的书目录本来就不存在**（被删过），
   这次只清指针，没重建空壳。
