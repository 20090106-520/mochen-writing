/**
 * EPUB 3 装配器（2026-10-05，批次 5-②）。
 *
 * **规范依据**（两个独立来源说法一致，不是照印象写的）：
 * - `mimetype` 必须是归档的**第一个条目**、**不压缩**、内容恰为 `application/epub+zip`
 *   20 字节且**不带换行**（OCF 3.0）。压缩了或排第二，Calibre 会直接判定「这不是 EPUB」。
 * - `META-INF/container.xml` 指向 OPF 包文档。
 * - `OEBPS/content.opf` 里是 metadata / manifest / spine。
 * - **EPUB 2 兼容要带 `toc.ncx`，EPUB 3 导航是 `nav.xhtml`**——2026 年仍有很多阅读器
 *   对 EPUB 2 的目录支持更好，两个都给才不挑设备（多个独立实现教程都这么说）。
 *
 * **为什么单独一个文件**：`export-service.ts` 已经 450+ 行，再塞 XHTML/OPF/NCX 三套模板
 * 会顶破 800 行预算；而且「EPUB 规范怎么满足」是一整块独立知识，混在导出开关里会看不见。
 */
import type { BookKind, BookMeta } from "@mochen/contracts";
import { splitFrontmatter } from "@mochen/contracts";
import { EPUB_MIMETYPE, buildZip, type ZipEntry } from "./zip.js";

export interface EpubDoc {
  relPath: string;
  kind: BookKind;
  title: string;
  content: string;
}

export interface EpubOptions {
  /** 语言标签（BCP 47），OPF 与章节都要用。默认 zh-CN。 */
  lang: string;
  /** 作者名；没有就留空（**不编一个"佚名"**——那是替用户编了事实）。 */
  author: string;
}

const DEFAULT_EPUB: EpubOptions = { lang: "zh-CN", author: "" };

/** XML 文本转义：`&` `<` `>` 在 XML 里必须转义，漏一个整个文件就解析不了。 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 文件名 → 归档内 XHTML 路径：ASCII + 小写 + 短。中文标题当路径在部分阅读器上会出问题。 */
function xhtmlName(index: number): string {
  return `ch${String(index + 1).padStart(3, "0")}.xhtml`;
}

/** 章节内文 → XHTML 段落。空行分段，其余按原样转义。 */
export function bodyToXhtml(markdownish: string): string {
  const paragraphs = markdownish
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (paragraphs.length === 0) return "<p>（这一篇还没有正文）</p>";
  return paragraphs
    .map((p) => {
      // 章内的一级/二级标题转成真标题，否则整章只有一个 h1 撑不起阅读器导航
      const heading = /^(#{1,3})\s+(.*)$/.exec(p.split("\n")[0] ?? "");
      if (heading !== null && p.split("\n").length === 1) {
        const level = (heading[1] ?? "#").length;
        return `<h${level}>${escapeXml(heading[2] ?? "")}</h${level}>`;
      }
      const lines = p
        .split("\n")
        .map((l) => escapeXml(l))
        .join("<br/>");
      return `<p>${lines}</p>`;
    })
    .join("\n");
}

const STYLE_CSS = `body { margin: 1em; line-height: 1.7; font-family: serif; }
h1 { font-size: 1.4em; margin: 1.2em 0 0.6em; }
h2 { font-size: 1.2em; margin: 1em 0 0.5em; }
h3 { font-size: 1.05em; margin: 0.9em 0 0.4em; }
p { margin: 0 0 0.8em; text-indent: 2em; }
h1, h2, h3 { text-indent: 0; }`;

/**
 * 造出 EPUB 字节。
 *
 * **只收章节**（kind === "chapter"）：人物卡、设定、伏笔这些进电子书没有阅读价值，
 * 而且会让目录变成一堆碎片。调用方传进来的 docs 若一章都没有，返回 null——
 * 「导出一本零章的书」不如不导，调用方据此给一句中文。
 */
export function buildEpub(
  docs: readonly EpubDoc[],
  meta: BookMeta | null,
  options: Partial<EpubOptions> = {}
): Buffer | null {
  const opts: EpubOptions = { ...DEFAULT_EPUB, ...options };
  const chapters = docs.filter((d) => d.kind === "chapter");
  if (chapters.length === 0) return null;

  const title = meta?.title ?? "未命名作品";
  // unique-identifier：规范要求必须有。用书名 + 篇数生成一个稳定值——
  // 刻意不引 uuid 依赖也不取时间戳：时间戳会让同一本书两次导出得到两个不同的 id。
  const uid = `mochen-${sanitizeUid(title)}-${chapters.length}`;

  const chapterFiles = chapters.map((doc, i) => ({
    id: `ch${i + 1}`,
    href: xhtmlName(i),
    title: doc.title,
    doc
  }));

  const entries: ZipEntry[] = [
    // ① mimetype：第一条、不压缩。顺序是规范硬要求，buildZip 不排序，所以只能靠这里排对。
    { name: "mimetype", text: EPUB_MIMETYPE, store: true },
    {
      name: "META-INF/container.xml",
      text: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
    },
    { name: "OEBPS/style.css", text: STYLE_CSS },
    ...chapterFiles.map((c) => ({
      name: `OEBPS/${c.href}`,
      text: chapterXhtml(title, c.title, c.doc.content, opts.lang)
    })),
    { name: "OEBPS/nav.xhtml", text: navXhtml(title, chapterFiles, opts.lang) },
    { name: "OEBPS/toc.ncx", text: tocNcx(title, chapterFiles, uid) },
    { name: "OEBPS/content.opf", text: contentOpf(title, opts, uid, chapterFiles) }
  ];

  return buildZip(entries);
}

function chapterXhtml(
  bookTitle: string,
  chapterTitle: string,
  content: string,
  lang: string
): string {
  const { body } = splitFrontmatter(content);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(lang)}" lang="${escapeXml(lang)}">
<head>
  <meta charset="utf-8"/>
  <title>${escapeXml(chapterTitle)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <h1>${escapeXml(chapterTitle)}</h1>
  <p class="book-title">${escapeXml(bookTitle)}</p>
${bodyToXhtml(body)}
</body>
</html>`;
}

interface ChapterFile {
  id: string;
  href: string;
  title: string;
}

function navXhtml(bookTitle: string, chapters: readonly ChapterFile[], lang: string): string {
  const items = chapters
    .map((c) => `      <li><a href="${c.href}">${escapeXml(c.title)}</a></li>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(lang)}">
<head><meta charset="utf-8"/><title>目录</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目录</h1>
    <ol>
${items}
    </ol>
  </nav>
</body>
</html>`;
}

function tocNcx(bookTitle: string, chapters: readonly ChapterFile[], uid: string): string {
  // EPUB 2 的目录：playOrder 从 1 连续递增，不能跳号也不能重复
  const points = chapters
    .map(
      (c, i) => `    <navPoint id="nav${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${escapeXml(c.title)}</text></navLabel>
      <content src="${c.href}"/>
    </navPoint>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(uid)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(bookTitle)}</text></docTitle>
  <navMap>
${points}
  </navMap>
</ncx>`;
}

function contentOpf(
  title: string,
  opts: EpubOptions,
  uid: string,
  chapters: readonly ChapterFile[]
): string {
  const manifestChapters = chapters
    .map((c) => `    <item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`)
    .join("\n");
  const spine = chapters.map((c) => `    <itemref idref="${c.id}"/>`).join("\n");
  // author 为空时不写 dc:creator：写一个"佚名"是替用户编事实。
  const creator =
    opts.author === "" ? "" : `    <dc:creator>${escapeXml(opts.author)}</dc:creator>\n`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${escapeXml(uid)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
${creator}    <dc:language>${escapeXml(opts.lang)}</dc:language>
    <meta property="dcterms:modified">1970-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
${manifestChapters}
  </manifest>
  <spine toc="ncx">
${spine}
  </spine>
</package>`;
}

/** unique-identifier 用：只留 ASCII 字母数字与横线，中文等一律去掉（避免非 ASCII 进 id）。 */
function sanitizeUid(title: string): string {
  const ascii = title.replace(/[^A-Za-z0-9-]/g, "");
  return ascii === "" ? "book" : ascii.slice(0, 32).toLowerCase();
}
