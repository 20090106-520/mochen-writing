import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { BookKind, DocRef } from "@mochen/contracts";
import { proseCharCount, sortDocs } from "@mochen/contracts";
import { parseFrontmatter } from "./frontmatter.js";
import { toPosixRelPath } from "./paths.js";

export const DOC_DIRS = {
  chapter: "chapters",
  outline: "outline",
  character: "characters",
  plot: "plot",
  worldview: "worldview",
  faction: "factions",
  location: "locations",
  timeline: "timeline",
  glossary: "glossary",
  volume: "volumes",
  foreshadow: "foreshadow",
  skill: "skills"
} as const satisfies Record<Exclude<BookKind, "material">, string>;

const KIND_BY_DIR: Record<string, BookKind> = Object.fromEntries(
  Object.entries(DOC_DIRS).map(([kind, dir]) => [dir, kind as BookKind])
);

const SKIPPED_DIRS = new Set([".mochen", "node_modules"]);

/**
 * 正文一次性并发读完（2026-10-10 用户裁定：并发度 = 文稿数，不设固定上限）。
 *
 * 依据是实测不是推测。夹具 1000 章 × 3000 字（盘上 8.66 MB），本机清空负载后连跑两遍：
 * 串行 for-await 133–157 ms，限并发 8 为 29–43 ms，并发度=文稿数为 21–31 ms——
 * 三种读法的峰值堆都在 30–46 MB 一档（差在噪声内，不设上限并没有把峰值抬高一个量级）。
 * 先前在 dev 实例并发抢 IO 的那一轮量到过「限 8 更快」，重复测量不成立，这一版以复跑过的数字为准。
 * `Promise.all` 按输入序落位，所以并发之后 docs 的顺序与旧的逐个 push 逐字一致
 * （护栏在 test/scan-concurrency.test.ts：顺序 + 在途读 > 1 + readFile 次数不增）。
 *
 * 代价如实记在这儿，不粉饰：
 * ① 句柄数 = 文稿数（3000 章就是一次点开 3000 个文件），Windows 上实测可用，但它不再是有界资源；
 * ② `readFile` 每个请求按文件大小先分配一块 buffer，1000 个请求在途时这些 buffer 可以同时在世
 *    （上面那组峰值数字就是它）；换来的是这些正文**算完即弃、scan 不留任何缓存**，
 *    长期驻留只有 DocRef 表（title + 80 字摘录 + 字数，约 200 B/篇 ⇒ 1000 篇 ≈ 200 KB）。
 * ③ 为什么不能像 rollout.ts 那样只读头部把 ② 也省掉：`chars` 要数完整篇正文，头部读法对它不成立。
 */
export async function scanBook(root: string): Promise<DocRef[]> {
  // 两步：① 先收集清单（readdir 是目录级的，一次一层，串行不影响 IO 形状）；
  // ② 再一次性并发读正文。过去的写法把 await 放在 for 循环里，1000 篇就是 1000 次排队的全量读。
  const pending: { full: string; rel: string; kind: BookKind }[] = [];
  await collect(root, root, pending);
  return Promise.all(pending.map((item) => docRefOf(item.full, item.rel, item.kind)));
}

/**
 * 单独算一篇文稿的 DocRef：与 scanBook **同一份判据**（kindOf 认目录 + docMetaOf 出标题/摘录/字数），
 * 不另立第二套口径（铁律 6）。
 *
 * 存在的唯一理由：book-service 建章后过去要整本重扫（P1-4：1000 章 ⇒ 建一章读 1000 篇）。
 * 三种出去的方式：① 目录不是文稿目录 ⇒ null（扫描器本来也不收它）；
 * ② 盘上没有这一篇 ⇒ null，绝不拿文件名倒推一个 title、正文空串出来冒充「有这么一篇」；
 * ③ 读得到 ⇒ 与 scanBook 逐字相同的 DocRef。
 */
export async function docRefFor(root: string, relPath: string): Promise<DocRef | null> {
  const rel = toPosixRelPath(relPath);
  const kind = kindOf(rel);
  if (kind === null) return null;
  const full = path.join(root, ...rel.split("/"));
  // 一次 stat 问「这一篇在不在、是不是普通文件」：过去这里是 readdir 父目录再 includes，
  // 建一章要顺带列出整章目录（2026-10-10 用户指出）。不存在与是目录两种都算「没有这一篇」，
  // 绝不拿文件名倒推一个 title、正文空串出来冒充「有这么一篇」。
  const info = await stat(full).catch(() => null);
  if (info === null || !info.isFile()) return null;
  return docRefOf(full, rel, kind);
}

async function docRefOf(full: string, rel: string, kind: BookKind): Promise<DocRef> {
  const meta = await docMetaOf(full, rel);
  return { relPath: rel, kind, title: meta.title, excerpt: meta.excerpt, chars: meta.chars };
}

/** 收集要读的文稿清单：目录顺序、跳过规则、`.md` 与文稿目录判据都与旧的 walk 逐字一致。 */
async function collect(
  root: string,
  dir: string,
  out: { full: string; rel: string; kind: BookKind }[]
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".") && entry.name !== ".mochen") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      await collect(root, full, out);
      continue;
    }
    if (!entry.name.endsWith(".md")) continue;
    const rel = toPosixRelPath(path.relative(root, full));
    const kind = kindOf(rel);
    if (!kind) continue;
    out.push({ full, rel, kind });
  }
}

function kindOf(rel: string): BookKind | null {
  if (rel.startsWith("materials/")) return "material";
  const top = rel.split("/")[0] ?? "";
  return KIND_BY_DIR[top] ?? null;
}

/** 摘录正文按码点截这么长，超出加一个省略号（与 timeline.ts 的 Array.from 同律：按码点不按 UTF-16 码元）。 */
const EXCERPT_MAX = 80;

async function docMetaOf(
  full: string,
  rel: string
): Promise<{ title: string; excerpt: string; chars: number }> {
  const base = path.basename(rel, ".md");
  const fallback = (base.match(/^\d*[-_]?(.*)$/)?.[1] ?? "").trim() || rel;
  try {
    // 只读这一次：frontmatter 出 title，body 出 excerpt 与 chars，与旧 titleOf 的 readFile 次数完全一致。
    // 逃逸口提醒：IO 计数护栏（scan-excerpt.test.ts 的 readFile spy）只认这条 readFile——
    // 若改用 readFileSync / createReadStream 读，护栏的调用计数看不见，读放大就悄悄溜过。
    const { data, body } = parseFrontmatter(await readFile(full, "utf8"));
    const raw = data.title;
    const title = typeof raw === "string" && raw.trim() ? raw.trim() : fallback;
    return { title, excerpt: excerptOf(body), chars: proseCharCount(body) };
  } catch {
    return { title: fallback, excerpt: "", chars: 0 };
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

/**
 * 章节次序的**别名**，不是第二份实现（P1-4 后半，2026-10-10）。
 *
 * 判据只有一份，住在 `contracts/src/book.ts` 的 `sortDocs`——主进程与渲染层过去各有一份、
 * 且对「都不在 chapterOrder 里的两篇」判法不同（这边按名字序，那边保持来路顺序），
 * 于是「渲染层本地拼一根新 DocRef」永远证不出与整本重扫等价，那一次整本重扫就省不掉。
 * 语义、为什么取名字序、为什么 zh-CN，全部写在那一份真身头上，这里不重述一遍（重述就是第二份判据）。
 *
 * 为什么留这个名字而不删：`sortChapters` 已被 `book-service` 与既有测试引用，删导出属于删代码，
 * 要用户点名才动。留一个 `toBe` 级别的引用别名（`test/sort-judgement-single-source.test.ts` 钉住），
 * 比留一段抄本安全：抄本改得出行为，别名改不出。
 */
export const sortChapters = sortDocs;
