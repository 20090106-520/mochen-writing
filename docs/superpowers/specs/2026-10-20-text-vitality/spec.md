# 2026-10-20 文本活性代理指标层（P1-⑥）

本 spec 覆盖外部调研报告（`docs/research/2026-10-19-writing-craft-benchmark.html`）P1 清单里的
**⑥ 量化指标代理层**：本仓没有模型概率，就用零依赖的代理读数衡量「哪版更活」，**只作相对比较，
不作绝对判据**。

## 0. 为什么本轮取 ⑥（而不是 P1 里的 ④ / ⑤）

报告 P1 的四项价值序是 ④ 结构上限改每千字 → ⑤ 补用笔层（详略三测 / 章末最后一拍）→
⑥ 量化指标代理层 → ⑦ 退化专项。本轮只动 ⑥，理由两条，都在仓里查过：

- **④ 现在做不了**：「每千字」的基准值要靠真人语料分位才定得下来——那正是 P0-① 的语料缺口。
  没有语料就把绝对数换算成每千字，等于**另编一套数**。
- **⑤ 的前提不成立**：报告说「技能库已有对应文本，接常驻即可」，但全仓 grep「详略三测」「章末最后一拍」
  只命中报告自身——技能库里**没有**这两段原文，⑤ 实际是新写内容，不是接线。
- **⑥ 天然无阻塞**：它的口径就写着「不作绝对判据」，因此不依赖任何阈值校准。

## 1. 一句话口径

新增 `packages/contracts/src/text-vitality.ts`：对一段正文算出三枚**零依赖、无阈值**的代理读数
（字串熵 / 句长突发度 / 字多样性），三枚**都是越大越像人写的**；多稿候选面板顺手把这三枚摆出来，
让用户相对着看。三枚**都不进任何闸**、不改任何阈值、不进 `rankDrafts` 的排序键。

## 2. 三枚读数（口径写死）

1. **字串熵** `charNgramEntropy(text, n = VITALITY_NGRAM_N)`：字符 n-gram（默认 2-gram，换行等字符
   原样参与）频率的香农熵，单位 **bits/gram**，2 位小数。它是**困惑度的代理**（困惑度 = 2^H，同一份
   信息；这里报 H 是因为它是线性量、不制造指数级数字）。短于 n 字 ⇒ `null`。
2. **句长突发度** `sentenceBurstiness(text)`：`B = (σ − μ) / (σ + μ)`。**不另切一遍句**——由
   `sentenceRhythmOf(text)` 的读数反推（`spread = σ/μ` ⇒ `B = (spread − 1) / (spread + 1)`），
   切句与句长统计只此一份（铁律 6）。不足 `SENTENCE_SPREAD_MIN_SENTENCES` 句 ⇒ `null`（与句长节奏同一门槛）。
3. **字多样性** `typeTokenRatio(text)`：不同字数 ÷ 总字数（token = **非空白字符**；中文不切词，以字为 token）。
   3 位小数。无字符 ⇒ `null`。

## 3. 已知偏差（写进注释，不掩盖）

熵与多样性都**随文本变长而偏高**（样本越多，罕见的 n-gram / 字越容易被采到）——这是代理指标的固有偏差，
不是 bug。突发度是尺度无关量，与长度无关。**所以三枚只作「同一次改稿前后」或「同一轮 N 稿」的相对比较**；
两稿字数差得多时，熵与多样性要当心读。这条偏差写进模块注释与面板提示，**不用机器阈值去「修正」它**
（修正就得先编一个修正量，那正是本仓要避免的第二份编数）。

## 4. 契约面

`text-vitality.ts` 导出：

- `VITALITY_NGRAM_N = 2`；
- `interface VitalityReading { charCount; ngramEntropy; burstiness; diversity }`；
- `vitalityOf(text): VitalityReading` 与三个单枚函数 `charNgramEntropy` / `sentenceBurstiness` / `typeTokenRatio`。

`packages/contracts/src/index.ts` 在 `./draft-rank.js` 之后转出。

**刻意不导出**：任何「更活 / 更平」判定，任何聚合总分或权重（三枚是不同的探针，捏成一枚就得先编一套
权重），也不导出「长度可比性阈值」（本刀没有机器消费者，导出即死代码）。

## 5. 渲染层（唯一消费者：多稿候选面板）

- `apps/desktop/src/renderer/src/utils/draft-candidates.ts` 增：
  - `draftVitalityLine(text): string`——三项各出一句，**算不出的那项不硬凑**（同 `draftReadingLine` 的口径）；
  - `DRAFT_VITALITY_NOTE`——讲清方向（越大越像人写的）、长度偏差，并明说**不是判据**。
- `apps/desktop/src/renderer/src/components/DraftCandidates.vue`：每稿在读数行下加一行活性读数；
  面板标题下加那枚提示。
- **不动** `draftReadingLine`、**不动** `rankDrafts` 排序键、不动 IPC / store / 夹具——正文已经在
  `DraftCandidate.text` 里，面板本地算即可（不为显示新读数新增一条通道）。

## 6. 不变量（要能机器判）

1. 突发度**恒等于** `(sentenceRhythmOf(t).spread − 1) / (spread + 1)`——反推不变量，钉住「切句只此一份」。
2. `vitalityOf(t).charCount === t.length`（且与 `aiFlavorGate(t).charCount` 同一口径）。
3. 三枚读数**不参与任何判定**：`aiFlavorGate` 的字段与 `rankDrafts` 的排序结果在本刀前后**逐字不变**
   （既有用例全绿即钉住）。
4. 各项 `null` 的条件可机器判：短于 n 字 / 不足 `SENTENCE_SPREAD_MIN_SENTENCES` 句 / 无字符。

## 7. 明确不做（本刀边界）

- 不做「更活 / 更平」的总判定、不做权重、不设阈值。
- 不进 `aiFlavorGate`、不进体检起报、不进 `rankDrafts` 排序键。
- 不引入任何 NLP / 分词 / 模型概率依赖。
- 不做跨稿机器对比器：本刀只把读数摆出来，比较由人做；等有真实消费者时再补（不为预测中的需求先写实现）。
