# 收紧「不是A，是B」对偶：一章最多一处，第 2 处退回重写（2026-10-18）

## 一、这一刀要收的是什么

**真机取证**（上一刀的验收）：用应用自身通路（CDP + `window.mochen.startTurn`，stageId `draft`）跑了一轮真实生成，
正文 644 字，体检 `totalHits 3 / 4.66 每千字`，**唯一被点名的写法是「不是A，是B 式升华对偶 ×3**；
模型自己的推理里写着「对偶只用了一处」——它以为守住了约束，实际写了三处，而**退稿闸放行**（`pass=true`）。

病因是两端对不齐（项目铁律／§一百零五 的教训）：

| 端 | 现状 | 后果 |
| --- | --- | --- |
| 生成端 `DE_AI_FLAVOR_STRUCTURE_INSTRUCTION` ③ | 已写明「禁『不是A，是B』式升华对偶，**一章最多一处**」 | 模型照做不了没关系，没有东西替它兜底 |
| 体检 `analyzeAiFlavor` | `AI_FLAVOR_STRUCTURE_MIN_COUNT[AI_FLAVOR_ANTITHESIS_LABEL] = 3`——用了 **1 处不报、2 处也不报，到第 3 处才报** | 起报线比生成端的上限宽了两处 |
| 退稿闸 `aiFlavorGate` | **完全不看结构级条目**：只有「词命中密度 / 句首复读 / 句长过匀」三条理由 | 一章 3 处对偶照样过闸 |

用户逐字指令：

> 「把「不是A，是B」对偶句式的退稿阈值也收紧（同类句式一章 ≤1，超了退回重写）」

**要做成的事**：一章 1 处对偶放行（修辞），**第 2 处即报、即退**。

## 二、纪律

1. **生成端说什么，扫描端就得能扫什么**（§一百零五 教训）。生成端 ③ 写着「一章最多一处」，
   这一刀就是把扫描端的起报线搬到「超过上限处」，并让退稿闸按同一枚数字判退。
2. **同一枚数字只住一处**（铁律 6）。上限只写在 `AI_FLAVOR_STRUCTURE_MIN_COUNT`；退稿闸不另抄一份数字，
   只声明**哪些结构级条目进闸**。
3. **闸不越界当文风警察**（既定取舍）。退稿闸的理念是「宁可放过轻度、不可拦住正常文」，
   它**不许**一键吞下体检的全部起报线（那样 `AI_FLAVOR_TAILCLAUSE_LABEL` 阈值 1 会让
   「人生就是这样」落在对话里也退稿）。所以闸只收**生成端写死了数值上限**的那一条。
4. **先红后绿**（TDD）。判据先写成红的，再动实现。
5. 外部检测器不作为效果评估依据（项目记忆）：效果以「本仓判据全绿 + 真机目检」为准。

## 三、改法（精确到文件与常量）

### 1) `packages/contracts/src/ai-flavor.ts`

- `AI_FLAVOR_STRUCTURE_MIN_COUNT[AI_FLAVOR_ANTITHESIS_LABEL]`：**3 → 2**。
  注释同步：这条起报线即生成端 ③ 写明的上限（一章最多一处）＋1，**体检照报、退稿闸照退**。
- 新增导出：

  ```ts
  export const AI_FLAVOR_STRUCTURE_GATED_LABELS: readonly string[] = [AI_FLAVOR_ANTITHESIS_LABEL];
  ```

  语义 = 「**同时进退稿闸**的结构级条目」；数字从 `AI_FLAVOR_STRUCTURE_MIN_COUNT` 现取，不另抄。
  注释写明**为什么只有它**：③ 是生成端明写的数值上限（没照做就是没照做）；⑥章末四禁／⑨反差模板／
  情绪直陈的起报线是给体检报告看的——闸的理念是「宁可放过轻度，不可拦住正常文」。
- `AiFlavorGateVerdict` 新增字段 `structureOver: string[]`（命中达上限的结构级条目名目）。
  与既有 `startRepeat` / `flatRhythm` 同一路数：**独立拦稿理由各自成字段**，调用方/退稿信一眼看得见病根。
- `aiFlavorGate`：算出 `structureOver`（`charCount >= minChars` 时逐条比对），并入 `pass` 判定。
- 文件头「四类口径」与 `AI_FLAVOR_STRUCTURE_MIN_COUNT` / `aiFlavorGate` 的注释同步更正：
  「阈值只有体检用」这句对**结构级进闸的那几条**不再成立，改为如实描述。

### 2) `packages/contracts/test/ai-flavor.test.ts`（先红）

- 改既有「结构级两类」条：标题与断言由「3 次起报、2 次不报」改为「**2 次起报、1 次不报**」。
- 新增 1 条 describes 内用例：**对偶一章最多一处**——
  - 干净铺底 200 字以上（句首轮换、句长错落、零词命中）＋ 1 处对偶 ⇒ `pass=true`、`structureOver=[]`；
  - 同一铺底 ＋ 2 处对偶 ⇒ `pass=false`、`structureOver` 含该 label，
    且 `hits < minHits`、`startRepeat === null`、`flatRhythm === null`（**证明这一发是结构上限拦的，不是别的理由**）。

### 3) `apps/desktop/src/main/doc-tools-host.ts`（退稿信加一条结构上限话术）

- `verdict.structureOver` 非空时，信里补一句：
  「句式超限：<条目名目>——这条句式一章最多一处，多出来的删掉，或换个写法把同一个意思说清楚。」
- 为什么要改：信的开头是「AI 味超标（每千字 X 处，共 2 处）」——结构退稿时 2 处远不到密度闸门槛，
  这句话会串味，模型容易当成熟度问题去稀释（真机那轮它**自以为只用了一处**）。信里的 `topTerms`
  （重灾区）照旧保留。同一条话术在 `doc-tools-host.test.ts` 里钉一条（`HEAVY + 两处对偶`）。

### 4) 不改动的既有判定（回读确认）

- 生成端 `DE_AI_FLAVOR_STRUCTURE_INSTRUCTION` ③ 原文「一章最多一处」**一字不动**——本刀是让扫描端追上它。
- `AI_FLAVOR_TERMS`、认知转述/章末体/反差/情绪直陈四条正则、`sentenceStartRepeat`、`sentenceRhythmOf`、
  `textSimilarity`、`AI_FLAVOR_GATE` 的四个阈值：**一字不动**。
- 章末体（1）、反差模板（2）、情绪直陈（3）的**体检起报线不动**；它们**不进闸**（见 §二 纪律 3）。
- 退稿闸既有的三条老理由（词密度 / 句首复读 / 句长过匀）、防死循环（原样重交放行）、
  「换汤不换药」点破、连续退稿升级：**一字不动**——本刀只是**加**了一条独立理由。

## 四、验收（AC）

1. 先红：新判据跑出失败（2 次起报未被报、2 处对偶未被拦）。
2. 后绿：`corepack pnpm verify` 全绿（prettier → 6 枚 tsc → eslint → 边界 → 行数预算 → vitest → `VERIFY_EXIT=0`）。
3. 邻近守卫全绿：`doc-tools-host.test.ts` 退稿闸各组（含 `mild` / `clean` 干净稿仍放行——上限只咬对偶）。
4. 收口：commit + push（`feat/plan3-interaction-and-assembly`）→ 读真实 CI → README「## 门禁」节换绑
   → 台账 `docs/superpowers/plans/2026-10-09-full-scan-report.md` 补记新一节 → 清理仓外临时件。

## 五、未收口（如实留档）

- **章末体／反差模板／情绪直陈仍不进闸**：它们的起报线是体检口径，搬进闸会把「人生就是这样」这类
  正常对话句当成机器味（§二 纪律 3 的取舍）。若将来要收，得先在生成端把它们也写成明写的数值上限。
- **「不是X。他是Y」带主语的变体仍不抓**（§一百零八 既定的召回边界，本刀不放宽）：
  真机模型多数写成「不是A，是B」不带主语，放宽会误伤常态合法构句，收益不抵票据。
- 平台审核（番茄/起点等）的过审率**本仓无法度量**；「更像真人」的效果只能由作者目检。
