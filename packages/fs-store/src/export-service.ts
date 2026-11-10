/**
 * ExportService —— 导出功能
 *
 * 提供多种格式的写作导出：
 * - Markdown（默认，零依赖）
 * - 纯文本
 * - HTML（含内联 CSS，独立文档）
 * - 打印友好 HTML（含 @media print 样式、页码）
 * - Word (.doc) — Word 兼容的 HTML 格式，Word 可直接打开
 * - EPUB 3（zip 包，自带目录）— 2026-10-05 批次 5-②
 * - JSON（结构化备份数据）
 *
 * 导出时剥离 frontmatter，可按章节顺序拼接。
 *
 * **这份只住主进程**（2026-10-05 批次 5-②）：EPUB 要 `node:zlib`，渲染层 import 这条链
 * 会把 Node 模块打进浏览器 bundle ⇒ 首屏白屏。渲染层走 `file:build-export` 到主进程，
 * 纯函数另在 `@mochen/fs-store/export-shared`。
 */
import { proseCharCount, splitFrontmatter } from "@mochen/contracts";
import type { BookMeta } from "@mochen/contracts";
import {
  DEFAULT_EXPORT_OPTIONS,
  type ExportFormat,
  type ExportOptions,
  type ExportResult
} from "@mochen/contracts";
import { buildEpub } from "./epub.js";
import {
  escapeHtml,
  estimateExportSize,
  FALLBACK_EXPORT_NAME,
  formatByteSize,
  markdownToSimpleHtml,
  sanitizeFilename,
  type ExportableDoc
} from "./export-shared.js";

export type { ExportFormat, ExportableDoc, ExportOptions, ExportResult } from "@mochen/contracts";
export { estimateExportSize, formatByteSize, markdownToSimpleHtml, sanitizeFilename };

const DEFAULT_OPTIONS: ExportOptions = DEFAULT_EXPORT_OPTIONS;

function formatMetaLine(meta: BookMeta | null, format: ExportFormat): string {
  if (!meta) return "";
  const activeStage = meta.stages?.find((s) => s.id === meta.activeStage);
  const activeStageName = activeStage?.name ?? meta.activeStage;
  const stages = meta.stages?.length ?? 0;

  if (format === "html" || format === "print" || format === "docx" || format === "epub") {
    return [
      `<div class="book-meta">`,
      `  <h1 class="book-title">${escapeHtml(meta.title)}</h1>`,
      `  <dl class="book-meta-list">`,
      `    <dt>当前阶段</dt><dd>${escapeHtml(activeStageName)}</dd>`,
      `    <dt>权限档</dt><dd>${escapeHtml(meta.permissionMode)}</dd>`,
      `    <dt>阶段数</dt><dd>${stages}</dd>`,
      `  </dl>`,
      `</div>`
    ].join("\n");
  }

  // markdown / plaintext 风格
  const lines = [
    `# ${meta.title}`,
    "",
    `- 当前阶段：${activeStageName}`,
    `- 权限档：${meta.permissionMode}`,
    `- 阶段数：${stages}`,
    ""
  ];
  return lines.join("\n");
}

/** 拼接章节内容为 markdown */
function assembleMarkdown(
  docs: ExportableDoc[],
  meta: BookMeta | null,
  options: ExportOptions
): string {
  const chapters =
    options.docRelPaths.length > 0
      ? docs.filter((d) => options.docRelPaths.includes(d.relPath))
      : docs.filter((d) => d.kind === "chapter");

  const parts: string[] = [];

  if (options.includeMeta) {
    parts.push(formatMetaLine(meta, "markdown"));
  }

  const separator = options.separatorBetweenChapters ? "\n\n---\n\n" : "\n\n";

  for (const chapter of chapters) {
    const body = options.includeFrontmatter
      ? chapter.content
      : splitFrontmatter(chapter.content).body;
    parts.push(`## ${chapter.title}\n`);
    if (body) parts.push(body);
  }

  return parts.join(separator);
}

/** 拼接为纯文本 */
function assemblePlaintext(
  docs: ExportableDoc[],
  meta: BookMeta | null,
  options: ExportOptions
): string {
  const chapters =
    options.docRelPaths.length > 0
      ? docs.filter((d) => options.docRelPaths.includes(d.relPath))
      : docs.filter((d) => d.kind === "chapter");

  const parts: string[] = [];

  if (options.includeMeta && meta) {
    parts.push(meta.title);
    parts.push("=".repeat(meta.title.length));
    parts.push("");
  }

  for (const chapter of chapters) {
    parts.push(chapter.title);
    parts.push("-".repeat(chapter.title.length));
    const body = options.includeFrontmatter
      ? chapter.content
      : splitFrontmatter(chapter.content).body;
    if (body) parts.push(body);
    parts.push("");
  }

  return parts.join("\n");
}

/** 拼接为 HTML */
function assembleHtml(
  docs: ExportableDoc[],
  meta: BookMeta | null,
  options: ExportOptions,
  printMode: boolean
): string {
  const chapters =
    options.docRelPaths.length > 0
      ? docs.filter((d) => options.docRelPaths.includes(d.relPath))
      : docs.filter((d) => d.kind === "chapter");

  const pageNumbersStyle =
    options.includePageNumbers && printMode
      ? `
    .page-number { display: none; }
    @media print {
      .page-number {
        display: block;
        text-align: center;
        font-size: 10pt;
        color: #999;
        margin-top: 2em;
        page-break-after: always;
      }
      .chapter { page-break-before: always; }
      .chapter:first-of-type { page-break-before: avoid; }
    }`
      : "";

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(meta?.title ?? "导出文档")}</title>
  <style>
    body {
      font-family: -apple-system, "Noto Serif SC", "Source Han Serif SC", "Microsoft YaHei", serif;
      line-height: 1.8;
      max-width: 780px;
      margin: 0 auto;
      padding: 2em 1.5em;
      color: #333;
      background: #fff;
    }
    h1 { font-size: 1.8em; border-bottom: 2px solid #eee; padding-bottom: 0.3em; }
    h2 { font-size: 1.5em; margin-top: 2em; color: #222; }
    h3 { font-size: 1.25em; color: #444; }
    h4 { font-size: 1.1em; color: #555; }
    pre {
      background: #f6f8fa;
      padding: 1em;
      border-radius: 6px;
      overflow-x: auto;
      font-size: 0.9em;
      line-height: 1.5;
    }
    code { font-family: "Fira Code", "SFMono-Regular", Consolas, monospace; }
    :not(pre) > code {
      background: #f0f0f0;
      padding: 0.15em 0.4em;
      border-radius: 3px;
      font-size: 0.88em;
    }
    blockquote {
      border-left: 4px solid #ddd;
      margin: 1em 0;
      padding: 0.5em 1em;
      color: #666;
      background: #fafafa;
    }
    hr { border: none; border-top: 1px solid #ddd; margin: 2em 0; }
    ul, ol { padding-left: 1.5em; }
    li { margin: 0.3em 0; }
    .book-meta { margin-bottom: 2em; padding-bottom: 1em; border-bottom: 2px solid #eee; }
    .book-title { text-align: center; margin-bottom: 0.5em; }
    .book-meta-list {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 0.2em 1em;
      font-size: 0.9em;
      color: #777;
    }
    .book-meta-list dt { font-weight: 500; }
    .book-meta-list dd { margin: 0; }
    .chapter { margin-bottom: 2.5em; }
    ${
      printMode
        ? `@media print {
      body { padding: 0; max-width: none; }
      h1, h2, h3 { page-break-after: avoid; }
      pre, blockquote { page-break-inside: avoid; }
    }`
        : ""
    }${pageNumbersStyle}
  </style>
</head>
<body>
${options.includeMeta ? `  ${formatMetaLine(meta, printMode ? "print" : "html")}` : ""}
${chapters
  .map((chapter, idx) => {
    const body = options.includeFrontmatter
      ? chapter.content
      : splitFrontmatter(chapter.content).body;
    const htmlBody = body ? markdownToSimpleHtml(body) : "";
    const pageNum =
      options.includePageNumbers && printMode
        ? `\n  <div class="page-number">${idx + 1}</div>`
        : "";
    return `  <section class="chapter">
    <h2>${escapeHtml(chapter.title)}</h2>
    ${htmlBody}${pageNum}
  </section>`;
  })
  .join("\n")}
</body>
</html>`;

  return html;
}

/** 拼接为 Word 兼容的 HTML（.doc 扩展名，Word 可直接打开） */
function assembleDocx(
  docs: ExportableDoc[],
  meta: BookMeta | null,
  options: ExportOptions
): string {
  const chapters =
    options.docRelPaths.length > 0
      ? docs.filter((d) => options.docRelPaths.includes(d.relPath))
      : docs.filter((d) => d.kind === "chapter");

  const title = escapeHtml(meta?.title ?? "导出文档");

  const body = `<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    @page {
      mso-page-orientation: portrait;
      size: 21cm 29.7cm;
      margin: 2.54cm 2.54cm 2.54cm 2.54cm;
    }
    body {
      font-family: "宋体", "SimSun", "Times New Roman", serif;
      font-size: 12pt;
      line-height: 1.8;
      color: #000;
    }
    h1 {
      font-size: 18pt;
      font-family: "黑体", "SimHei", sans-serif;
      text-align: center;
      mso-heading-level: 1;
    }
    h2 {
      font-size: 16pt;
      font-family: "黑体", "SimHei", sans-serif;
      mso-heading-level: 2;
      margin-top: 12pt;
    }
    h3 { font-size: 14pt; font-family: "黑体", "SimHei", sans-serif; mso-heading-level: 3; }
    h4 { font-size: 12pt; font-family: "黑体", "SimHei", sans-serif; mso-heading-level: 4; }
    p { text-indent: 2em; margin: 0 0 6pt 0; }
    pre {
      font-family: "Courier New", monospace;
      font-size: 10pt;
      background: #f5f5f5;
      padding: 8pt;
      border: 0.5pt solid #ccc;
    }
    :not(pre) > code { font-family: "Courier New", monospace; }
    blockquote {
      border-left: 3pt solid #ccc;
      margin: 6pt 0 6pt 2em;
      padding-left: 8pt;
      color: #555;
    }
    hr { border: none; border-top: 1pt solid #999; margin: 12pt 0; }
    table { border-collapse: collapse; margin: 8pt 0; }
    /* 正文表格（2026-11-10）：渲染器才认表格，导出也得给线，否则导出的 HTML/EPUB
       里表格只是几个字并排。排除扉页那张 border=0 的信息表——它自己有内联 margin。 */
    table:not([border="0"]) th,
    table:not([border="0"]) td {
      border: 0.5pt solid #ccc;
      padding: 4pt 8pt;
      text-align: left;
      vertical-align: top;
    }
    table:not([border="0"]) th { background: #f5f5f5; }
  </style>
</head>
<body>

${
  options.includeMeta
    ? `<h1>${title}</h1>
<table border="0" cellspacing="0" cellpadding="0" style="margin:0 auto 24pt auto;">
  <tr><td style="padding:2pt 8pt;"><b>当前阶段：</b></td><td>${escapeHtml(meta?.stages?.find((s) => s.id === meta?.activeStage)?.name ?? meta?.activeStage ?? "")}</td></tr>
  <tr><td style="padding:2pt 8pt;"><b>权限档：</b></td><td>${escapeHtml(meta?.permissionMode ?? "")}</td></tr>
  <tr><td style="padding:2pt 8pt;"><b>阶段数：</b></td><td>${meta?.stages?.length ?? 0}</td></tr>
</table>`
    : ""
}

${chapters
  .map((chapter) => {
    const content = options.includeFrontmatter
      ? chapter.content
      : splitFrontmatter(chapter.content).body;
    const htmlBody = content ? markdownToSimpleHtml(content) : "";
    return `<h2>${escapeHtml(chapter.title)}</h2>
${htmlBody}`;
  })
  .join("\n<hr />\n")}

</body>
</html>`;

  return body;
}

/** 导出为 JSON 结构化数据 */
function assembleJson(docs: ExportableDoc[], meta: BookMeta | null): string {
  const data = {
    meta,
    exportedAt: new Date().toISOString(),
    docs: docs.map((d) => ({
      relPath: d.relPath,
      title: d.title,
      kind: d.kind,
      charCount: proseCharCount(splitFrontmatter(d.content ?? "").body),
      content: d.content ?? ""
    })),
    totalChars: docs.reduce(
      (sum, d) => sum + proseCharCount(splitFrontmatter(d.content ?? "").body),
      0
    )
  };
  return JSON.stringify(data, null, 2);
}

/**
 * 根据选项导出内容（渲染层调 IPC，这里只提供内容组装；
 * 真正的文件写入在主进程完成）
 */
export function buildExportContent(
  docs: ExportableDoc[],
  meta: BookMeta | null,
  options: Partial<ExportOptions> = {}
): ExportResult {
  const opts: ExportOptions = { ...DEFAULT_OPTIONS, ...options };
  const safeName = sanitizeFilename(meta?.title ?? FALLBACK_EXPORT_NAME);

  let content: string;
  let filename: string;

  switch (opts.format) {
    case "markdown":
      content = assembleMarkdown(docs, meta, opts);
      filename = `${safeName}.md`;
      break;
    case "plaintext":
      content = assemblePlaintext(docs, meta, opts);
      filename = `${safeName}.txt`;
      break;
    case "html":
      content = assembleHtml(docs, meta, opts, false);
      filename = `${safeName}.html`;
      break;
    case "print":
      content = assembleHtml(docs, meta, opts, true);
      filename = `${safeName}.html`;
      break;
    case "docx":
      content = assembleDocx(docs, meta, opts);
      filename = `${safeName}.doc`;
      break;
    case "json":
      content = assembleJson(docs, meta);
      filename = `${safeName}.json`;
      break;
    case "epub": {
      // EPUB 走 bytes 不走 content：它是个 zip 包，按 utf-8 写盘就是乱码。
      // 一章都没有时 buildEpub 回 null —— 导出一本零章的书不如不导，调用方据此给一句中文。
      filename = `${safeName}.epub`;
      const bytes = buildEpub(docs, meta);
      if (bytes === null) {
        return { content: "", bytes: null, format: opts.format, filename, byteSize: 0 };
      }
      return {
        content: "",
        bytes,
        format: opts.format,
        filename,
        byteSize: bytes.length
      };
    }
    default:
      content = assembleMarkdown(docs, meta, opts);
      filename = `${safeName}.md`;
  }

  return {
    content,
    bytes: null,
    format: opts.format,
    filename,
    byteSize: new Blob([content], { type: "text/plain;charset=utf-8" }).size
  };
}
