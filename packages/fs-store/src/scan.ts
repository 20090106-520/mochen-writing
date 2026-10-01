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
    out.push({ relPath: rel, kind, title: await titleOf(full, rel) });
  }
}

function kindOf(rel: string): BookKind | null {
  if (rel.startsWith("materials/")) return "material";
  const top = rel.split("/")[0] ?? "";
  return KIND_BY_DIR[top] ?? null;
}

async function titleOf(full: string, rel: string): Promise<string> {
  const base = path.basename(rel, ".md");
  const fallback = (base.match(/^\d*[-_]?(.*)$/)?.[1] ?? "").trim() || rel;
  try {
    const { data } = parseFrontmatter(await readFile(full, "utf8"));
    const title = data.title;
    return typeof title === "string" && title.trim() ? title.trim() : fallback;
  } catch {
    return fallback;
  }
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
