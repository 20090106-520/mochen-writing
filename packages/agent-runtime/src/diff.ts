/**
 * 逐行（不逐字）diff：中栏提案卡用它渲染改动预览（Task 14 走 `agentDiff` IPC），
 * 因此产物必须是标准 unified diff 文本，且首尾未改动的行要被修剪掉——
 * 否则一章几千行的文稿只改一句也会退化成「整篇删除 + 整篇新增」。
 */
export interface DiffOp {
  kind: "eq" | "add" | "del";
  lines: string[];
}

const LCS_CELL_CAP = 1_000_000;

function splitLines(text: string): string[] {
  if (text === "") return [];
  return text.replace(/\r\n/g, "\n").split("\n");
}

/** 中段用 LCS 动态规划（O(n·m) 格）求最长公共行序列；规模超上限时退化为「整段删 + 整段加」。 */
function lcsOps(a: string[], b: string[]): DiffOp[] {
  if (a.length * b.length > LCS_CELL_CAP)
    return [
      { kind: "del", lines: a },
      { kind: "add", lines: b }
    ];
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] =
        a[i] === b[j]
          ? table[(i + 1) * cols + j + 1]! + 1
          : Math.max(table[(i + 1) * cols + j]!, table[i * cols + j + 1]!);
    }
  }
  const ops: DiffOp[] = [];
  const push = (kind: DiffOp["kind"], line: string) => {
    const last = ops[ops.length - 1];
    if (last !== undefined && last.kind === kind) last.lines.push(line);
    else ops.push({ kind, lines: [line] });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("eq", a[i]!);
      i += 1;
      j += 1;
    } else if (table[(i + 1) * cols + j]! >= table[i * cols + j + 1]!) {
      push("del", a[i]!);
      i += 1;
    } else {
      push("add", b[j]!);
      j += 1;
    }
  }
  while (i < a.length) {
    push("del", a[i]!);
    i += 1;
  }
  while (j < b.length) {
    push("add", b[j]!);
    j += 1;
  }
  return ops;
}

export function diffLines(before: string, after: string): DiffOp[] {
  const a = splitLines(before);
  const b = splitLines(after);
  // 公共前缀/后缀先摘掉：既让 LCS 只跑真正改动的中段（可读性 + 规模），
  // 也保证首尾相同的行一定被判成 eq 而不是巧合对齐。
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const head: DiffOp[] = start > 0 ? [{ kind: "eq", lines: a.slice(0, start) }] : [];
  const tail: DiffOp[] = endA < a.length ? [{ kind: "eq", lines: a.slice(endA) }] : [];
  return [...head, ...lcsOps(a.slice(start, endA), b.slice(start, endB)), ...tail];
}

interface Tagged {
  tag: " " | "+" | "-";
  text: string;
  oldNo: number;
  newNo: number;
}

export function unifiedDiff(before: string, after: string, relPath: string, context = 3): string {
  const ops = diffLines(before, after);
  if (ops.every((op) => op.kind === "eq")) return "";
  let oldNo = 1;
  let newNo = 1;
  const tagged: Tagged[] = [];
  for (const op of ops) {
    for (const line of op.lines) {
      if (op.kind === "eq") tagged.push({ tag: " ", text: line, oldNo: oldNo++, newNo: newNo++ });
      else if (op.kind === "del") tagged.push({ tag: "-", text: line, oldNo: oldNo++, newNo: 0 });
      else tagged.push({ tag: "+", text: line, oldNo: 0, newNo: newNo++ });
    }
  }
  // 逐行标记：changed 必须与 tagged 同下标对齐（计划正文此处多写了 .filter(Boolean)，
  // 它会把掩码压实成「只数改动行」的短数组，上下文窗口因此整体错位、hunk 行号也就不可信）。
  const changed = tagged.map((line) => line.tag !== " ");
  const keep = tagged.map(() => false);
  for (let index = 0; index < tagged.length; index += 1) {
    if (!changed[index]) continue;
    for (let offset = -context; offset <= context; offset += 1) {
      const at = index + offset;
      if (at >= 0 && at < tagged.length) keep[at] = true;
    }
  }
  const hunks: string[] = [];
  let index = 0;
  while (index < tagged.length) {
    if (!keep[index]) {
      index += 1;
      continue;
    }
    let hunkEnd = index;
    while (hunkEnd < tagged.length && keep[hunkEnd]) hunkEnd += 1;
    // 把同一段里被上下文串起来的行合并成一个 hunk
    const body = tagged.slice(index, hunkEnd);
    const oldStart = body.find((line) => line.oldNo > 0)?.oldNo ?? 1;
    const newStart = body.find((line) => line.newNo > 0)?.newNo ?? 1;
    const oldCount = body.filter((line) => line.oldNo > 0).length;
    const newCount = body.filter((line) => line.newNo > 0).length;
    hunks.push(
      [
        `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
        ...body.map((line) => `${line.tag}${line.text}`)
      ].join("\n")
    );
    index = hunkEnd;
  }
  return [`--- a/${relPath}`, `+++ b/${relPath}`, ...hunks].join("\n");
}
