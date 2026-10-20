/**
 * 判据阈值的**真人语料校准基础设施**（P0-①，2026-10-20）。
 *
 * 【这一刀只落基础设施，四枚阈值一个不动】cliche 2 / essay 1 / adverb 5 / cognitive 3 仍是
 * `AI_FLAVOR_MIN_COUNT` 里的经验值。全仓**没有真人语料**——无 corpus 目录、只有测试夹具的构造文本，
 * 而夹具是**拿判据造出来的**文本，用它校准等于循环论证。所以这里只做三件事：
 * 数「一篇里每个条目命中几次」、算「样本分位」、算「现行阈值的误报率」。
 * 真人语料到齐那天，把它丢进 `packages/contracts/corpus/`，一条命令就出表，本文件一个字不用改。
 *
 * 【词表与正则只此一份】条目、六个句式正则与标签、现行阈值、对话引号归一**全部 import 自
 * `ai-flavor.js`**——校准侧要是另抄一份词表或正则，两边迟早走岔（铁律 6）。
 * 计数口径也与 `aiFlavorGate` 完全同套：词走整篇 indexOf 循环、句式标签走同一份正则
 * （对话标签先经 `normalizeDialogueQuotes` 按行归一）。副词也照数——校准要看它的分布。
 *
 * 【唯一不变量】对任意单篇 `t`，`flavorTermSamples([t])` 里 category ≠ "adverb" 的 count 总和
 * **恰好等于** `aiFlavorGate(t).hits`（gate 的 hits 正是「非副词词命中 + 句式标签命中」）。
 * 这条钉在 `flavor-calibration.test.ts` 里逐段断言——它是防止这份计数与真身走岔的唯一机器判据。
 *
 * 【口径三句话】
 * - 分位：最近秩法（nearest-rank）——升序样本里取 `⌈q·n⌉` 位，至少第 1 位；
 * - 样本：语料里该类别「出现过（count ≥ 1）」的 **(篇 × 条目) 对数**，不是命中总次数；
 * - 误报率：现行阈值会起报的样本占比 = count ≥ current 的样本数 ÷ 样本总数。
 */

import {
  AI_FLAVOR_ANTITHESIS_LABEL,
  AI_FLAVOR_ANTITHESIS_PATTERN,
  AI_FLAVOR_CATEGORY_LABELS,
  AI_FLAVOR_COGNITIVE_LABEL,
  AI_FLAVOR_COGNITIVE_PATTERN,
  AI_FLAVOR_CONTRAST_LABEL,
  AI_FLAVOR_CONTRAST_PATTERN,
  AI_FLAVOR_DIALOGUE_TAG_LABEL,
  AI_FLAVOR_DIALOGUE_TAG_PATTERN,
  AI_FLAVOR_EMOTION_LABEL,
  AI_FLAVOR_EMOTION_PATTERN,
  AI_FLAVOR_MIN_COUNT,
  AI_FLAVOR_SIMILE_LABEL,
  AI_FLAVOR_SIMILE_PATTERN,
  AI_FLAVOR_TAILCLAUSE_LABEL,
  AI_FLAVOR_TAILCLAUSE_PATTERN,
  AI_FLAVOR_TERMS,
  normalizeDialogueQuotes,
  type AiFlavorCategory
} from "./ai-flavor.js";

/** 一篇里某一个条目（词或句式标签）的命中数；只收 count ≥ 1 的样本。 */
export interface FlavorTermSample {
  docIndex: number;
  /** 词表项 term，或句式标签（如 AI_FLAVOR_COGNITIVE_LABEL）。 */
  label: string;
  category: AiFlavorCategory;
  count: number;
}

/**
 * 句式标签 → 类别（照 `ai-flavor.js` 的既有映射，不另立一份）：
 * cognitive 标签归 `cognitive`；antithesis / tail / contrast / emotion / simile 五个标签归 `essay`。
 * 对话标签单独处理——它的输入要先过 `normalizeDialogueQuotes`（明喻直接跑正则，不需归一）。
 */
const PATTERN_SAMPLES: readonly {
  label: string;
  category: AiFlavorCategory;
  pattern: RegExp;
}[] = [
  { label: AI_FLAVOR_COGNITIVE_LABEL, category: "cognitive", pattern: AI_FLAVOR_COGNITIVE_PATTERN },
  { label: AI_FLAVOR_ANTITHESIS_LABEL, category: "essay", pattern: AI_FLAVOR_ANTITHESIS_PATTERN },
  { label: AI_FLAVOR_TAILCLAUSE_LABEL, category: "essay", pattern: AI_FLAVOR_TAILCLAUSE_PATTERN },
  { label: AI_FLAVOR_CONTRAST_LABEL, category: "essay", pattern: AI_FLAVOR_CONTRAST_PATTERN },
  { label: AI_FLAVOR_EMOTION_LABEL, category: "essay", pattern: AI_FLAVOR_EMOTION_PATTERN },
  { label: AI_FLAVOR_SIMILE_LABEL, category: "essay", pattern: AI_FLAVOR_SIMILE_PATTERN }
];

/** 词表项的整篇 indexOf 循环——与 `aiFlavorGate` 逐字同套（含副词，校准要看它）。 */
function countTermIn(text: string, term: string): number {
  let hits = 0;
  let from = 0;
  for (;;) {
    const at = text.indexOf(term, from);
    if (at === -1) break;
    hits += 1;
    from = at + term.length;
  }
  return hits;
}

/** 逐篇数每个条目的命中数（count ≥ 1 才入表）。 */
export function flavorTermSamples(docs: readonly string[]): FlavorTermSample[] {
  const samples: FlavorTermSample[] = [];
  for (const [docIndex, text] of docs.entries()) {
    for (const { term, category } of AI_FLAVOR_TERMS) {
      const count = countTermIn(text, term);
      if (count >= 1) samples.push({ docIndex, label: term, category, count });
    }
    for (const { label, category, pattern } of PATTERN_SAMPLES) {
      const count = text.match(pattern)?.length ?? 0;
      if (count >= 1) samples.push({ docIndex, label, category, count });
    }
    // 对话标签：先按行把半角直引号归一成弯引号，再跑同一份正则（与 gate 同一份真身）。
    const dialogueCount =
      normalizeDialogueQuotes(text).match(AI_FLAVOR_DIALOGUE_TAG_PATTERN)?.length ?? 0;
    if (dialogueCount >= 1) {
      samples.push({
        docIndex,
        label: AI_FLAVOR_DIALOGUE_TAG_LABEL,
        category: "essay",
        count: dialogueCount
      });
    }
  }
  return samples;
}

export interface CategoryCalibration {
  category: AiFlavorCategory;
  /** 现行阈值（从 AI_FLAVOR_MIN_COUNT 现取，不另抄数字）。 */
  current: number;
  /** 样本数 = 语料里该类别「出现过（count ≥ 1）」的 (篇 × 条目) 对数。 */
  samples: number;
  /** 分位（最近秩法：对升序样本取 ⌈q·n⌉ 位，至少第 1 位）。样本为空时为 null。 */
  quantiles: { p50: number | null; p90: number | null; p95: number | null; p99: number | null };
  /** 误报率：现行阈值会起报的样本占比 = count ≥ current 的样本数 / 样本总数（样本为 0 时 null）。 */
  overShare: number | null;
}

/** 校准出声的四个类别（`AI_FLAVOR_MIN_COUNT` 的四个键，与 STRUCTURE_MIN_COUNT 那几条无关）。 */
const CALIBRATION_CATEGORIES: readonly AiFlavorCategory[] = [
  "cliche",
  "essay",
  "adverb",
  "cognitive"
];

/** 最近秩法取分位：升序样本第 `⌈q·n⌉` 位（至少第 1 位，至多第 n 位）。空样本返回 null。 */
function nearestRank(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(q * sorted.length)));
  return sorted[rank - 1]!;
}

/** 对四个 AI_FLAVOR_MIN_COUNT 类别（cliche/essay/adverb/cognitive）各出一条校准读数。 */
export function calibrateFlavor(docs: readonly string[]): CategoryCalibration[] {
  const samples = flavorTermSamples(docs);
  return CALIBRATION_CATEGORIES.map((category) => {
    const counts = samples
      .filter((sample) => sample.category === category)
      .map((sample) => sample.count)
      .sort((left, right) => left - right);
    const current = AI_FLAVOR_MIN_COUNT[category];
    const total = counts.length;
    return {
      category,
      current,
      samples: total,
      quantiles: {
        p50: nearestRank(counts, 0.5),
        p90: nearestRank(counts, 0.9),
        p95: nearestRank(counts, 0.95),
        p99: nearestRank(counts, 0.99)
      },
      overShare: total === 0 ? null : counts.filter((count) => count >= current).length / total
    };
  });
}

/** 无真人语料时的缺口语（中文，单真身；测试与台账都引它）。 */
export const FLAVOR_CORPUS_GAP =
  "还没有真人语料：校准要有「人写的」对照文本才算数，测试夹具的构造文本是拿判据造出来的，用它校准等于循环论证。";

/** 把校准结果排成人可读的一张表（供 corpus 用例打印）。 */
export function formatCalibrationTable(rows: readonly CategoryCalibration[]): string {
  const cell = (value: number | null): string => (value === null ? "—" : String(value));
  const lines = [["类别", "现行阈值", "样本", "p50", "p90", "p95", "p99", "误报率"].join(" | ")];
  for (const row of rows) {
    lines.push(
      [
        `${row.category}（${AI_FLAVOR_CATEGORY_LABELS[row.category]}）`,
        String(row.current),
        String(row.samples),
        cell(row.quantiles.p50),
        cell(row.quantiles.p90),
        cell(row.quantiles.p95),
        cell(row.quantiles.p99),
        cell(row.overShare)
      ].join(" | ")
    );
  }
  return lines.join("\n");
}
