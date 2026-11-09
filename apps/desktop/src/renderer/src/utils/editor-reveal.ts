import { splitFrontmatter } from "@mochen/contracts";

/**
 * 「交稿体检」跳回正文的定位层（2026-11-09 W-04）。
 *
 * 正文编辑器是原生 `<textarea>`（`DocumentPane` 里只有这一个），没有现成的
 * 「滚到第 N 行」通道；既有的 `SelectionRewriteBar` / `useEditUndo` 用的也是
 * `focus + setSelectionRange` 这对 DOM 原语。这里把同一对原语收成一处：
 * 选中整行、把行滚到视口中间，失败就回 `false`，由调用处如实说明「没定位到」。
 */

/** 正文编辑框的选择器：与 `DocumentPane.vue` 里的 textarea 类名一致。 */
export const EDITOR_TEXTAREA_SELECTOR = "textarea.document-editor";

/** 1 起的行号 → 该行首字符的偏移；行号不是正整数或越界时回 `null`。 */
export function lineStartOffset(text: string, line: number): number | null {
  if (!Number.isInteger(line) || line < 1) return null;
  if (line === 1) return 0;
  let seen = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "\n") continue;
    seen += 1;
    if (seen === line) return i + 1;
  }
  return null;
}

/**
 * 人物核对的行号按「剥掉 frontmatter 之后的正文」数；
 * 换回编辑框里带围栏的行号，否则点过去会偏几行。
 */
export function draftLineOfBodyLine(raw: string, bodyLine: number): number {
  if (!Number.isInteger(bodyLine) || bodyLine < 1) return 0;
  const { block } = splitFrontmatter(raw);
  if (block === null) return bodyLine;
  return bodyLine + block.split("\n").length;
}

/**
 * 选中第 `line` 行并滚到视口中间。
 * 没有 DOM（单测环境）或找不到编辑框时回 `false`，不抛。
 */
export function revealEditorLine(line: number): boolean {
  if (typeof document === "undefined") return false;
  const el = document.querySelector<HTMLTextAreaElement>(EDITOR_TEXTAREA_SELECTOR);
  if (el === null) return false;
  const start = lineStartOffset(el.value, line);
  if (start === null) return false;
  const lineBreak = el.value.indexOf("\n", start);
  const end = lineBreak === -1 ? el.value.length : lineBreak;
  el.focus();
  el.setSelectionRange(start, end);
  scrollLineIntoView(el, line);
  return true;
}

/** 按行高估算 `scrollTop`：`setSelectionRange` 不保证把行滚进视口。 */
function scrollLineIntoView(el: HTMLTextAreaElement, line: number): void {
  if (typeof getComputedStyle !== "function") return;
  const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;
  const target = (line - 1) * lineHeight - el.clientHeight / 2 + lineHeight / 2;
  el.scrollTop = Math.max(0, target);
}
