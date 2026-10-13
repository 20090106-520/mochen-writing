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

export interface DiffLine {
  type: DiffLineType;
  /** 剥掉行首 `+` / `-` 之后的正文；header 与 context 原样。 */
  text: string;
}

/** 文件头与 hunk 头：形状先认，它们长得像改动行但不是。 */
function isHeader(line: string): boolean {
  return line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@");
}

/** 逐行分类。空串给空表——`"".split("\\n")` 会给出一个空元素，于是「没差异」被数成「有一行」。 */
export function parseDiffLines(diff: string): DiffLine[] {
  if (diff === "") return [];
  return diff.split("\n").map((line) => {
    if (isHeader(line)) return { type: "header", text: line };
    if (line.startsWith("+")) return { type: "add", text: line.slice(1) };
    if (line.startsWith("-")) return { type: "remove", text: line.slice(1) };
    return { type: "context", text: line };
  });
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
