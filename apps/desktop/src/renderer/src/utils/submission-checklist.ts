import type { CastFinding, TimelineIssue } from "@mochen/contracts";
import { findAiSlop } from "./ai-slop";
import { reviewReport, scoreBandOf } from "./review-score";
import type { ForeshadowRow, KeywordMiss } from "./foreshadow";
import { draftLineOfBodyLine } from "./editor-reveal";

/**
 * 「交稿体检」清单的组装层（2026-11-09 W-04）。
 *
 * 只做一件事：把**既有**几套检查的产出摆成一张「本章还有哪几处没收拾」的清单。
 * 纪律：
 * ① 不新造规则——条目全部来自 `findAiSlop` / `reviewReport` / `checkCast`（经 store）/
 *    伏笔台账 / 时间线核对；
 * ② 不伪造位置——检查产出里有行号才给 `line`，只有文稿路径就给 `doc`，两者都没有
 *    就老实标 `none`（「有结果但无法定位」）；
 * ③ 只收能归属到本章的条目——别的章、全书级的缺口不进本章清单，改在页脚说明去哪看。
 *
 * 说明：人物核对的行号按「剥掉 frontmatter 的正文」数，这里换算回编辑框行号；
 * 换算用的是**当前载入的草稿**，所以盘上未保存的改动不会进清单，页脚会写明。
 */

export type ChecklistSource = "slop" | "review" | "cast" | "foreshadow" | "timeline";
export type ChecklistLocate = "line" | "doc" | "none";
export type ChecklistTone = "strong" | "suspect" | "info";

export interface ChecklistItem {
  /** 章内稳定指纹：同一章重新体检时用来接住「待修/已修/忽略」。 */
  id: string;
  source: ChecklistSource;
  tone: ChecklistTone;
  title: string;
  detail: string;
  locate: ChecklistLocate;
  /** 目标文稿；`locate === "none"` 时是空串。 */
  relPath: string;
  /** 1 起的编辑框行号；`0` = 没有行级位置。 */
  line: number;
  /** 屏显位置说明（「第 12 行」/「只能跳到这一章」/「有结果但无法定位」）。 */
  locateLabel: string;
}

export type ChecklistStatus = "todo" | "fixed" | "ignored";

export const CHECKLIST_STATUSES: readonly ChecklistStatus[] = ["todo", "fixed", "ignored"];

export const STATUS_LABELS: Record<ChecklistStatus, string> = {
  todo: "待修",
  fixed: "已修",
  ignored: "忽略"
};

export const SOURCE_LABELS: Record<ChecklistSource, string> = {
  slop: "去 AI 味",
  cast: "人物核对",
  foreshadow: "伏笔台账",
  timeline: "时间线核对",
  review: "审稿打分"
};

/** 分组顺序：能定位到行的先摆，篇级读数最后。 */
export const SOURCE_ORDER: readonly ChecklistSource[] = [
  "slop",
  "cast",
  "foreshadow",
  "timeline",
  "review"
];

/** 状态按「书 + 章 + 条目指纹」分开记；换章回来还在，重开软件就清空。 */
export function statusKeyOf(ownerKey: string, itemId: string): string {
  return `${ownerKey}\u0000${itemId}`;
}

export interface ChecklistSources {
  chapterRelPath: string;
  draft: string;
  castFindings: readonly CastFinding[];
  foreshadowRows: readonly ForeshadowRow[];
  keywordMisses: readonly KeywordMiss[];
  timelineIssues: readonly TimelineIssue[];
}

function lineLabel(line: number): string {
  return `第 ${line} 行`;
}

/** 去 AI 味：每条命中自带 1 起行号，能选到整行。 */
export function slopItems(draft: string, relPath: string): ChecklistItem[] {
  if (relPath === "" || draft.trim() === "") return [];
  const seen = new Map<string, number>();
  return findAiSlop(draft).map((hit) => {
    const fingerprint = `${hit.line}\u0000${hit.matched}\u0000${hit.strength}`;
    const ordinal = seen.get(fingerprint) ?? 0;
    seen.set(fingerprint, ordinal + 1);
    return {
      id: `slop|${fingerprint}|${ordinal}`,
      source: "slop",
      tone: hit.strength,
      title: `${hit.strength === "strong" ? "套话" : "常见句式"}「${hit.matched}」`,
      detail: hit.excerpt === "" ? hit.why : `${hit.why} · ${hit.excerpt}`,
      locate: "line",
      relPath,
      line: hit.line,
      locateLabel: lineLabel(hit.line)
    };
  });
}

/** 审稿打分：篇级读数，有结论但没有行号——只收「明显偏出」那几维。 */
export function reviewItems(draft: string, relPath: string): ChecklistItem[] {
  if (relPath === "" || draft.trim() === "") return [];
  return reviewReport(draft)
    .scores.filter((score) => scoreBandOf(score.score) === "low")
    .map((score) => ({
      id: `review|${score.metric}|${score.score}`,
      source: "review",
      tone: "suspect",
      title: `${score.label}读数 ${score.score}（明显偏出）`,
      detail: [score.reading, score.hint].filter((part) => part !== "").join(" · "),
      locate: "none",
      relPath: "",
      line: 0,
      locateLabel: "有结果但无法定位（篇级读数，没有行号）"
    }));
}

/** 人物核对：只收点名到本章的那几条；有行号就换算成编辑框行号。 */
export function castItems(
  findings: readonly CastFinding[],
  chapterRelPath: string,
  draft: string
): ChecklistItem[] {
  if (chapterRelPath === "") return [];
  return findings
    .filter((finding) => finding.chapter === chapterRelPath)
    .map((finding) => {
      const line = finding.line > 0 ? draftLineOfBodyLine(draft, finding.line) : 0;
      const locatable = line > 0;
      return {
        id: `cast|${finding.code}|${finding.cardPath}|${finding.chapter}|${finding.line}|${finding.level}|${finding.message}`,
        source: "cast" as const,
        tone: finding.level === "defect" ? ("strong" as const) : ("suspect" as const),
        title: finding.message,
        detail:
          finding.quote === ""
            ? `人物卡：${finding.card}（${finding.code}）`
            : `人物卡：${finding.card}（${finding.code}） · 原文：${finding.quote}`,
        locate: locatable ? ("line" as const) : ("doc" as const),
        relPath: chapterRelPath,
        line,
        locateLabel: locatable ? lineLabel(line) : "只能跳到这一章，定位不到行"
      };
    });
}

/**
 * 伏笔台账：只收「埋在本章 / 登记在本章回收且仍待回收」的行，
 * 以及本章没找到作者声明关键词的那几处。落点只能到文稿，没有行号。
 */
export function foreshadowItems(
  rows: readonly ForeshadowRow[],
  misses: readonly KeywordMiss[],
  chapterRelPath: string
): ChecklistItem[] {
  if (chapterRelPath === "") return [];
  const items: ChecklistItem[] = [];
  for (const row of rows) {
    if (row.tone !== "pending" && row.tone !== "broken") continue;
    if (row.plantedIn !== chapterRelPath && row.paidIn !== chapterRelPath) continue;
    const paidHere = row.paidIn === chapterRelPath;
    const broken = row.tone === "broken";
    items.push({
      id: `foreshadow|row|${row.relPath}`,
      source: "foreshadow",
      tone: broken ? "strong" : "suspect",
      title: broken
        ? `「${row.title}」的状态字段没认出来（${row.rawStatus}）`
        : paidHere
          ? `「${row.title}」登记在本章回收，状态仍是待回收`
          : `「${row.title}」埋在本章，尚未回收`,
      detail: broken
        ? "改前它按「已埋」算；先把状态改成 planted / paid / dropped。"
        : `当前状态：${row.statusLabel}${paidHere ? "；本章登记了回收章" : ""}`,
      locate: "doc",
      relPath: row.relPath,
      line: 0,
      locateLabel: "跳到伏笔文稿"
    });
  }
  for (const miss of misses) {
    if (miss.chapter !== chapterRelPath) continue;
    items.push({
      id: `foreshadow|miss|${miss.relPath}|${miss.chapter}|${miss.keyword}`,
      source: "foreshadow",
      tone: "suspect",
      title: `「${miss.title}」的「${miss.keyword}」在本章没找到`,
      detail: "这个词是作者在伏笔里声明的；可能换了说法，也可能埋设章登记错了。",
      locate: "doc",
      relPath: chapterRelPath,
      line: 0,
      locateLabel: "本章正文（定位不到具体行）"
    });
  }
  return items;
}

/** 时间线核对：只有牵涉到本章的才进清单；它查的是时间线文稿，通常没有本章条目。 */
export function timelineItems(
  issues: readonly TimelineIssue[],
  chapterRelPath: string
): ChecklistItem[] {
  if (chapterRelPath === "") return [];
  return issues
    .filter((issue) => issue.relPaths.includes(chapterRelPath))
    .map((issue) => ({
      id: `timeline|${issue.kind}|${chapterRelPath}|${issue.text}`,
      source: "timeline" as const,
      tone: "strong" as const,
      title: issue.text,
      detail: issue.reading,
      locate: "doc" as const,
      relPath: chapterRelPath,
      line: 0,
      locateLabel: "只能跳到这一章，定位不到行"
    }));
}

export function buildSubmissionChecklist(sources: ChecklistSources): ChecklistItem[] {
  const { chapterRelPath } = sources;
  if (chapterRelPath === "") return [];
  return [
    ...slopItems(sources.draft, chapterRelPath),
    ...castItems(sources.castFindings, chapterRelPath, sources.draft),
    ...foreshadowItems(sources.foreshadowRows, sources.keywordMisses, chapterRelPath),
    ...timelineItems(sources.timelineIssues, chapterRelPath),
    ...reviewItems(sources.draft, chapterRelPath)
  ];
}

export interface ChecklistGroup {
  source: ChecklistSource;
  label: string;
  items: ChecklistItem[];
}

/** 按来源分组；空组不摆，顺序固定，避免每次重算时跳来跳去。 */
export function groupChecklist(items: readonly ChecklistItem[]): ChecklistGroup[] {
  return SOURCE_ORDER.map((source) => ({
    source,
    label: SOURCE_LABELS[source],
    items: items.filter((item) => item.source === source)
  })).filter((group) => group.items.length > 0);
}

export const NO_CHAPTER_TEXT = "当前打开的不是章节正文，体检清单只对章节生效。";
export const LOADING_TEXT = "正在汇总本章的既有检查…";
export const CLEAN_TEXT = "本章的既有检查里没有待收拾的条目。";
export const COVERAGE_TEXT =
  "条目全部来自右栏既有的五套检查（去 AI 味 / 审稿打分 / 时间线核对 / 人物设定核对 / 伏笔台账），只收能归属到本章的条目，没有新造规则。";

export const STATUS_HINT_TEXT =
  "标记只活在这次打开软件期间：按「书 + 章 + 条目」分开记，换章再回来还在，关掉软件就清空。没有写进 book.json，也没有落任何文件。";

export function timelineNoteText(otherCount: number): string {
  if (otherCount <= 0) {
    return "时间线核对比的是时间线文稿之间，不挂在某一章正文上；本章没有可归属的时间线条目。";
  }
  return `时间线核对比的是时间线文稿之间，不挂在某一章正文上；全书另有 ${otherCount} 处要核，去「审稿 → 时间线核对」看。`;
}

export function castNoteText(cardCount: number, gapCount: number): string {
  if (cardCount === 0) return "本书还没有人物卡，人物核对没有可核对的约束。";
  if (gapCount === 0) {
    return `人物核对扫了 ${cardCount} 张人物卡；本章清单只收点名到本章的条目。`;
  }
  return `人物核对另有 ${gapCount} 条全书级数据缺口（人物卡缺字段 / 退场章登记），不挂在某一章，去「人物设定核对」看。`;
}

export function foreshadowNoteText(total: number): string {
  if (total === 0) return "本书还没有伏笔文稿，伏笔这一项没有可核对的数据。";
  return "伏笔这一项只收埋在本章或登记在本章回收、且仍待回收的条目。";
}
