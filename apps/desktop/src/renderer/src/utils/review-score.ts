/**
 * 多视角审稿打分（2026-10-05，批次 4-②）的纯判定层。
 *
 * **它与左栏那三项是什么关系（这条边界不许模糊）**：
 * 左栏「一致性 / 剧情 / 逻辑」三项**要调 AI**——烧 token、要等、还得联网，所以它们至今
 * 只预填一句提问（`side-nav.ts` 的 `AI_CHECK_PROMPTS`），不打分。
 * 这份打分**不调模型**：所有分数都从正文本身数出来，查表即得，零成本、零延迟、离线可用。
 * 哪天有人把它改成"让 AI 打个分"，那是功能倒退（同 `ai-slop.ts` 的同一条纪律）。
 *
 * **为什么只给这几项，不给「剧情是否成立」那种分**：
 * 本地能诚实回答的是**可数出来的**问题——句长、段落节奏、对白占比、套话密度。
 * 「剧情合不合理」是判断不是计数，硬要给分就是编一个数字骗作者。
 * 所以 `ReviewMetric` 里没有剧情项，取而代之的是 `MISSING_METRICS`：
 * 明写「这几项得靠 AI 或靠你自己读，本地给不出分」。**宁可承认算不出，不假装算得出。**
 *
 * **分数的语义（重要）**：分数**不是质量分，是「这一项的写法有多常规」的读数**。
 * 句长 30 字是常规还是拖沓，取决于这本书的调性，本地不知道——所以每一项都带 `hint`
 * 说明「这个分在数什么」，并且 60 分是**中性基准**而不是及格线。
 * 界面上必须照实说，绝不许把 60 说成「及格」。
 */

import { findAiSlop, slopVerdict } from "./ai-slop";

/** 打分的维度。**只收本地能量化的**，判断类的一律不进这张表。 */
export const REVIEW_METRICS = ["sentence", "paragraph", "dialogue", "slop"] as const;
export type ReviewMetric = (typeof REVIEW_METRICS)[number];

/** 维度的名字（穷尽表：`Record<ReviewMetric, string>`，加维度必须在这里补一行）。 */
export const METRIC_LABELS: Record<ReviewMetric, string> = {
  sentence: "句长",
  paragraph: "段落节奏",
  dialogue: "对白占比",
  slop: "套话密度"
};

/**
 * 算不出分的那几项（明写，不藏）。
 * 用户点开面板看到「这几项本地给不出分」比看到一个编出来的分数诚实得多。
 */
export const MISSING_METRICS = [
  { label: "剧情是否成立", hint: "要读全书脉络才算得出，本地只数这一篇" },
  { label: "人物是否一致", hint: "要对照人物设定与前文算，本地不查设定" }
] as const;

export const METRIC_MISSING_NOTE = "下面这几项本地给不出分——要靠 AI 通读，或你自己读一遍。";

/** 中性基准分。**不是及格线**：60 是「常规写法」的读数，文案里不许说成「及格」。 */
export const NEUTRAL_SCORE = 60;

export interface ReviewScore {
  metric: ReviewMetric;
  label: string;
  /** 0-100 的读数，越高越常规。**不是质量分**。 */
  score: number;
  /** 一句话说清这个分在数什么、为什么给这个数。 */
  hint: string;
  /** 供人核对的原始读数（"最长 78 字" 这类），没有就空串。 */
  reading: string;
}

export interface ReviewReport {
  scores: ReviewScore[];
  /** 综合读数：各维度平均（先红后绿测试会钉住它不是常数）。 */
  overall: number;
  /** 一句话结论——**只描述读数，不下judgment**。 */
  summary: string;
}

/* ── 分句：中文标点 + 省略号 + 换行都算断点 ── */

interface SentencePiece {
  text: string;
  chars: number;
}

/** 标点集合：算字数时一律不算（句号是断点，不该算进句长；引号内的句号同理）。 */
const PUNCTUATION = "。！？…!?，,、；;：:「」『』“”\"'（）()【】[]";

/** 有效字数：去空白、去标点。「他 走 了。」是 3 字不是 4。 */
export function meaningfulChars(text: string): number {
  let count = 0;
  for (const char of text) {
    if (/\s/.test(char)) continue;
    if (PUNCTUATION.includes(char)) continue;
    count += 1;
  }
  return count;
}

/**
 * 把正文切成句。中文的句末标点是 `。！？…`（含全角与半角）。
 *
 * **为什么不用 `.split(/[。！？]/)`**：那样会把 `！？` 连写切错、把 `……` 切成
 * 「一句 + 一个空的省略号句」。这里逐字扫，并记住**连写的同类标点只算一个断点**——
 * `……` 是六点省略号的一处收束，切成两句就是凭空多造一句，句长会被算低。
 */
/** 标点归一化：把全角/半角同类归到同一个符号，才能认出「连写」。 */
function breakKind(char: string): string {
  if (char === "…" || char === ".") return "…";
  if (char === "!" || char === "！") return "!";
  if (char === "?" || char === "？") return "?";
  return "。";
}

export function splitSentences(content: string): SentencePiece[] {
  const pieces: SentencePiece[] = [];
  let buffer = "";
  const chars = [...content];
  const flush = () => {
    const text = buffer.trim();
    if (text !== "") pieces.push({ text, chars: meaningfulChars(text) });
    buffer = "";
  };
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i] as string;
    buffer += char;
    if (!"。！？…!?".includes(char)) continue;
    // 同类标点**紧邻连写**时不在这儿断——`……` 是一处收束，不是两处。
    // 只看紧邻的下一个字符；是同类就一并吃进本句然后立刻断句（不再往后看）。
    let j = i + 1;
    while (
      j < chars.length &&
      "。！？…!?".includes(chars[j] as string) &&
      breakKind(chars[j] as string) === breakKind(char)
    ) {
      buffer += chars[j];
      j += 1;
    }
    i = j - 1; // 跳过已吃掉的连续标点
    flush();
  }
  flush(); // 结尾没有标点也留作一句（作者还没写完）
  return pieces;
}

/* ── 维度一：句长 ── */

interface SentenceMetricInput {
  average: number;
  longest: number;
  overLong: number;
  total: number;
}

/** 均长落在 12-28 字是常规网文节奏，超出越远越偏离。 */
export function scoreSentence(input: SentenceMetricInput): number {
  const { average, longest, overLong, total } = input;
  if (total === 0) return NEUTRAL_SCORE;
  // 均长偏离 [12, 28] 越远扣得越多（**是减不是加**——写反了会让「一整屏套话」反而拿高分）。
  // 过短比过长轻：短句是网文的正常节奏，长句才是读者掉线的地方。
  const awayFromComfort =
    average < 12 ? (12 - average) * 0.8 : average > 28 ? (average - 28) * 1.4 : 0;
  let score = NEUTRAL_SCORE - awayFromComfort;
  // 出现过目不看的长句：单句超过 60 字另扣（读者会在这里掉线）。
  if (longest > 60) score -= Math.min(18, Math.floor((longest - 60) / 6));
  // 长句占比过高也扣：整篇都在长句里，节奏是塌的。
  if (overLong / total > 0.25)
    score -= Math.min(12, Math.floor(((overLong / total - 0.25) * 100) / 4));
  return clampScore(score);
}

/* ── 维度二：段落节奏 ── */

interface ParagraphMetricInput {
  average: number;
  longest: number;
  count: number;
}

/** 段落均长 2-6 段、且没有一整屏不分段，是常规。 */
export function scoreParagraph(input: ParagraphMetricInput): number {
  const { average, longest, count } = input;
  if (count === 0) return NEUTRAL_SCORE;
  const awayFromComfort = average < 2 ? (2 - average) * 6 : average > 6 ? (average - 6) * 5 : 0;
  let score = NEUTRAL_SCORE - awayFromComfort;
  // 单段超过 12 行且全文段数不多：几乎肯定是一整屏没切开。
  if (longest > 12 && count <= 3) score -= 15;
  return clampScore(score);
}

/**
 * 段落那一栏的话术。
 *
 * **为什么单独抽出来**：它和 `scoreParagraph` 评的是同一组数（均长 / 最长 / 段数），
 * 两边各判一次就会出现「54 分 + 明显偏出」配一句「还算清爽」这种自相矛盾——
 * 2026-10-05 真机就是这么撞出来的。判据不许写两遍，所以话术跟着分数那一支的判据走。
 */
export function paragraphHint(input: ParagraphMetricInput): string {
  const { average, longest, count } = input;
  if (longest > 12 && count <= 3) return "有一整屏没切开，读起来会累";
  if (average < 2) return "段落切得很碎，每段就一行——读者接不上劲";
  if (average > 6) return "段落偏长，一口气读下去会喘";
  return "段落切得还算清爽";
}

/* ── 维度三：对白占比 ── */

interface DialogueMetricInput {
  ratio: number;
  count: number;
}

/** 带引号的成对片段按对白计。占比 20%-60% 是常规区间。 */
export function scoreDialogue(input: DialogueMetricInput): number {
  const { ratio, count } = input;
  if (count === 0) return NEUTRAL_SCORE;
  // 0 也不扣：很多章节（独白、回忆、说明）本就没有对白，这不算毛病。
  if (ratio === 0) return NEUTRAL_SCORE;
  // 全是叙述扣得比全是对白狠：读者要自己造画面，而对白至少有人在说话。
  const awayFromComfort = ratio < 0.2 ? (0.2 - ratio) * 220 : ratio > 0.6 ? (ratio - 0.6) * 70 : 0;
  return clampScore(NEUTRAL_SCORE - awayFromComfort);
}

/* ── 维度四：套话密度 ── */

/** 复用去 AI 味那份查表结果，不另写一份词表（铁律 6）。 */
export function scoreSlop(hits: number, content: string): number {
  const verdict = slopVerdict(
    // 这里只需要条数，`why` 与 `excerpt` 用不到，给空串即可——不重复扫一遍。
    Array.from({ length: hits }, () => ({
      line: 0,
      matched: "",
      strength: "strong" as const,
      why: "",
      excerpt: ""
    })),
    content
  );
  // 强信号 0 条 = 满分；每条强信号扣 8 分（上限扣到 20 分，绝不出现负分）。
  return clampScore(100 - Math.min(80, verdict.strong * 8));
}

/* ── 汇总 ── */

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return NEUTRAL_SCORE;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * `clampScore` 只给本模块内部用；这里按本仓惯例导出一份给测试直接钉住——
 * 夹子的边界（越界夹住、NaN 回中性）没有别的入口能验到。
 */
export function clampScoreForTest(value: number): number {
  return clampScore(value);
}

/** 统计正文里的对白片段（成对的「」/""/『』）。 */
export function countDialogueSegments(content: string): { count: number; chars: number } {
  const pairs: readonly [string, string][] = [
    ["「", "」"],
    ["『", "』"],
    ['"', '"']
  ];
  let total = 0;
  let count = 0;
  for (const [open, close] of pairs) {
    let at = content.indexOf(open);
    while (at !== -1) {
      const end = content.indexOf(close, at + open.length);
      if (end === -1) break;
      const inner = content.slice(at + open.length, end);
      const chars = meaningfulChars(inner);
      if (chars > 0) {
        count += 1;
        total += chars;
      }
      at = content.indexOf(open, end + close.length);
    }
  }
  return { count, chars: total };
}

/**
 * 一次算出四个维度 + 综合读数。纯函数：同样输入永远同样输出。
 * 扫的是**活动文稿的当前草稿**（含未保存手改），与去 AI 味同一条口径——
 * 否则报出来的东西用户还没写过。
 */
export function reviewReport(content: string): ReviewReport {
  const trimmed = content.trim();
  if (trimmed === "") {
    return { scores: [], overall: NEUTRAL_SCORE, summary: "这一篇还没有正文，没什么可数的。" };
  }

  const scores: ReviewScore[] = [];

  // 句长
  const sentences = splitSentences(trimmed);
  const totalChars = meaningfulChars(trimmed);
  const averageSentence =
    sentences.length === 0
      ? 0
      : Math.round(sentences.reduce((sum, s) => sum + s.chars, 0) / sentences.length);
  const longestSentence = sentences.reduce((max, s) => Math.max(max, s.chars), 0);
  const overLong = sentences.filter((s) => s.chars > 60).length;
  scores.push({
    metric: "sentence",
    label: METRIC_LABELS.sentence,
    score: scoreSentence({
      average: averageSentence,
      longest: longestSentence,
      overLong,
      total: sentences.length
    }),
    hint:
      averageSentence > 28
        ? "句子偏长，读者在长句里容易掉线"
        : averageSentence < 12
          ? "句子偏短，读起来像流水账"
          : "句长在常规区间",
    reading: `均 ${averageSentence} 字 / 最长 ${longestSentence} 字 · 共 ${sentences.length} 句`
  });

  // 段落节奏
  const paragraphs = trimmed.split(/\n\s*\n/).filter((p) => p.trim() !== "");
  const paragraphLines = paragraphs.map((p) => p.split("\n").filter((l) => l.trim() !== "").length);
  const averageParagraph =
    paragraphs.length === 0
      ? 0
      : Math.round(
          paragraphs.reduce(
            (sum, p) => sum + p.split("\n").filter((l) => l.trim() !== "").length,
            0
          ) / paragraphs.length
        );
  const longestParagraph = paragraphLines.reduce((max, n) => Math.max(max, n), 0);
  scores.push({
    metric: "paragraph",
    label: METRIC_LABELS.paragraph,
    score: scoreParagraph({
      average: averageParagraph,
      longest: longestParagraph,
      count: paragraphs.length
    }),
    hint: paragraphHint({
      average: averageParagraph,
      longest: longestParagraph,
      count: paragraphs.length
    }),
    reading: `均 ${averageParagraph} 行 / 最长 ${longestParagraph} 行 · 共 ${paragraphs.length} 段`
  });

  // 对白占比
  const dialogue = countDialogueSegments(trimmed);
  const ratio = totalChars === 0 ? 0 : Math.round((dialogue.chars / totalChars) * 100) / 100;
  scores.push({
    metric: "dialogue",
    label: METRIC_LABELS.dialogue,
    score: scoreDialogue({ ratio, count: dialogue.count }),
    hint:
      ratio === 0
        ? "这一篇没有对白——独白或说明章不算毛病"
        : ratio < 0.2
          ? "对白偏少，叙述淹没了场景"
          : ratio > 0.6
            ? "对白偏多，画面容易停在嘴上"
            : "对白与叙述的比例正常",
    reading:
      dialogue.count === 0
        ? "没找到成对引号"
        : `${Math.round(ratio * 100)}% · ${dialogue.count} 段对白`
  });

  // 套话密度（复用去 AI 味那份查表）
  const slopHits = findAiSlop(trimmed);
  const strongCount = slopHits.filter((h) => h.strength === "strong").length;
  scores.push({
    metric: "slop",
    label: METRIC_LABELS.slop,
    score: scoreSlop(slopHits.length, trimmed),
    hint: strongCount === 0 ? "没扫出明确的套话" : `扫出 ${strongCount} 处套话`,
    reading: slopHits.length === 0 ? "零命中" : `共 ${slopHits.length} 处（强 ${strongCount}）`
  });

  const overall = clampScore(scores.reduce((sum, s) => sum + s.score, 0) / scores.length);
  return { scores, overall, summary: overallSummary(overall, scores) };
}

/**
 * 综合那句话：**只描述读数，不下判断**。
 * 「及格 / 不及格」是本仓明确禁止的说法（分数的语义是「有多常规」，不是质量）。
 */
export function overallSummary(overall: number, scores: ReviewScore[]): string {
  if (scores.length === 0) return "这一篇还没有正文，没什么可数的。";
  const worst = scores.reduce(
    (min, s) => (s.score < min.score ? s : min),
    scores[0] as ReviewScore
  );
  const band =
    overall >= 80
      ? "四项都在常规区间"
      : overall >= 65
        ? "大体常规，有一项偏出"
        : "有两三项偏出常规";
  return `综合 ${overall}（60 是中性基准，不是及格线）。${band}——最偏的是「${worst.label}」：${worst.hint}。`;
}

/**
 * 分数条的填充宽度（百分比，0-100）。
 * 纯函数：数值越界不许画出界外的条（那会让界面说谎）。
 */
export function scoreBarWidth(score: number): string {
  const safe = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
  return `${safe}%`;
}

/** 分数落在哪一档（穷尽表；界面按档上色，不许在组件里另写一套区间）。 */
export type ScoreBand = "high" | "mid" | "low";
export const SCORE_BANDS: Record<ScoreBand, string> = {
  high: "常规",
  mid: "偏出",
  low: "明显偏出"
};

export function scoreBandOf(score: number): ScoreBand {
  if (!Number.isFinite(score)) return "mid";
  if (score >= 80) return "high";
  if (score >= 60) return "mid";
  return "low";
}
