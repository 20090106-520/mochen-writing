import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { BookKind, DocRef } from "@mochen/contracts";
import { parseFrontmatter } from "./frontmatter.js";
import { toPosixRelPath } from "./paths.js";

export const DOC_DIRS = {
  chapter: "chapters",
  outline: "outline",
  character: "characters",
  plot: "plot"
} as const satisfies Record<Exclude<BookKind, "material">, string>;

const KIND_BY_DIR: Record<string, BookKind> = Object.fromEntries(
  Object.entries(DOC_DIRS).map(([kind, dir]) => [dir, kind as BookKind])
);

const SKIPPED_DIRS = new Set([".mochen", "node_modules"]);

export async function scanBook(root: string): Promise<DocRef[]> {
  const docs: DocRef[] = [];
  await walk(root, root, docs);
  return docs;
}

async function walk(root: string, dir: string, out: DocRef[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".") && entry.name !== ".mochen") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      await walk(root, full, out);
      continue;
    }
    if (!entry.name.endsWith(".md")) continue;
    const rel = toPosixRelPath(path.relative(root, full));
    const kind = kindOf(rel);
    if (!kind) continue;
    const meta = await docMetaOf(full, rel);
    out.push({ relPath: rel, kind, title: meta.title, excerpt: meta.excerpt });
  }
}

function kindOf(rel: string): BookKind | null {
  if (rel.startsWith("materials/")) return "material";
  const top = rel.split("/")[0] ?? "";
  return KIND_BY_DIR[top] ?? null;
}

/** 摘录正文按码点截这么长，超出加一个省略号（与 timeline.ts 的 Array.from 同律：按码点不按 UTF-16 码元）。 */
const EXCERPT_MAX = 80;

async function docMetaOf(full: string, rel: string): Promise<{ title: string; excerpt: string }> {
  const base = path.basename(rel, ".md");
  const fallback = (base.match(/^\d*[-_]?(.*)$/)?.[1] ?? "").trim() || rel;
  try {
    // 只读这一次：frontmatter 出 title，body 出 excerpt，与旧 titleOf 的 readFile 次数完全一致。
    const { data, body } = parseFrontmatter(await readFile(full, "utf8"));
    const raw = data.title;
    const title = typeof raw === "string" && raw.trim() ? raw.trim() : fallback;
    return { title, excerpt: excerptOf(body) };
  } catch {
    return { title: fallback, excerpt: "" };
  }
}

/** 取正文里第一段非空的纯文本，按码点截断；整篇空（或只有 frontmatter）⇒ 空串。 */
function excerptOf(body: string): string {
  for (const paragraph of body.split(/\r?\n[ \t]*\r?\n/)) {
    const text = plainTextFromMarkdown(paragraph);
    if (text !== "") return clipCodePoints(text, EXCERPT_MAX);
  }
  return "";
}

/**
 * 剥 markdown 记号：标题行整行丢弃，其余行去图片/链接壳、去强调与行内代码记号、去引用与列表前缀，
 * 再把行内空白折叠成单个空格。刻意保守——只做「让第一段可读」，不追求还原语义。
 */
function plainTextFromMarkdown(paragraph: string): string {
  const kept: string[] = [];
  for (const raw of paragraph.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    if (/^#{1,6}\s/.test(line)) continue; // 标题行：整行丢
    const text = line
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // 图片 → alt
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // 链接 → 文本
      .replace(/^>\s?/, "") // 引用前缀
      .replace(/^[-+*]\s+/, "") // 无序列表前缀
      .replace(/^\d+[.)]\s+/, "") // 有序列表前缀
      .replace(/[*_~`]+/g, "") // 强调 / 删除线 / 行内代码记号
      .replace(/\s+/g, " ")
      .trim();
    if (text !== "") kept.push(text);
  }
  return kept.join(" ");
}

/** 按码点（不是 UTF-16 码元）截断，超出加省略号；代理对要么整留要么整去。 */
function clipCodePoints(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : text;
}

export function sortChapters(docs: DocRef[], chapterOrder: string[]): DocRef[] {
  const rank = new Map(chapterOrder.map((rel, index) => [rel, index]));
  return [...docs].sort((a, b) => {
    const ra = rank.get(a.relPath);
    const rb = rank.get(b.relPath);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return a.relPath.localeCompare(b.relPath, "zh-CN");
  });
}
