# 2026-10-20 判据阈值真人语料校准（P0-①）

本 spec 覆盖外部调研报告 `docs/research/2026-10-19-writing-craft-benchmark.html` 的 **P0-①**：
把 `packages/contracts/src/ai-flavor.ts` 那四枚经验阈值（`cliche 2 / essay 1 / adverb 5 / cognitive 3`）
换成「真人语料分位 + 误报率」校准出来的数。

> **这一刀只落基础设施，四枚阈值一个不动。**
> 全仓**没有真人语料**：无 corpus 目录，仓内只有测试夹具的构造文本——而夹具是**拿判据造出来的**文本，
> 用它校准等于循环论证（拿判据验判据）。所以本刀只做「数样本 → 算分位 → 算误报率」这条通路，
> 数值一字不改；语料到齐那天，把语料丢进 `packages/contracts/corpus/`，一条命令就出表。
> **不伪造任何数字。**

## 1. 一句话口径

判据的**词表与正则**一律从 `ai-flavor.ts` 现取（单一真身，铁律 6）；`flavor-calibration.ts` 只负责
「按与 `aiFlavorGate` 完全同套的口径数出每个条目的命中数、算出分位与误报率、排成一张表」。
它**不碰 fs**——读语料是入口用例（`flavor-calibration.corpus.test.ts`）的事。

## 2. 交付（只改这些）

| 文件 | 改动 |
| --- | --- |
| `packages/contracts/src/ai-flavor.ts` | `MIN_COUNT` → **导出** `AI_FLAVOR_MIN_COUNT`（改名＋引用点＋注释对齐）；`normalizeDialogueQuotes` 由私有改**导出**。**数值、正则、词表、gate 常量一律不动。** |
| `packages/contracts/src/flavor-calibration.ts` | 新建。纯函数：`flavorTermSamples` / `calibrateFlavor` / `formatCalibrationTable` ＋ 类型 `FlavorTermSample` / `CategoryCalibration` ＋ 常量 `FLAVOR_CORPUS_GAP`。 |
| `packages/contracts/test/flavor-calibration.test.ts` | 新建。纯单测，不碰 fs。 |
| `packages/contracts/test/flavor-calibration.corpus.test.ts` | 新建。读 `packages/contracts/corpus/` 的「投料即出表」入口用例。 |
| `packages/contracts/src/index.ts` | 增 `export * from "./flavor-calibration.js";`（接在 `./ai-flavor.js` 之后）。 |
| `.gitignore` | 增 `packages/contracts/corpus/`（受版权语料不进仓）。 |

改名的唯一理由是：校准脚本要读「现行阈值落在哪儿」，`AI_FLAVOR_MIN_COUNT` 是它的**单一真身**，
导出后可现取，不另抄一份数字。`normalizeDialogueQuotes` 同理：对话标签计数在校准侧要复用**同一份**归一。

## 3. 口径（三句话）

- **样本** = 语料里该类别「出现过（`count ≥ 1`）」的 **(篇 × 条目) 对数**，不是命中总次数。
- **分位** = 最近秩法（nearest-rank）：升序样本里取第 `⌈q·n⌉` 位，**至少第 1 位**（`clamp(⌈q·n⌉, 1, n)`）；
  样本为空 ⇒ `null`。
- **误报率**（`overShare`）= 现行阈值会起报的样本占比 = `count ≥ current` 的样本数 ÷ 样本总数；样本为 0 ⇒ `null`。

计数细则（务必与 `aiFlavorGate` 同口径）：

- 对每个 doc、每个 `AI_FLAVOR_TERMS` 项：整篇 `text.indexOf(term, from)` 循环累加（**副词也照数**——校准要看它的分布）。
- 句式标签：`text.match(正则)?.length ?? 0`，六个正则与标签全部 import 自 `ai-flavor.ts`；
  dialogue 标签的输入必须先经 `normalizeDialogueQuotes(text)`。

## 4. 四类映射（照 `ai-flavor.ts` 既有映射，不另立一份）

| 类别 | 阈值（现行） | 进哪一类 |
| --- | --- | --- |
| `cliche` | 2 | 词表里 category === `cliche` 的项 |
| `essay` | 1 | 词表里 category === `essay` 的项 ＋ **五个句式标签**：升华对偶 / 章末总结体 / 反差模板 / 情绪直陈 / 对话标签 |
| `adverb` | 5 | 词表里 category === `adverb` 的项 |
| `cognitive` | 3 | 认知转述标签（`AI_FLAVOR_COGNITIVE_LABEL`） |

结构级那五条**不跟 `AI_FLAVOR_STRUCTURE_MIN_COUNT` 的专项阈值**走——校准看的是「这个条目在真人语料里
出现几次」的分布，起报线另有其表（那是体检阈值，不在本刀射程）。

## 5. 不变量（要能机器判）

**对任意单篇 `t`，`flavorTermSamples([t])` 里 `category ≠ "adverb"` 的 `count` 总和，恰好等于
`aiFlavorGate(t).hits`。** （gate 的 `hits` 正是「非副词词命中 + 句式标签命中」。）
这条在 `flavor-calibration.test.ts` 里对 ≥3 段样本逐段断言——它是**防止这份计数与真身走岔的唯一机器判据**。
另加一条多篇版：整个语料的非副词样本总和 = 逐篇 gate 的 `hits` 之和。

## 6. 明确不做（本刀边界）

- **不改四枚阈值数值**（cliche/essay/adverb/cognitive 一个不动）——没有真人语料，改了就是编数。
- **不伪造语料**：不往 `packages/contracts/corpus/` 里放任何文件；夹具构造文本不进校准。
- **不做外部检测器**（报告里那些第三方 AI 检测服务不在本仓判据体系内）。
- **不给阈值设「自动写入」通路**：本刀只出表，人看过之后再单独开一刀改数。
- 不碰 `AI_FLAVOR_STRUCTURE_MIN_COUNT` / `AI_FLAVOR_GATE` / `AI_FLAVOR_STRUCTURE_GATED_LABELS`。
