# 复读闸：同一句不许原样写第三遍（2026-10-18）

## 一、这一刀要收的是什么

**真机取证**（本轮巡检既有产物时抓到的）：`C:\Users\17863\Desktop\墨宸巡检书\chapters\第一章 试笔.md`
（300813 字节，2026-10-10 19:05）**共 3201 行，其中 3199 行是同一句话**——
「林潮生沿着码头往深处走，咸雾一层层漫上来，灯影在水里碎成金箔。」（去重后 distinct=3）。
即模型在生成时打转，把同一句原样写了三千遍。

用户逐字指令：

> 「用朱雀那个网站检测一下AI味道，然后再反复修改优化」

朱雀（腾讯 AI 检测助手）实测三发：同一份稿子一次报「未发现明显的人工创作特征」、
一次报「人工创作特征较弱」、复测又给「AI 生成概率 81.95%」——**读数抖动、且不给逐句标红**，
只能当粗略定向参照（项目记忆已有此结论）。真正可定位、可闭环的病根是上面这份**复读产物**。

病因是闸口对「复读」的覆盖有两个洞：

| 洞 | 现状 | 后果 |
| --- | --- | --- |
| 洞 1 · 结构级判据 | `aiFlavorGate` 只有四条理由（词命中密度 / 句首复读 / 句长过匀 / 结构上限）；`sentenceStartRepeat` 要求同一开头字占比 ≥0.6 | 「A 句 B 句 A 句 B 句」交替打转时占比约 0.5 **不触发**；两句长短相差大时 `flatRhythm` 也可能不触发 ⇒ 逃逸 |
| 洞 2 · 重复句判据只在体检 | `doc-checkup.ts` 的 `findDuplicateSentences` 能报「≥12 字的相同句子出现 ≥2 次」，但**只是巡检面板的报告，不进写入闸** | 打转的稿子照样能落盘 |

生成端（`DE_AI_FLAVOR_STRUCTURE_INSTRUCTION`）此前 ①–⑨ 条也没写过「不许打转」。

## 二、纪律

1. **生成端说什么，扫描端就得能扫什么**（项目铁律／§一百零五 教训）。生成端 ⑩ 写「同一句一章最多出现两次」，
   扫描端就得有同一枚数字的判据，并进退稿闸。
2. **同一份判据只许一处实现**（铁律 6）。重复句统计的**真身下沉 contracts**，巡检面板
   （`findDuplicateSentences`）改为委托它，不再各抄一份切句与计数。
3. **闸不越界当文风警察**（既定取舍）。判退线设在 3 次（生成端上限 2 ＋1）——**两次留作有意复沓的余地**
   （叠句、回环、呼应都是有意的文学手法），三次以上才是原地打转。
4. **先红后绿**（TDD）。判据先写成红的，再动实现。
5. 外部检测器不作为效果评估依据（项目记忆）：效果以「本仓判据全绿 ＋ 真机目检」为准。

## 三、改法（精确到文件与常量）

### 1) `packages/contracts/src/ai-flavor.ts`（扫描端真身）

- 新增常量与类型：

  ```ts
  export const AI_FLAVOR_REPEAT = { minChars: 12, gateMinCount: 3 } as const;

  export interface RepeatedSentence {
    sentence: string;
    count: number;
    /** 出现在哪些篇（contents 下标去重、升序）。单篇调用（如退稿闸）恒为 [0]。 */
    docIndexes: number[];
  }

  export function repeatedSentences(
    contents: string[],
    minChars = AI_FLAVOR_REPEAT.minChars
  ): RepeatedSentence[];
  ```

  切句**复用私有 `sentencesOf()`**（`/(?<=[。！？…；])/`，与体检同一套 lookbehind），不另开一份。
  返回 count ≥2 的句（按次数降序），**这是重复句统计的唯一实现**。
- `AiFlavorGateVerdict` 新增字段 `repeatOver: RepeatedSentence[]`——与 `startRepeat` / `flatRhythm` /
  `structureOver` 同一路数：**第五条独立拦稿理由自成一个字段**，退稿信与用例一眼看得见病根。
- `aiFlavorGate`：算 `repeatOver`（`charCount < minChars` 时为空数组；否则取 `[text]` 的
  `repeatedSentences()` 里 count ≥ `AI_FLAVOR_REPEAT.gateMinCount` 的条目），并入 `pass` 判定。
- 文件头「四类口径」注释同步补一条复读口径。

### 2) `packages/contracts/test/ai-flavor.test.ts`（先红）

- 新增 describe「ai-flavor · repeatedSentences + 复读闸」：
  - `repeatedSentences`：同一句出现 3 次 → 报 1 条 `count=3`；不足 `minChars` 的短句重复不报；
    只出现 1 次的长句不报；按次数降序。
  - 退稿闸：干净铺底（句首轮换、句长错落、零词命中）＋ 同一句 ×3 ⇒ `repeatOver` 命中、`pass=false`，
    且 `hits < minHits`、`startRepeat === null`、`flatRhythm === null`（**证明是复读条拦的**）；
    同一铺底 ＋ 同一句 ×2 ⇒ `repeatOver` 为空、`pass=true`（有意复沓的余地）。
  - 洞 1 回归：两种句式 **A B A B…** 交替（各出现 ≥3 次）⇒ `repeatOver` 两条都命中、`pass=false`
    ——钉住「句首占比 0.5 逃逸 `startRepeat`」的那个洞。
- 既有「副词不算重罪」条的样本要改：旧样本是「5 句一循环 ×6 遍」，其中
  「路静静延伸，一直延伸到看不见的地方。」（≥12 字）会重复 6 次、被复读条拦下——
  那不是该用例要测的事（它测的是「副词不进重罪」）。改成 30 句互不相同的副词堆叠稿。

### 3) `apps/desktop/src/renderer/src/utils/doc-checkup.ts`（委托真身）

- `findDuplicateSentences(contents, minChars)` 改为委托 `repeatedSentences`：
  保留原签名、`DUPLICATE_SENTENCE_MIN_CHARS`（值改为 `AI_FLAVOR_REPEAT.minChars`，不另抄数字）
  与 `DUPLICATE_SENTENCE_LIMIT` 封顶，行为一字不变（count ≥2、按次数降序、`docIndexes` 升序）。
- `DuplicateSentence` 类型改为直接复用 `RepeatedSentence`（`export type DuplicateSentence = RepeatedSentence`），
  不再各留一份结构。

### 4) `apps/desktop/src/main/prompt-assembly.ts`（生成端 ⑩）

- `DE_AI_FLAVOR_STRUCTURE_INSTRUCTION` 末尾加第 ⑩ 条：

  > ⑩ 不许打转：同一句（十二个字以上）一章内最多出现两次——同一个意思需要复沓，就换词、换句式、
  > 换一个角度重说；把同一句话原样摊上三遍，是机器在原地打转，不是复沓。

  「最多两次」就是扫描端的判退线（3）减一，与 ③ 的对偶上限同一套口径。

### 5) `apps/desktop/src/main/doc-tools-host.ts`（退稿信加一条复读话术）

- `verdict.repeatOver` 非空时，信里补一句：
  「复读：<句> ×N——同一句话原样重复是机器打转，改成别的写法，或把重复的那几段合成一处。」
  （只列前 2 处，多的用「等 N 处」带过——退稿信是给模型看的改法，不是数据倾倒。）

### 6) 不改动的既有判定（回读确认）

- `AI_FLAVOR_TERMS`、认知转述 / 章末体 / 反差 / 情绪直陈四条正则、`AI_FLAVOR_STRUCTURE_MIN_COUNT`、
  `AI_FLAVOR_STRUCTURE_GATED_LABELS`、`sentenceStartRepeat`、`sentenceRhythmOf`、`textSimilarity`、
  `AI_FLAVOR_GATE` 的四个阈值：**一字不动**。
- 退稿闸既有的四条理由、防死循环（原样重交放行）、「换汤不换药」点破、连续退稿升级：
  **一字不动**——本刀只是**加**了第五条独立理由。
- 巡检面板「③ 重复句」的报告阈值仍为 ≥2（给人看的报告口径），不进闸。

## 四、验收（AC）

1. 先红：新判据跑出失败（`repeatedSentences` 未导出、`repeatOver` 未实现）。
2. 后绿：`corepack pnpm verify` 全绿（prettier → 6 枚 tsc → eslint → 边界 → 行数预算 → vitest → `VERIFY_EXIT=0`）。
3. 邻近守卫全绿：`doc-checkup.test.ts`（重复句组，委托后行为一字不变）、
   `doc-tools-host.test.ts` 退稿闸各组（干净稿仍放行——复读条只咬「同一句三遍以上」）。
4. 收口：commit + push（`feat/plan3-interaction-and-assembly`）→ 读真实 CI → README「## 门禁」节换绑
   → 台账 `docs/superpowers/plans/2026-10-09-full-scan-report.md` 补记新一节 → 清理仓外临时件。

## 五、未收口（如实留档）

- **「句式连用」（不同内容、同一句式铺满一章）仍无正则判据**：要读整章语义才判得准，
  按 §一百零五 的取舍只进生成端叮嘱、不上扫描判据。
- **朱雀等外部检测器的读数抖动**：同一文本三发三个结论、且不给逐句标红 ⇒ 不能当优化靶子，
  效果只能由本仓判据 ＋ 作者目检来闭环。
- 平台审核（番茄/起点等）的过审率**本仓无法度量**；「更像真人」的效果只能由作者目检。
