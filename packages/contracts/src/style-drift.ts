/**
 * 「这一稿还像不像你自己写的」——腔调偏离测量（2026-11-10）。
 *
 * 【缺口在哪】`ai-flavor.ts` 的闸判的是**通用**病：套话、议论腔、守则式的句长整齐。
 * 它拦得住「一眼机器」，拦不住「写得挺顺，但不是这本书」。而 `style-profile.ts` 已经把
 * 这本书自己的四维常态量出来了（句长、标点脾气、对白比、段末收法），却只被拼进提示词当
 * 一句叮嘱——写完之后没有人拿它回头比一次。
 *
 * 【为什么只报不拦】腔调距离和「套话」不是同一类证据：打斗章本来就比抒情章句子短、对白少，
 * 硬拦会把合法的变化判成错。所以这里给的是**读数 + 具体改法**，由调用方决定怎么用
 * （`doc-tools-host` 的用法：退稿信里追加，或过闸时附在回执后；两者都不改变放行/拦下的判据）。
 * 要拦的仍然只有通用病——那条线不动。
 *
 * 【口径不重算】句长复用 `sentenceRhythmOf`、对白比复用 `dialogueBalance`、标点沿用
 * `STYLE_PROFILE_PUNCTUATION` 的三枚与「每千字」算法（都来自 `style-profile.ts` 同一次测量）。
 * 本文件只做「两份读数之间的差」，不新造第二个定义。
 */
import { sentenceRhythmOf } from "./ai-flavor.js";
import { dialogueBalance } from "./dialogue.js";
import { STYLE_PROFILE_PUNCTUATION, type StyleProfile } from "./style-profile.js";

/**
 * 这一稿至少要有这么多非空白字才量腔调。
 * 低于它只说明「这一稿短」，不说明「不像你写的」——短样本上算出的偏离几乎全是噪声。
 */
export const STYLE_DRIFT_MIN_CHARS = 300;

export type StyleDriftKey = "rhythm-mean" | "rhythm-spread" | "dialogue" | "punctuation";

export interface StyleDriftItem {
  key: StyleDriftKey;
  /** 人话名，回执直接用（如「句长均值」）。 */
  label: string;
  /** 本书常态，已格式化成带单位的字符串。 */
  base: string;
  /** 这一稿的读数，同一套单位。 */
  draft: string;
  /**
   * 偏离量：句长两维是**相对比例**（0.32 = 长出去 32%），对白是**绝对百分点**，
   * 标点是相对倍数差。方向和量级都写在同一格，回执据此措辞。
   */
  delta: number;
  severity: "warn" | "off";
  /** 具体改法。不是「注意腔调」这种空话——句长要给出拆哪儿，标点要给出停哪儿。 */
  advice: string;
}

export interface StyleDrift {
  /** 量过没有。样本不足或本书还没有常态档案时为 false，`note` 说明原因。 */
  checked: boolean;
  items: StyleDriftItem[];
  /** 最该改的那一条（severity 最高、delta 最大），没有就是 null。 */
  worst: StyleDriftItem | null;
  /** 一句话结论；`checked` 为 false 时是「为什么没量」。 */
  note: string;
}

/**
 * 句长两维的相对偏离档（22% 起报、40% 判「不像你」）。
 * 2026-11-11 按《呐喊》四篇对照放宽一档：原 18%/32% 下，社戏的题材差（24.7→31.7 字，+28%）
 * 被判成 off——真人章节在自己的书里不该判 off，题材差该报（warn）不该拦。
 */
const RHYTHM_LIMITS = { warn: 0.22, off: 0.4 };
/** 句长波动放宽一档：波动本来就该随题材起伏，它比均值更容易飘。 */
const SPREAD_LIMITS = { warn: 0.35, off: 0.6 };
/**
 * 对白占比按百分点算（12 个点起报、25 个点判「不像你」）——比例小时相对值会夸张。
 * 2026-11-11 按《呐喊》四篇对照放宽一档：对白比最吃题材（社戏 30%→8%，−22pp，原 15pp 线判 off；
 * 故乡 −12pp、阿Q +11pp 都顶在原 8pp warn 线上）。题材差该报不该拦：22pp 级的差降到 warn，
 * 12pp 级的正常差不再报。
 */
const DIALOGUE_LIMITS_PP = { warn: 0.12, off: 0.25 };
/** 标点按倍数差；基准低于这个密度就不判（每千字 0.5 处以下，抖动没有意义）。 */
const PUNCTUATION_BASE_FLOOR = 0.5;
const PUNCTUATION_LIMITS = { warn: 1, off: 2 };

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 只有越过 warn 线才会被调用，所以这里只剩「要不要判成 off」一档。 */
function severityOf(delta: number, limits: { off: number }): "warn" | "off" {
  return Math.abs(delta) >= limits.off ? "off" : "warn";
}

function rhythmMeanItem(profile: StyleProfile, text: string): StyleDriftItem | null {
  const base = profile.rhythm;
  if (base === null) return null;
  const now = sentenceRhythmOf(text);
  if (now === null) return null;
  const delta = (now.mean - base.mean) / base.mean;
  if (Math.abs(delta) < RHYTHM_LIMITS.warn) return null;
  const longer = delta > 0;
  return {
    key: "rhythm-mean",
    label: "句长均值",
    base: `${base.mean} 字`,
    draft: `${now.mean} 字`,
    delta,
    severity: severityOf(delta, RHYTHM_LIMITS),
    advice: longer
      ? `句子被你拉长了（多了 ${Math.round(Math.abs(delta) * 100)}%）。长句一多，读起来像有人在念稿——把叙述里能独立成句的转折拆出来，让短句去承担停顿。`
      : `句子比你自己平时短了不少（少了 ${Math.round(Math.abs(delta) * 100)}%）。全篇短句会碎成提纲——挑一处该铺开的地方（环境、动作过程）写成一句长的，把节奏压下来。`
  };
}

function rhythmSpreadItem(profile: StyleProfile, text: string): StyleDriftItem | null {
  const base = profile.rhythm;
  if (base === null || base.spread <= 0) return null;
  const now = sentenceRhythmOf(text);
  if (now === null) return null;
  const delta = (now.spread - base.spread) / base.spread;
  if (Math.abs(delta) < SPREAD_LIMITS.warn) return null;
  const flatter = delta < 0;
  return {
    key: "rhythm-spread",
    label: "长短句落差",
    base: `波动 ${base.spread}`,
    draft: `波动 ${now.spread}`,
    delta,
    severity: severityOf(delta, SPREAD_LIMITS),
    advice: flatter
      ? "句子长短太齐了——这是机器最典型的节奏：每句都差不多长。挑三处该停的地方压成四五个字的短句，再挑一处铺开写长，落差出来，人味就出来了。"
      : "长短句落差比你平时大得多，读起来一顿一顿的。把几个特别短的句子并进相邻的长句里，过渡顺下来。"
  };
}

function dialogueItem(profile: StyleProfile, text: string): StyleDriftItem | null {
  const balance = dialogueBalance(text);
  if (balance.total < STYLE_DRIFT_MIN_CHARS) return null;
  const delta = balance.ratio - profile.dialogueRatio;
  if (Math.abs(delta) < DIALOGUE_LIMITS_PP.warn) return null;
  const more = delta > 0;
  return {
    key: "dialogue",
    label: "对白占比",
    base: `${round1(profile.dialogueRatio * 100)}%`,
    draft: `${round1(balance.ratio * 100)}%`,
    delta,
    severity: Math.abs(delta) >= DIALOGUE_LIMITS_PP.off ? "off" : "warn",
    advice: more
      ? "对白比自己平时多了一大截，叙述被挤没了。补回叙述：谁在说、说完手上在做什么、屋里有什么在响——这些才是小说的肉。"
      : "对白比自己平时少了一大截，整段变成了叙述汇报。该让人物开口的地方就开口：一句话比三句转述有分量。"
  };
}

function punctuationItems(profile: StyleProfile, text: string): StyleDriftItem[] {
  const balance = dialogueBalance(text);
  if (balance.total < STYLE_DRIFT_MIN_CHARS) return [];
  const out: StyleDriftItem[] = [];
  for (const { key, mark, label } of STYLE_PROFILE_PUNCTUATION) {
    const base = profile.punctuation[key];
    if (base < PUNCTUATION_BASE_FLOOR) continue;
    const count = text.split(mark).length - 1;
    const now = round1((count / balance.total) * 1000);
    // 相对差以「基准」为分母（基准已过地板线，不会炸成 Infinity）；这一稿一处都没有时
    // 差就是 −1，读作「比你平时少了一倍」，不会变成无穷大。
    const delta = (now - base) / Math.max(base, PUNCTUATION_BASE_FLOOR);
    if (Math.abs(delta) < PUNCTUATION_LIMITS.warn) continue;
    const more = now > base;
    out.push({
      key: "punctuation",
      label: `${label}密度`,
      base: `每千字 ${base} 处`,
      draft: `每千字 ${now} 处`,
      delta,
      severity: Math.abs(delta) >= PUNCTUATION_LIMITS.off ? "off" : "warn",
      advice: more
        ? `「${mark}」用得比你自己平时密得多。它是重音，用多了就不重了——只在真正要顿一下的地方留一处，其余换成句号断开。`
        : `「${mark}」几乎不用了，可你平时是靠它断气的。该停的那几处补回来，别让一句话一路冲到底。`
    });
  }
  return out;
}

/**
 * 拿这本书的常态档案量这一稿。档案为 null（样本不足）时 `checked` 为 false。
 * 稿子不足 `STYLE_DRIFT_MIN_CHARS` 也返回未测量——两份读数都不可靠时，差更不可靠。
 */
export function styleDriftOf(profile: StyleProfile | null, text: string): StyleDrift {
  if (profile === null) {
    return {
      checked: false,
      items: [],
      worst: null,
      note: "这本书还没有可比的常态（完稿不足 500 字）。"
    };
  }
  const total = dialogueBalance(text).total;
  if (total < STYLE_DRIFT_MIN_CHARS) {
    return {
      checked: false,
      items: [],
      worst: null,
      note: `这一稿只有 ${total} 字，短样本上的腔调距离量不准，跳过。`
    };
  }
  const items = [
    rhythmMeanItem(profile, text),
    rhythmSpreadItem(profile, text),
    dialogueItem(profile, text),
    ...punctuationItems(profile, text)
  ].filter((item): item is StyleDriftItem => item !== null);

  if (items.length === 0) {
    return { checked: true, items, worst: null, note: "腔调与这本书一致。" };
  }
  const sorted = [...items].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "off" ? -1 : 1;
    return Math.abs(b.delta) - Math.abs(a.delta);
  });
  const worst = sorted[0] ?? null;
  const off = sorted.filter((item) => item.severity === "off").length;
  const note =
    off === 0
      ? `腔调有 ${items.length} 处小偏（最明显：${worst?.label ?? ""}）。`
      : `腔调偏离 ${off} 处偏大（最明显：${worst?.label ?? ""}）——这一稿不太像这本书自己的写法。`;
  return { checked: true, items: sorted, worst, note };
}
