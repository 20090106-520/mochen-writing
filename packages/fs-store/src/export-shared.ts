/**
 * 导出层的**纯**部分：类型、格式化、体积估算。零 Node 依赖。
 *
 * **为什么要有这个文件（2026-10-05 批次 5-② 撞出来的）**：
 * 渲染层 `ExportDialog.vue` 需要三样东西——`ExportFormat` 类型、`formatByteSize`、
 * `estimateExportSize`。它们原先从 `@mochen/fs-store/export-service` 取，而那份
 * 因为新增 EPUB 而传递依赖了 `epub.ts → zip.ts`（`node:zlib`）⇒ 整条链会进浏览器 bundle。
 * 那是 2026-10-05 批次 3 撞过的**同一个白屏根因**（渲染层 import 了带 Node 依赖的模块，
 * `tsc` 与 build 全绿、首屏白屏），`tools/check-package-boundary.mjs` 当场报了出来。
 *
 * **修法不是「把 node: 摘干净」（那要引 zip 库），而是「把跑字节的挪到主进程」**：
 * 渲染层只负责选格式、显示体积、预览文件名；组装走 `file:build-export` 到主进程。
 * 这条边界是**包边界门禁逼出来的、也是对的**：二进制组装本就不该在渲染层。
 *
 * 类型与判定的唯一真身现在在 **contracts 的 `export.ts`**（跨层契约，preload 要用它声明形状），
 * 本文件只 re-export + 放纯函数，不重写一份（铁律 6）。
 */
import { proseCharCount, splitFrontmatter } from "@mochen/contracts";
import type { ExportFormat, ExportableDoc } from "@mochen/contracts";

export type { ExportableDoc, ExportFormat, ExportOptions, ExportResult } from "@mochen/contracts";
export { DEFAULT_EXPORT_OPTIONS } from "@mochen/contracts";

/**
 * 估算导出大小（用于 UI 展示）。
 *
 * **EPUB 系数刻意小（1.4）**：它是压缩过的 zip，比 HTML 小得多。
 * 照着 HTML 的 3.5 估会让用户以为电子书比网页还大十几倍。
 */
export function estimateExportSize(
  docs: ExportableDoc[],
  format: ExportFormat
): { chars: number; approxBytes: number } {
  const chars = docs.reduce(
    (sum, d) => sum + proseCharCount(splitFrontmatter(d.content ?? "").body),
    0
  );
  const multiplier =
    format === "json"
      ? 4
      : format === "epub"
        ? 1.4
        : format === "html" || format === "print" || format === "docx"
          ? 3.5
          : 3;
  return { chars, approxBytes: Math.round(chars * multiplier) };
}

/** Escape HTML 实体，防止 XSS */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 简易 Markdown → HTML 转换（零依赖，基础正则替换） */
export function markdownToSimpleHtml(markdown: string): string {
  // 先把源文整体转义，再套 markdown 规则 —— 顺序不能反。
  // 旧实现是「边匹配边 escapeHtml」，可段落规则的负向先行断言 `^(?!<[a-z/]…)`
  // 故意放过了行首是 `<` 的行，于是 .md 里的裸 HTML（`<img onerror=…>`）原样留在输出里，
  // 被 DocumentPane 的 v-html 注入渲染进程。渲染进程带 preload、拿得到 window.mochen 的读写通路，
  // 那是实打实的 XSS。回归线见 test/export-service-markdown.test.ts。
  // 转义提到最前面之后，下面各条规则都不再二次 escapeHtml（否则 & 会变成 &amp;amp;）。
  let html = escapeHtml(markdown);

  // 代码块（优先处理，避免内部内容被后续规则干扰）
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) => {
    return `<pre><code>${code.trimEnd()}</code></pre>`;
  });

  // 行内代码
  html = html.replace(/`([^`]+)`/g, (_m, code) => {
    return `<code>${code}</code>`;
  });

  // 标题 h1-h4
  html = html.replace(/^####\s+(.+)$/gm, (_m, text) => `<h4>${text}</h4>`);
  html = html.replace(/^###\s+(.+)$/gm, (_m, text) => `<h3>${text}</h3>`);
  html = html.replace(/^##\s+(.+)$/gm, (_m, text) => `<h2>${text}</h2>`);
  html = html.replace(/^#\s+(.+)$/gm, (_m, text) => `<h1>${text}</h1>`);

  // 粗体和斜体
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, (_m, text) => `<strong><em>${text}</em></strong>`);
  html = html.replace(/\*\*(.+?)\*\*/g, (_m, text) => `<strong>${text}</strong>`);
  html = html.replace(/\*(.+?)\*/g, (_m, text) => `<em>${text}</em>`);

  // 分割线
  html = html.replace(/^---+$/gm, "<hr />");

  // 无序列表
  html = html.replace(/^[\s]*[-*]\s+(.+)$/gm, (_m, text) => `<li>${text}</li>`);
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (_m) => {
    return `<ul>${_m}</ul>`;
  });

  // 有序列表
  html = html.replace(/^[\s]*\d+\.\s+(.+)$/gm, (_m, text) => `<li>${text}</li>`);

  // 段落：连续非空文本行合并为 <p>。跳过行首是 `<` 的（前面规则自己生成的标签）与空行。
  html = html.replace(/^(?!<[a-z/]|$)(.+)$/gm, (_m, text) => `<p>${text}</p>`);

  return html;
}

/**
 * 文件名去非法字符（渲染层算「文件名：xxx」那行预览也要用，所以住这里）。
 *
 * **真身唯一**：`export-service.ts` 也调它，两处不许各写一份正则（铁律 6）。
 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[/\\<>:|"*?]/g, "_").slice(0, 80);
}

/** 某格式对应的文件名后缀（含点）。渲染层算预览与主进程真写盘共用这一份。 */
export function extensionOf(format: ExportFormat): string {
  if (format === "markdown") return ".md";
  if (format === "plaintext") return ".txt";
  if (format === "html" || format === "print") return ".html";
  if (format === "docx") return ".doc";
  if (format === "epub") return ".epub";
  return ".json";
}

/** 将字节数格式化为可读字符串 */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
