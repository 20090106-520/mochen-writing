import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import type { BookMeta, DocCreateResult } from "@mochen/contracts";
import { parseBookMeta } from "@mochen/contracts";
import { makeFingerprint } from "./fingerprint.js";
import { defaultAtomicFs, writeFileAtomic, type AtomicWriteFs } from "./atomic-write.js";
import { writeBookMetaFile } from "./book-meta.js";
import { assertSafeRelPath } from "./paths.js";
import { DOC_DIRS } from "./scan.js";

/** 这一层只认五类盘上失败；"no-book" 是 service 层的事，不会从这里出去。 */
export type CreateDocFileResult =
  { ok: true; fingerprint: string } | Extract<DocCreateResult, { ok: false }>;

/** 新文档的初始内容：frontmatter 只带 title，正文留白——标题来自文件名规划时的同一份标题。 */
export function docTemplate(title: string): string {
  return `---\ntitle: ${title}\n---\n\n`;
}

/**
 * 在书内建一篇文档。三条硬边界：
 * ① 路径必须安全（assertSafeRelPath 挡越界与空路径）；
 * ② 必须落在分组目录之一（扫描器不认的路径建了也白建，宁可当场拒绝）；
 * ③ 文件已存在一律拒绝——这条通道只管「新建」，改写走 writeDoc 的指纹链。
 *
 * `body`（2026-10-11，TXT 导入）：非空时作为正文拼在 frontmatter 之后。
 * 默认 "" 与旧行为逐字一致——「新建」仍是空文档；导入的章只是**带了正文的同一种新建**，
 * 守卫一份不抄、一份不漏。
 */
export async function createDocFile(
  root: string,
  relPath: string,
  title: string,
  /** 原子写的 fs 缝，与 `writeDocFile` 同源（P0-1）。 */
  fs: AtomicWriteFs = defaultAtomicFs,
  /** 正文（不含 frontmatter）。TXT 导入用；行内新建与既有调用不传它，行为不变。 */
  body = ""
): Promise<CreateDocFileResult> {
  let safe: string;
  try {
    safe = assertSafeRelPath(relPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: message.startsWith("outside-book") ? "outside-book" : "invalid-path",
      message
    };
  }
  const top = safe.split("/")[0] ?? "";
  const allowed = new Set([...Object.values(DOC_DIRS), "materials"]);
  if (!allowed.has(top))
    return {
      ok: false,
      reason: "not-doc-dir",
      message: `新文档只能建在 ${[...allowed].join(" / ")} 之下，收到 ${safe}`
    };

  const target = path.join(root, ...safe.split("/"));
  const existing = await readdir(path.dirname(target)).catch((error: NodeJS.ErrnoException) =>
    error.code === "ENOENT" ? null : Promise.reject(error)
  );
  if (existing !== null && existing.includes(path.basename(target)))
    return { ok: false, reason: "already-exists", message: `${safe} 已经存在，没有覆盖它` };

  const content = docTemplate(title) + body;
  // 新建也走原子写：半途而废的「新文档」同样是一篇读不回来的正文（P0-1）。
  await writeFileAtomic(target, content, fs);
  return { ok: true, fingerprint: makeFingerprint(content) };
}

/**
 * 建一本书的骨架：book.json + 五个分组目录。目录必须不存在或为空——
 * 已有 book.json 说明这是一本打开就能用的书（走 book:open）；
 * 目录里有别的东西则拒绝，绝不往用户没点头的目录里盖文件。
 */
export async function createBookSkeleton(
  directory: string,
  rawMeta: BookMeta,
  /** 原子写的 fs 缝（P0-1）：book.json 半截 = 这本书打不开。 */
  fs: AtomicWriteFs = defaultAtomicFs
): Promise<{ ok: true } | { ok: false; message: string }> {
  const meta = parseBookMeta(rawMeta);
  const entries = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      // 目录还不存在：让 mkdir 顺路建（父目录也一起，选目录对话框允许新建文件夹）。
      return null;
    }
    throw error;
  });
  if (entries !== null && entries.length > 0)
    return { ok: false, message: "所选目录不是空的——为免盖到已有内容，新书必须建在空目录里。" };

  await mkdir(directory, { recursive: true });
  await mkdir(path.join(directory, DOC_DIRS.chapter), { recursive: true });
  await mkdir(path.join(directory, DOC_DIRS.outline), { recursive: true });
  await mkdir(path.join(directory, DOC_DIRS.character), { recursive: true });
  await mkdir(path.join(directory, DOC_DIRS.plot), { recursive: true });
  await mkdir(path.join(directory, "materials"), { recursive: true });
  // 形状与写法都在 `book-meta` 那一处：建书与改设置必须写出逐字相同的 book.json。
  await writeBookMetaFile(directory, meta, fs);
  return { ok: true };
}
