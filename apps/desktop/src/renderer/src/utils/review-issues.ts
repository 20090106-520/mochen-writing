/**
 * 交稿问题清单的状态模型（W-04 第一刀，2026-11-12）。
 *
 * 【这一层解决什么】五个审稿面板现在都是临时浮层：看完关掉就没了，不记状态、不能标记
 * 「已处理」、改完也不能复检。作者得自己拿纸记「还有三条没修」。这一层只管**跟踪到修完**：
 * 按章留存、每条有状态、复检时把「改掉了」自动落成已修。判据一律复用现有面板（现在五套
 * 全接，入口是 `buildSubmissionChecklist` 的现成结论），这里不写任何「什么算问题」的规则。
 *
 * 【为什么指纹不含行号】前面插一段、删一段，行号就整批漂移；用行号当身份，一次普通编辑
 * 就会把清单炸成「旧的 N 条已修 + 新的 N 条待修」。身份取「命中词 + 该处上下文片段」，
 * 行号只是每次体检刷新、供点击跳原文的显示字段。
 * 代价是作者只改了上下文、词还留着时会被记成「旧的已修 + 新的待修」；等真机看这个噪音
 * 有多恼人再决定要不要加一层邻近匹配，第一版不猜。
 *
 * 【为什么坏档一律判读不懂】这份数据走 useBookFileData，读不懂时通路会**停止写入**。
 * 若这里将错就错吃下半截 JSON，用户随手点一次「忽略」就会用空清单盖掉盘上那份，
 * 比读不出来严重得多。
 *
 * 【五套来源接进来，为什么 version 仍是 1】新增的是**可选**展示格（标题 / 定位形状 / 目标文稿），
 * 且把 line 的下限从 1 放宽到 0（五套里有三套给不出行级位置）。旧档少这几格、line 全是正整数，
 * 读出来语义一点没变——按「去 AI 味 · 能跳行 · 当前章」解释即可。不需要迁移，更不该把旧书
 * 的清单判成坏档。真要改字段含义或删字段才升 version 走显式迁移。
 */
import { SOURCE_LABELS, type ChecklistItem, type ChecklistSource } from "./submission-checklist";

export type IssueStatus = "open" | "fixed" | "ignored";

/**
 * 五套判据各一枚来源。`ai-slop` 是 v1 档里就写下的名字，保留不动以免旧书清单一夜之间
 * 被判「读不懂」；体检层管它叫 `slop`，适配时映射过来。
 */
export type IssueSource = "ai-slop" | "review" | "cast" | "foreshadow" | "timeline";

const SOURCES: readonly IssueSource[] = ["ai-slop", "review", "cast", "foreshadow", "timeline"];

/** 来源标签只从体检层那张表取，不另抄一份——改文案时不会漏掉这一处。 */
export const ISSUE_SOURCE_LABELS: Record<IssueSource, string> = {
  "ai-slop": SOURCE_LABELS.slop,
  review: SOURCE_LABELS.review,
  cast: SOURCE_LABELS.cast,
  foreshadow: SOURCE_LABELS.foreshadow,
  timeline: SOURCE_LABELS.timeline
};

export interface ReviewIssue {
  /** 稳定身份，见文件头。 */
  id: string;
  source: IssueSource;
  /** 最近一次体检的编辑框行号（1 起）；**0 = 这套判据给不出行级位置**，不是第 0 行。 */
  line: number;
  matched: string;
  strength: "strong" | "suspect";
  why: string;
  excerpt: string;
  status: IssueStatus;
  /** 以下三格是五套来源接进来后加的：v1 档没有，缺省按「去 AI 味 · 能跳行 · 当前章」解释。 */
  title?: string;
  locate?: "line" | "doc" | "none";
  relPath?: string;
}

export interface ReviewIssueBook {
  version: 1;
  /** relPath → 这一章的问题。不存在的键就是「这一章还没体检过」。 */
  chapters: Record<string, ReviewIssue[]>;
}

/** 现有判据产出的最小形状。写成结构类型，纯函数层就不必反向依赖面板那一份实现。 */
export interface SlopLike {
  line: number;
  matched: string;
  strength: "strong" | "suspect";
  why: string;
  excerpt: string;
}

const ID_SEP = "\u001f";
const STATUSES: readonly IssueStatus[] = ["open", "fixed", "ignored"];

export function emptyReviewIssueBook(): ReviewIssueBook {
  return { version: 1, chapters: {} };
}

/** 身份：来源 + 命中词 + 该处上下文。同一行两处相同词会合成一条——作者本来也是一起改。 */
export function issueIdOf(hit: SlopLike): string {
  return ["ai-slop", hit.matched, hit.excerpt].join(ID_SEP);
}

/** 一次体检的本轮发现：全部是待修，并按身份去重。 */
export function issuesFromSlop(hits: readonly SlopLike[]): ReviewIssue[] {
  const out: ReviewIssue[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const id = issueIdOf(hit);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      source: "ai-slop",
      line: hit.line,
      matched: hit.matched,
      strength: hit.strength,
      why: hit.why,
      excerpt: hit.excerpt,
      status: "open"
    });
  }
  return out;
}

/** 体检层五种来源 → 本层那枚来源值。写全五格，来源加一种时编译器会提醒。 */
const CHECKLIST_SOURCE: Record<ChecklistSource, IssueSource> = {
  slop: "ai-slop",
  review: "review",
  cast: "cast",
  foreshadow: "foreshadow",
  timeline: "timeline"
};

/**
 * 五套判据的现成结论 → 落盘条目（W-04 第二刀）。
 *
 * 【不新造规则】入口是 `buildSubmissionChecklist` 的 `ChecklistItem[]`——那上面已经写明
 * 哪条来自哪套检查、能不能定位、行号是编辑框行号还是 0。这里只做形状搬运，
 * 一个「什么算问题」的判断都没有；新接一种判据改的是体检层，不是这一层。
 *
 * 【字段怎么落】`id` 直接用体检层的章内指纹（去 AI 味那一条已去掉行号），
 * 这样「两个面板都收这一章」时不会同一处写出两条。`locate === "none"` 的篇级读数
 * 老实存 line 0，不伪造一个行号——跳原文的按钮由 UI 按 locate 决定给不给。
 * `matched` 只给去 AI 味留原始命中词（交给 AI 改时要还原成「第 N 行：「词」」），
 * 其余来源拿屏显标题顶上，它们本来也不会进改写指令。
 */
export function issuesFromChecklist(items: readonly ChecklistItem[]): ReviewIssue[] {
  return items.map((item) => ({
    id: item.id,
    source: CHECKLIST_SOURCE[item.source],
    line: item.line,
    matched: item.matched ?? item.title,
    strength: item.tone === "strong" ? ("strong" as const) : ("suspect" as const),
    why: item.detail,
    excerpt: item.locateLabel,
    status: "open" as const,
    title: item.title,
    locate: item.locate,
    relPath: item.relPath
  }));
}

/**
 * 复检合并：把「上一次的结论」与「这一次的扫描」并成一份新清单。
 *
 * 四条口径，都是产品语义不是实现细节：
 * - 用户标过「忽略」的永远保留忽略——复检不该把人已经拍板的决定又弹回来；
 * - 上一次「已修」但这次又扫到了，回到待修（复发要看得见）；
 * - 上一次「待修」、这次没扫到，自动落已修，但**保留条目**留痕（作者要看「修完没」）；
 * - 新扫到的追加在后面，不重排旧条目。
 */
export function mergeChapterIssues(
  existing: readonly ReviewIssue[],
  found: readonly ReviewIssue[]
): ReviewIssue[] {
  const byId = new Map(existing.map((item) => [item.id, item]));
  const merged: ReviewIssue[] = [];
  for (const fresh of found) {
    const old = byId.get(fresh.id);
    if (old === undefined) {
      merged.push(fresh);
      continue;
    }
    byId.delete(fresh.id);
    // ignored 是终态；fixed 又出现就是复发；open 保持。显示字段一律按这次刷新。
    const status: IssueStatus = old.status === "ignored" ? "ignored" : "open";
    merged.push({ ...fresh, status });
  }
  for (const left of byId.values()) {
    // 这次没扫到：待修的算改掉了；已修/忽略的照旧留痕。
    merged.push(left.status === "open" ? { ...left, status: "fixed" } : left);
  }
  return merged;
}

/** 手动改状态。找不到 id 就原样返回，不凭空造一条。 */
export function markIssue(
  items: readonly ReviewIssue[],
  id: string,
  status: IssueStatus
): ReviewIssue[] {
  return items.map((item) => (item.id === id ? { ...item, status } : item));
}

export function chapterIssuesOf(book: ReviewIssueBook, relPath: string): ReviewIssue[] {
  return book.chapters[relPath] ?? [];
}

/** 写回某一章。空清单就把键删掉，别让体检过的每一章都在文件里留个空壳。 */
export function withChapterIssues(
  book: ReviewIssueBook,
  relPath: string,
  items: readonly ReviewIssue[]
): ReviewIssueBook {
  const chapters = { ...book.chapters };
  if (items.length === 0) delete chapters[relPath];
  else chapters[relPath] = [...items];
  return { version: 1, chapters };
}

export function openCount(items: readonly ReviewIssue[]): number {
  return items.filter((item) => item.status === "open").length;
}

/** 这枚按钮只管去 AI 味：清单里混进另外四套之后，得单独数它自己的待修。 */
export function slopOpenCount(items: readonly ReviewIssue[]): number {
  return items.filter(
    (item) => item.status === "open" && item.source === "ai-slop" && item.line > 0
  ).length;
}

/**
 * 本章待修的**去 AI 味**条目 → 交给 AI 改的那份命中清单（W-04 第二刀）。
 *
 * 【为什么预填要改用留存清单】「把这份清单交给 AI 改」原先喂的是**这一秒**的扫描结果，
 * 于是作者标过「忽略」的、上次体检留下的待修又全回到预填里——跟踪了半天的结论等于没用。
 * W-04 要的就是「按留下的结论继续干」，所以有清单时只交待修的那几条。
 *
 * 【为什么按来源过滤】清单现在装着五套判据的结论，而「去 AI 味」这颗按钮的指令是
 * 「逐条改掉这些套话」。把「人物卡缺字段」「某伏笔待回收」当成套话递给模型，
 * 它只会照着编一段不存在的文字。四种非词表来源一律不进这份改写清单。
 *
 * 【为什么只投影这五个字段】id 是内部指纹（带 \u001f 分隔符）、status 是本地状态，
 * 塞进提示词只会让模型读一段它用不上的机器标记。回到 `SlopLike` 这个最小形状，
 * 就能直接喂给现成的 `slopChecklistPrompt`，不必在面板里另写一份文案。
 * 已修与已忽略都不进：前者不用再改，后者是作者拍过板的。
 */
export function openSlopHitsOf(items: readonly ReviewIssue[]): SlopLike[] {
  return items
    .filter((item) => item.status === "open" && item.source === "ai-slop" && item.line > 0)
    .map(({ line, matched, strength, why, excerpt }) => ({
      line,
      matched,
      strength,
      why,
      excerpt
    }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readIssue(value: unknown): ReviewIssue | null {
  if (!isRecord(value)) return null;
  const { id, source, line, matched, strength, why, excerpt, status, title, locate, relPath } =
    value;
  if (
    typeof id !== "string" ||
    id === "" ||
    typeof source !== "string" ||
    !SOURCES.includes(source as IssueSource) ||
    typeof line !== "number" ||
    !Number.isInteger(line) ||
    line < 0 ||
    typeof matched !== "string" ||
    (strength !== "strong" && strength !== "suspect") ||
    typeof why !== "string" ||
    typeof excerpt !== "string" ||
    typeof status !== "string" ||
    !STATUSES.includes(status as IssueStatus)
  )
    return null;
  const issue: ReviewIssue = {
    id,
    source: source as IssueSource,
    line,
    matched,
    strength,
    why,
    excerpt,
    status: status as IssueStatus
  };
  // 三格可选字段：出现了就必须形状对，没出现就干脆不写（exactOptionalPropertyTypes）。
  // 半截 JSON 里带一个数字 title 也算坏档——宁可停写，不许猜。
  if (title !== undefined) {
    if (typeof title !== "string") return null;
    issue.title = title;
  }
  if (locate !== undefined) {
    if (locate !== "line" && locate !== "doc" && locate !== "none") return null;
    issue.locate = locate;
  }
  if (relPath !== undefined) {
    if (typeof relPath !== "string") return null;
    issue.relPath = relPath;
  }
  return issue;
}

/**
 * 盘上那份 JSON 的形状校验。认不得返回 null，由通路按「读不懂」处理并停止写入。
 * version 不是 1 一律不认：真要改字段含义得走显式迁移，不能把新读法硬塞进旧档。
 * 五套来源那几格是**可选**的加法（见文件头），v1 档照原样读得回来，所以没升版本号。
 */
export function normalizeReviewIssueBook(parsed: unknown): ReviewIssueBook | null {
  if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.chapters)) return null;
  const chapters: Record<string, ReviewIssue[]> = {};
  for (const [relPath, raw] of Object.entries(parsed.chapters)) {
    if (relPath === "" || !Array.isArray(raw)) return null;
    const items: ReviewIssue[] = [];
    const seen = new Set<string>();
    for (const entry of raw) {
      const issue = readIssue(entry);
      if (issue === null || seen.has(issue.id)) return null;
      seen.add(issue.id);
      items.push(issue);
    }
    chapters[relPath] = items;
  }
  return { version: 1, chapters };
}
