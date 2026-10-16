/**
 * TXT 导入分章（2026-10-11）。
 *
 * 存量稿几乎全是 txt（且常见 GBK 编码），而「旧书接手」那类技能都默认书已在库里——
 * 这一坨就是「把一本盘上的 txt 变成书里一组章节」的判定层。
 *
 * 分工（与全仓口径一致）：
 * - **纯判定**（这一份）：编码探测、切章、规划书内路径——主进程与单测同吃一份，无 IO；
 * - **IO 与守卫**（main/import-service.ts）：选文件、读字节、落盘——走 fs-store 的原子写与
 *   `createDocFile` 既有守卫，不另写第二套「路径安全 / 已存在拒绝」。
 */

import { planDocRelPath } from "./book.js";
import { proseCharCount, normalizeNewlines } from "./text.js";

/** 一次导入的字节上限。20 MB ≈ 一部 700 万字的长篇还有余；超限说明选错了文件（比如整站打包）。 */
export const TXT_IMPORT_MAX_BYTES = 20 * 1024 * 1024;

/** 一章的草稿：title 进 frontmatter 与文件名，content 是正文（不含章节标题行）。 */
export interface TxtChapterDraft {
  title: string;
  content: string;
  /** 正文字数，与文稿树 DocRef.chars 同一口径（proseCharCount），预览列表直接显示。 */
  chars: number;
}

/**
 * 编码探测：先按**严格** UTF-8 解一遍（fatal:true，有任何一个字节不成序列就抛），
 * 解不动才判 GBK。为什么这样够用：GBK 与 UTF-8 的 ASCII 区间完全重合（纯英文怎么判都一样），
 * 而成段的汉字在 GBK 里恰好构成合法 UTF-8 序列的概率低到实测可忽略；
 * 反过来 UTF-8 稿件误判成 GBK 会整篇变乱码——所以「宁可解不动再退，不抢先退」。
 */
export function detectTxtEncoding(bytes: Uint8Array): "utf-8" | "gbk" {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return "utf-8";
  } catch {
    return "gbk";
  }
}

/**
 * 章节标题行：整行**只**是标题才算（长度另行限到 60 字符以内）。
 * 收录的形态——「第一章」「第 12 节」「第三章 标题」「序章 / 楔子 / 引子 / 尾声 / 番外」、
 * 「Chapter 3 …」、行首短编号「12、标题」「1. 标题」「3：标题」。
 * 刻意不收「第X卷」单独成行之外的模糊形态：正文里出现「他说：第一个人……」这类句子
 * 不该被错认成新章。编号形态要求编号后必须有标题文字，纯数字行（常见于空行残渣）不算。
 */
const CHAPTER_HEADING = new RegExp(
  "^(?:第\\s*[0-9零〇一二三四五六七八九十百千万两]+\\s*[章节回卷部篇集]" +
    "(?:\\s*[:：.、·—-]?\\s*\\S.*)?|" +
    "(?:序章|楔子|引子|前言|自序|后记|尾声|终章|番外)(?:\\s*[:：.、·—-]?\\s*\\S.*)?|" +
    "Chapter\\s+\\d+(?:\\s*[:：.、·—-]?\\s*\\S.*)?|" +
    "\\d{1,4}\\s*[、.．:：]\\s*\\S.*)$"
);

/** 标题行太长就不是标题（正文整段被错认成章，比漏认一章伤得多——漏了还能手动加，切错了要拆半天）。 */
const HEADING_MAX_CHARS = 60;

/** 把「第三章：风起」里的分隔符与多余空白剥掉，得到可当文件名的标题。 */
function headingTitleOf(line: string): string {
  return line
    .replace(/\s+/g, " ")
    .replace(/\s*[:：.、·—-]\s*$/, "")
    .trim();
}

/**
 * 切章（纯函数，唯一实现）。规则：
 * - CRLF 与孤立 CR 统一成 LF（老 Windows 稿件与 Mac 经典稿都得认）；
 * - 逐行找标题行（≤60 字符且命中 CHAPTER_HEADING），命中即开新章；
 * - 第一条标题之前如果有正文，归入 `fallbackTitle`（通常是文件名）那一章——
 *   「开头没标题」是常态，这段字不能悄悄丢；
 * - 一条标题都没有 ⇒ 整篇就是一章，标题用 `fallbackTitle`。
 */
export function splitTxtChapters(text: string, fallbackTitle: string): TxtChapterDraft[] {
  const lines = normalizeNewlines(text).split("\n");
  const chapters: TxtChapterDraft[] = [];
  let currentTitle: string | null = null;
  let buffer: string[] = [];

  const flush = (): void => {
    const content = buffer.join("\n").replace(/^\n+|\n+$/g, "");
    const title = (currentTitle ?? fallbackTitle).trim();
    chapters.push({
      title: title === "" ? fallbackTitle : title,
      content,
      chars: proseCharCount(content)
    });
    buffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length <= HEADING_MAX_CHARS && line !== "" && CHAPTER_HEADING.test(line)) {
      if (currentTitle !== null || buffer.some((l) => l.trim() !== "")) flush();
      currentTitle = headingTitleOf(line);
      continue;
    }
    buffer.push(rawLine);
  }
  // 收尾：最后一段正文（或「只有标题没有正文」的最后一章）也要落进来。
  if (currentTitle !== null || buffer.some((l) => l.trim() !== "")) flush();
  return chapters;
}

/**
 * commit 的输入：预览确认后的章目清单。只收 title + content——
 * 渲染层递不了路径，`chapters/<标题>.md` 由主进程用 planDocRelPath 拼（铁律：路径由主进程拼）。
 */
export interface TxtImportCommitInput {
  chapters: { title: string; content: string }[];
}

/**
 * 预览的返回。`canceled` 单列：用户点取消是**正常操作**，与「读不到/选错了」分开，
 * 渲染层对它不该弹任何红字。
 */
export type TxtImportPreviewResult =
  | { ok: true; fileName: string; encoding: "utf-8" | "gbk"; chapters: TxtChapterDraft[] }
  | {
      ok: false;
      reason: "canceled" | "no-book" | "too-large" | "read-error" | "empty";
      message: string;
    };

export type TxtImportCommitResult =
  | { ok: true; created: string[] }
  | {
      ok: false;
      reason: "no-book" | "empty" | "too-large" | "invalid-title" | "name-conflict" | "io-error";
      message: string;
      /** reason:name-conflict 时列出撞名的标题（预览里点名改哪几条）。 */
      conflicts?: string[];
    };

/**
 * 给整批章节规划书内路径并查重（纯函数）：标题非法与批内重名都在这里拦，
 * 让主进程在**写第一个字之前**就知道这批能不能落——「导到一半撞名」比「一开始就不开始」糟得多。
 */
export function planImportRelPaths(
  chapters: { title: string }[]
): { ok: true; relPaths: string[] } | { ok: false; invalid: string[]; conflicts: string[] } {
  const invalid: string[] = [];
  const conflicts: string[] = [];
  const seen = new Set<string>();
  const relPaths: string[] = [];
  for (const { title } of chapters) {
    const relPath = planDocRelPath("chapter", title);
    if (relPath === null) {
      invalid.push(title);
      continue;
    }
    if (seen.has(relPath)) {
      conflicts.push(title);
      continue;
    }
    seen.add(relPath);
    relPaths.push(relPath);
  }
  if (invalid.length > 0 || conflicts.length > 0) return { ok: false, invalid, conflicts };
  return { ok: true, relPaths };
}
