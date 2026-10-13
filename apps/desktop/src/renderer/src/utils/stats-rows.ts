import { BOOK_KIND_LABELS, BOOK_KIND_ORDER } from "./book-kinds";
import type { DocRef } from "@mochen/contracts";

/**
 * 数据统计对话框的行数据（2026-10-10 从 LeftSidebar 下沉成纯函数）。
 * 数字全部来自 book.docs 的扫描元数据：篇数现成、字数按 DocRef.chars（非空白字符）。
 * 下沉的理由：左栏贴着 800 行预算，而这段聚合本就该可单测——合计口径以这里为准。
 */

/** 对话框里的一行：分组名 + 篇数 + 字数（SideNavNoticeDialog 展示，类型住这一份）。 */
export interface SideNavStatsRow {
  label: string;
  count: number;
  chars: number;
}

export function statsRowsOf(docs: readonly DocRef[]): SideNavStatsRow[] {
  return BOOK_KIND_ORDER.map((kind) => {
    const of = docs.filter((doc) => doc.kind === kind);
    return {
      label: BOOK_KIND_LABELS[kind],
      count: of.length,
      chars: of.reduce((sum, doc) => sum + (doc.chars ?? 0), 0)
    };
  });
}
