/**
 * 交稿问题清单的状态模型（W-04 第一刀，2026-11-12）。
 *
 * 【这一层解决什么】五个审稿面板现在都是临时浮层：看完关掉就没了，不记状态、不能标记
 * 「已处理」、改完也不能复检。作者得自己拿纸记「还有三条没修」。这一层只管**跟踪到修完**：
 * 按章留存、每条有状态、复检时把「改掉了」自动落成已修。判据一律复用现有面板（第一版接
 * 去 AI 味一项），这里不写任何「什么算问题」的规则。
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
 */

export type IssueStatus = "open" | "fixed" | "ignored";

/** 第一版只接去 AI 味。其余四项判据接进来时加一枚来源，不改状态模型。 */
export type IssueSource = "ai-slop";

export interface ReviewIssue {
  /** 稳定身份，见文件头。 */
  id: string;
  source: IssueSource;
  /** 最近一次体检的行号（1 起），只用于跳原文。 */
  line: number;
  matched: string;
  strength: "strong" | "suspect";
  why: string;
  excerpt: string;
  status: IssueStatus;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readIssue(value: unknown): ReviewIssue | null {
  if (!isRecord(value)) return null;
  const { id, source, line, matched, strength, why, excerpt, status } = value;
  if (
    typeof id !== "string" ||
    id === "" ||
    source !== "ai-slop" ||
    typeof line !== "number" ||
    !Number.isInteger(line) ||
    line < 1 ||
    typeof matched !== "string" ||
    (strength !== "strong" && strength !== "suspect") ||
    typeof why !== "string" ||
    typeof excerpt !== "string" ||
    typeof status !== "string" ||
    !STATUSES.includes(status as IssueStatus)
  )
    return null;
  return {
    id,
    source,
    line,
    matched,
    strength,
    why,
    excerpt,
    status: status as IssueStatus
  };
}

/**
 * 盘上那份 JSON 的形状校验。认不得返回 null，由通路按「读不懂」处理并停止写入。
 * version 不是 1 一律不认：将来升级格式得走显式迁移，不能把新字段硬塞进旧读法。
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
