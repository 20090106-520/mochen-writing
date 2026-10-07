/**
 * 导出的跨层契约（2026-10-05，批次 5-②）。
 *
 * **为什么从 fs-store 收到 contracts**：`RendererApi.buildExport` 的入参与返回值要在
 * contracts 里声明（preload 只做 `payload as RendererApi` 的字面转换，不校验形状），
 * 而 contracts 不能反向依赖 fs-store。导出是**跨层契约**，就该住 contracts——
 * 和 `ChangeEntry`、`ProviderView` 同一类东西。
 *
 * **纯函数（估大小、算文件名、markdown→html）不在这里**：它们是实现，不跨进程。
 * 住 `fs-store/export-shared`，渲染层直接引那个零依赖的子路径。
 */
import type { BookKind } from "./book.js";

export type ExportFormat = "markdown" | "plaintext" | "html" | "print" | "docx" | "json" | "epub";

export interface ExportableDoc {
  relPath: string;
  kind: BookKind;
  title: string;
  content: string;
}

export interface ExportOptions {
  format: ExportFormat;
  /** 是否包含 frontmatter */
  includeFrontmatter: boolean;
  /** 是否在章节间加分隔线 */
  separatorBetweenChapters: boolean;
  /** 是否在开头加元信息 */
  includeMeta: boolean;
  /** 要导出的 relPath 列表（空 = 全部章节） */
  docRelPaths: string[];
  /** 是否包含页码（仅 print 格式） */
  includePageNumbers: boolean;
}

export interface ExportResult {
  /**
   * 文本格式走这里。**EPUB 走 `bytes`**——它是个 zip 包，按 utf-8 写盘就是一堆乱码。
   * 二选一而不是把 content 改成联合类型：那会让每处调用方都得分叉，
   * 而其余五种格式的通路一个字都不该被 EPUB 改到。
   */
  content: string;
  /** 二进制产物（目前只有 EPUB）；文本格式为 null。`bytes === null && format === "epub"` = 零章，导不出。 */
  bytes: Uint8Array | null;
  format: ExportFormat;
  filename: string;
  byteSize: number;
}

/** 默认选项（主进程 `buildExportContent` 合并用；渲染层不持有它）。 */
export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  format: "markdown",
  includeFrontmatter: false,
  separatorBetweenChapters: true,
  includeMeta: true,
  docRelPaths: [],
  includePageNumbers: false
};
