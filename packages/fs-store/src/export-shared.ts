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
import { proseCharCount, splitFrontmatter, windowsReservedNameProblem } from "@mochen/contracts";
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

/**
 * GFM 表格分隔行里的一个单元格：`---` / `:---` / `---:` / `:---:`。
 *
 * 横线**从宽到两条**：规范里一条就算数，模型手写对齐时常写 `:--`（两条）。
 * 卡三条会把它判成「不是表格」，整块原样露在屏上——正是这条规则要治的东西。
 * 从宽不会误伤：调用方还要求每行首尾都有 `|`、且第二行每个单元格都长这样。
 */
const TABLE_SEPARATOR_CELL = /^:?-{2,}:?$/;

/**
 * 表格（2026-11-10）：模型摆「两版对比、人物对照」时最常用的排法，此前**完全不支持**。
 *
 * 后果是整块原样躺在屏上——一排竖线夹着 `---`，读起来跟代码块没什么区别。
 * 用户报「输出的东西不要代码」，有一部分就是它：模型不是写了代码，是写了个表格。
 *
 * **只认最标准的一种写法**：每行首尾都有 `|`，且第二行是分隔行。缺一样就把原 block
 * 原样退回去，让段落规则照旧当文本处理——宁可显示得朴素，也不要猜错把正文拆坏。
 * 对齐标记（`:---:`）不保留：它只会变成 `style` 或 `align` 属性，导出到 docx/epub
 * 时还要多养一条样式，收益不值。
 *
 * 传入的 block 已经过 `escapeHtml`，所以单元格里的裸标签是 `&lt;` 文本，
 * 这里拼的 `<th>` / `<td>` 才有资格被当成标签。
 */
function renderTableBlock(block: string): string {
  const rows = block
    .replace(/\n+$/, "")
    .split("\n")
    .map((row) => row.trim())
    .filter((row) => row !== "");
  if (rows.length < 2) return block;
  if (!rows.every((row) => row.startsWith("|") && row.endsWith("|"))) return block;
  const cellsOf = (row: string): string[] =>
    row
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());
  const [headRow, separatorRow, ...bodyRows] = rows;
  if (headRow === undefined || separatorRow === undefined) return block;
  if (!cellsOf(separatorRow).every((cell) => TABLE_SEPARATOR_CELL.test(cell))) return block;
  const head = cellsOf(headRow)
    .map((cell) => `<th>${cell}</th>`)
    .join("");
  const body = bodyRows
    .map(
      (row) =>
        `<tr>${cellsOf(row)
          .map((cell) => `<td>${cell}</td>`)
          .join("")}</tr>`
    )
    .join("");
  return `<table><thead><tr>${head}</tr></thead>${body === "" ? "" : `<tbody>${body}</tbody>`}</table>`;
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
  //
  // **2026-10-10 补上 `<ol>`**：原来只产 `<li>` 不包列表容器，浏览器对「不在列表容器里的 li」
  // 不画项目符号/编号，于是 **1. 2. 3. 整个消失**——列表行还在，序号没了。
  // 对话区最先撞上它（模型爱写编号清单），导出也会跟着受益。
  //
  // **为什么先落记号再包**：无序与有序两支用的是同一条「包住连续的 `<li>`」正则。
  // 若有序项也光秃秃地产 `<li>`，第二遍会把上一支**已经包进 `<ul>` 的那些行再包一次 `<ol>`**，
  // 实测出来是 `<ul><ol><li>甲</li><li>乙</li></ol></ul>`——无序列表被改了结构。
  // 记号只在包装那一瞬间存在，包完立刻摘掉，不留在输出里。
  html = html.replace(/^[\s]*\d+\.\s+(.+)$/gm, (_m, text) => `<li class="ol-item">${text}</li>`);
  html = html.replace(/(<li class="ol-item">.*<\/li>\n?)+/g, (_m) => {
    return `<ol>${_m.replace(/ class="ol-item"/g, "")}</ol>`;
  });

  // 表格（2026-11-10）：必须排在段落规则**之前**——段落会先把这些行包成 `<p>`，
  // 之后再想拼 `<table>` 就得从标签里往外抠文本了。
  html = html.replace(/(?:^\|.*\|[ \t]*\n?)+/gm, (block) => renderTableBlock(block));

  // 段落：连续非空文本行合并为 <p>。跳过行首是 `<` 的（前面规则自己生成的标签）与空行。
  html = html.replace(/^(?!<[a-z/]|$)(.+)$/gm, (_m, text) => `<p>${text}</p>`);

  return html;
}

/** 书名为空、或净化后为空/撞 Windows 保留名时的兜底导出名。**真身只有这一处**（铁律 6）。 */
export const FALLBACK_EXPORT_NAME = "未命名作品";

/**
 * 导出默认文件名（保存对话框里那个默认名，`export-service.ts` 拼 `${safeName}.md`）。
 *
 * **与 `contracts` 的 `sanitizeDocFileName` 同一档口径**（2026-10-16 收口台账 §六十三 第 3 条）：
 * 去八样非法字符、删控制字符、剥尾部点与空格、挡 Windows 保留名——保留名判据直接复用
 * `windowsReservedNameProblem` 那份真身，不写第二份（铁律 6）。差别只有两处，都是导出特有：
 * ① 长度封 80（导出名不进书目录，但要防超长路径）；
 * ② 净化后为空或撞保留名时**不返回 null，退回 `FALLBACK_EXPORT_NAME`**：导出名只是保存
 *    对话框里的默认值，用户看得见也能改；让对话框拿到一个安全的默认名，比给一个 `CON.md`
 *    或空名要诚实（同 `sanitizeDocFileName`「拒绝而不是悄悄改名」那条——这里给的不是被改过的
 *    原名，而是一个中性默认名）。
 */
export function sanitizeFilename(name: string): string {
  const cleaned = Array.from(name.slice(0, 80).replace(/[/\\<>:|"*?]/g, "_"))
    .filter((ch) => ch.charCodeAt(0) > 0x1f)
    .join("")
    .replace(/[\s.]+$/g, "");
  if (cleaned === "") return FALLBACK_EXPORT_NAME;
  return windowsReservedNameProblem(cleaned) === null ? cleaned : FALLBACK_EXPORT_NAME;
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
