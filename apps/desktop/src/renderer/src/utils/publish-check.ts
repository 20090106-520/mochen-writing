/**
 * W-08 发布前检查（本地纯函数，2026-11-11）。
 *
 * 导出和审稿原先完全脱节：发布前有没有空章、重名章、字数异常、编号断档，全靠作者
 * 自己回头数一遍。这里把这几件能用**已有事实**判定的先摆出来：字数取 `DocRef.chars`
 * （scan 顺路带出的正文字数，零额外读盘），标题与相对路径也是扫描结果。
 *
 * 三条边界，写在前头免得后来被「顺手补强」破掉：
 * ① **不内置敏感词库**。词库是内容判断，不该由代码替作者定；只查作者自己填的词，
 *    而且那串词只活在这一次检查里，不写进书、不落盘。
 * ② **禁词只能查有正文的章**。导出面板只为勾选章节读了正文，覆盖率必须如实回报，
 *    不许拿「没查出禁词」冒充「全书没有禁词」。
 * ③ **只报，不改**：这里不删章、不改正文、不发请求；要怎么处理由作者在导出面板决定。
 */

export const PUBLISH_ISSUE_KINDS = [
  "empty",
  "duplicate-title",
  "word-count-outlier",
  "numbering-gap",
  "banned-word"
] as const;
export type PublishIssueKind = (typeof PUBLISH_ISSUE_KINDS)[number];

/** `Record` 是编译期闸：加一种检查却忘了给名字，tsc 就红。 */
export const PUBLISH_ISSUE_LABELS: Record<PublishIssueKind, string> = {
  empty: "空章",
  "duplicate-title": "重复章名",
  "word-count-outlier": "字数异常",
  "numbering-gap": "章节断号",
  "banned-word": "命中禁词"
};

export interface PublishChapter {
  relPath: string;
  title: string;
  /** `DocRef.chars ?? 0`：扫描顺路量好的正文字数，没有就按 0 字算。 */
  chars: number;
  /** 只有导出面板已经读出正文的那些章才有；没读出就不查禁词、也不谎报覆盖。 */
  content?: string;
}

export interface PublishIssue {
  kind: PublishIssueKind;
  /** 章级问题填该章相对路径；书级问题（断号）填空串——它不该排除任何一章。 */
  relPath: string;
  title: string;
  detail: string;
}

export interface PublishCheckResult {
  issues: PublishIssue[];
  /** 禁词实际查过正文的章数（界面必须如实写出来）。 */
  checkedContentCount: number;
  /** 结构检查覆盖的章数（= 传进来的全部章）。 */
  checkedChapterCount: number;
}

/** 作者填的那串词：逗号 / 顿号 / 换行都算分隔，去重、去空、限制单条长度，避免误填一整段话。 */
export function parseBannedWords(input: string): string[] {
  const words = input
    .split(/[,，、\n]/)
    .map((word) => word.trim())
    .filter((word) => word !== "" && word.length <= 32);
  return [...new Set(words)];
}

function wholeChars(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2)
    : (sorted[mid] ?? 0);
}

export function publishCheck(
  chapters: readonly PublishChapter[],
  bannedWords: readonly string[]
): PublishCheckResult {
  const issues: PublishIssue[] = [];
  const charsByPath = chapters.map((chapter) => wholeChars(chapter.chars));

  // ① 空章：一个正文都没有，导出去了就是一张空页。
  chapters.forEach((chapter, index) => {
    if ((charsByPath[index] ?? 0) === 0) {
      issues.push({
        kind: "empty",
        relPath: chapter.relPath,
        title: chapter.title,
        detail: "这一章还没有正文"
      });
    }
  });

  // ② 重复章名：trim 后同名才算（「第一章 」与「第一章」是同一个名字）。
  const titleCounts = new Map<string, number>();
  for (const chapter of chapters) {
    const key = chapter.title.trim();
    if (key !== "") titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
  }
  for (const chapter of chapters) {
    const key = chapter.title.trim();
    if (key !== "" && (titleCounts.get(key) ?? 0) > 1) {
      issues.push({
        kind: "duplicate-title",
        relPath: chapter.relPath,
        title: chapter.title,
        detail: `全书有 ${titleCounts.get(key)} 篇叫「${key}」`
      });
    }
  }

  // ③ 字数异常：只跟这本书自己的章中位数比，不设跨书的绝对线。
  //    少于三章、或空章（已由①报过）都不参与，免得小样本乱报、同一章报两条。
  const positive = charsByPath.filter((chars) => chars > 0);
  if (positive.length >= 3) {
    const median = medianOf(positive);
    if (median > 0) {
      chapters.forEach((chapter, index) => {
        const chars = charsByPath[index] ?? 0;
        if (chars > 0 && (chars < median * 0.3 || chars > median * 3)) {
          issues.push({
            kind: "word-count-outlier",
            relPath: chapter.relPath,
            title: chapter.title,
            detail: `${chars.toLocaleString("zh-CN")} 字，全书章中位数 ${median.toLocaleString("zh-CN")} 字`
          });
        }
      });
    }
  }

  // ④ 章节断号：只认阿拉伯数字「第N章」这种能确定解析的标题，认不出就一个都不报
  //    （中文数字、卷名、番外都不猜）。书级问题，不指向任何一章。
  const numbers = new Set<number>();
  for (const chapter of chapters) {
    const matched = /第\s*(\d+)\s*章/.exec(chapter.title);
    if (matched?.[1] !== undefined) {
      const n = Number(matched[1]);
      if (Number.isSafeInteger(n) && n > 0) numbers.add(n);
    }
  }
  if (numbers.size >= 2) {
    const sorted = [...numbers].sort((a, b) => a - b);
    const first = sorted[0] ?? 0;
    const last = sorted[sorted.length - 1] ?? 0;
    const missing: number[] = [];
    for (let n = first; n <= last; n += 1) if (!numbers.has(n)) missing.push(n);
    if (missing.length > 0) {
      issues.push({
        kind: "numbering-gap",
        relPath: "",
        title: "全书",
        detail: `从第 ${first} 章到第 ${last} 章之间缺 ${missing.map((n) => `第 ${n} 章`).join("、")}`
      });
    }
  }

  // ⑤ 自定义禁词：只查真有正文的章。大小写不敏感是给英文词留的，中文不受影响。
  let checkedContentCount = 0;
  if (bannedWords.length > 0) {
    for (const chapter of chapters) {
      if (typeof chapter.content !== "string") continue;
      checkedContentCount += 1;
      const haystack = chapter.content.toLowerCase();
      const hits = bannedWords
        .map((word) => ({ word, count: haystack.split(word.toLowerCase()).length - 1 }))
        .filter((hit) => hit.count > 0);
      if (hits.length > 0) {
        issues.push({
          kind: "banned-word",
          relPath: chapter.relPath,
          title: chapter.title,
          detail: hits.map((hit) => `「${hit.word}」${hit.count} 次`).join("、")
        });
      }
    }
  }

  const order = new Map(PUBLISH_ISSUE_KINDS.map((kind, index) => [kind, index]));
  issues.sort(
    (a, b) =>
      (order.get(a.kind) ?? 99) - (order.get(b.kind) ?? 99) ||
      a.relPath.localeCompare(b.relPath) ||
      a.detail.localeCompare(b.detail)
  );
  return { issues, checkedContentCount, checkedChapterCount: chapters.length };
}

/** 汇总条：`空章 2 · 重复章名 2 · 命中禁词 1`；没问题时给一句人话。 */
export function publishCheckSummary(result: PublishCheckResult): string {
  const counts = new Map<PublishIssueKind, number>();
  for (const issue of result.issues) counts.set(issue.kind, (counts.get(issue.kind) ?? 0) + 1);
  const parts = PUBLISH_ISSUE_KINDS.filter((kind) => (counts.get(kind) ?? 0) > 0).map(
    (kind) => `${PUBLISH_ISSUE_LABELS[kind]} ${counts.get(kind)}`
  );
  return parts.length === 0 ? "没发现问题" : parts.join(" · ");
}

/** 「只勾检查通过的章」：书级问题（断号）不排除任何一章，章级问题才排除。 */
export function passingChapterPaths(
  chapters: readonly PublishChapter[],
  issues: readonly PublishIssue[]
): string[] {
  const flagged = new Set(
    issues.filter((issue) => issue.relPath !== "").map((issue) => issue.relPath)
  );
  return chapters
    .filter((chapter) => !flagged.has(chapter.relPath))
    .map((chapter) => chapter.relPath);
}
