/**
 * unified diff 文本的行级分类（2026-10-13）。
 *
 * **为什么从 `DiffHighlighter.vue` 里搬出来**：改稿历史要在 diff 上面再报一句「新增几行、删除几行」，
 * 而计数必须与那一片绿/红**同一份分类**——不然会出现「染了 3 行绿、句子报 2 行」这种自相矛盾的数，
 * 而用户怀疑的是整份对比。搬之前那份分类只住在 `.vue` 的 `<script setup>` 里，
 * 本仓 verify 跑裸 `tsc`、`.vue` 整体不进类型程序也没有运行时覆盖 ⇒ 搬进 `.ts` 才能被 vitest 钉死。
 *
 * 判据与 `packages/agent-runtime/src/diff.ts` 的 `unifiedDiff` 对齐：它产出
 * `--- a/…` / `+++ b/…` 两行文件头与 `@@ … @@` 的 hunk 头，这三类都不是改动行。
 */

export type DiffLineType = "add" | "remove" | "context" | "header";

/**
 * 一行内部的片段（2026-10-22 逐字 diff）：
 * 行级 diff 只说「这一整行变了」，改一处字时用户看到的是一整行红 + 一整行绿，
 * 哪几个字动了得自己脑补。这个类型把那一段再切成「没变的 / 变了的」两档，
 * 渲染层只给 changed 段加底色。
 */
export interface DiffSegment {
  text: string;
  changed: boolean;
}

export interface DiffLine {
  type: DiffLineType;
  /** 剥掉行首 `+` / `-` 之后的正文；header 与 context 原样。 */
  text: string;
  /** 只对成对的 add / remove 行给出；没有配对行时缺省（渲染层退回整行着色）。 */
  segments?: DiffSegment[];
}

/** 文件头与 hunk 头：形状先认，它们长得像改动行但不是。 */
function isHeader(line: string): boolean {
  return line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@");
}

/**
 * 两行之间的逐字差异：先摘公共前缀、再摘公共后缀，中间那截就是真正改动的部分。
 * 按**码点**比较（`Array.from`），否则代理对（emoji、生僻字）会被劈成两半。
 *
 * 为什么不做真正的 LCS：提案的 anchor/replace 通常是一段被重写的句子，
 * 前后缀已经能标出「哪几个字动了」；跑逐字 LCS 在一个长段落上要平方级，
 * 而收益是「中间插入的几个字也能精确挑出来」——对一个改稿预览来说不值这个价。
 */
export function inlineDiff(
  before: string,
  after: string
): {
  before: DiffSegment[];
  after: DiffSegment[];
} {
  if (before === after) {
    return { before: before === "" ? [] : [{ text: before, changed: false }], after: [] };
  }
  const a = Array.from(before);
  const b = Array.from(after);
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const seg = (chars: string[], changed: boolean): DiffSegment | null =>
    chars.length === 0 ? null : { text: chars.join(""), changed };
  const build = (chars: string[]): DiffSegment[] =>
    [
      seg(chars.slice(0, prefix), false),
      seg(chars.slice(prefix, chars.length - suffix), true),
      seg(chars.slice(chars.length - suffix), false)
    ].filter((item): item is DiffSegment => item !== null);
  return { before: build(a), after: build(b) };
}

/**
 * 把相邻的「删几行 + 加几行」按行号对齐，逐对算行内片段。
 *
 * 只对**紧挨着的**删块与加块配对：中间隔着上下文行就不是同一处在改，
 * 强行配对会把两处互不相关的改动染成「这一行里换了几个字」，比不染更误导。
 * 行数不等时只配前 min(删, 加) 对，多出来的整行保持整行着色（那就是整行新增/删除）。
 */
function withInlineSegments(lines: DiffLine[]): DiffLine[] {
  const out = lines.map((line) => ({ ...line }));
  let index = 0;
  while (index < out.length) {
    if (out[index]!.type !== "remove") {
      index += 1;
      continue;
    }
    let removeEnd = index;
    while (removeEnd < out.length && out[removeEnd]!.type === "remove") removeEnd += 1;
    let addEnd = removeEnd;
    while (addEnd < out.length && out[addEnd]!.type === "add") addEnd += 1;
    const pairs = Math.min(removeEnd - index, addEnd - removeEnd);
    for (let k = 0; k < pairs; k += 1) {
      const pair = inlineDiff(out[index + k]!.text, out[removeEnd + k]!.text);
      out[index + k]!.segments = pair.before;
      out[removeEnd + k]!.segments = pair.after;
    }
    index = Math.max(addEnd, removeEnd);
  }
  return out;
}

/**
 * 逐行分类，并给成对的改动行补上行内片段。
 * 空串给空表——`"".split("\\n")` 会给出一个空元素，于是「没差异」被数成「有一行」。
 */
export function parseDiffLines(diff: string): DiffLine[] {
  if (diff === "") return [];
  const lines = diff.split("\n").map((line): DiffLine => {
    if (isHeader(line)) return { type: "header", text: line };
    if (line.startsWith("+")) return { type: "add", text: line.slice(1) };
    if (line.startsWith("-")) return { type: "remove", text: line.slice(1) };
    return { type: "context", text: line };
  });
  return withInlineSegments(lines);
}

/** 改动行数（文件头那两行一次都不算）。 */
export function countDiffMarks(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of parseDiffLines(diff)) {
    if (line.type === "add") added += 1;
    else if (line.type === "remove") removed += 1;
  }
  return { added, removed };
}
