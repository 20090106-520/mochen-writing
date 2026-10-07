import type { BookKind } from "@mochen/contracts";

/** 带全文内容的文档（搜索/导出/统计层的轻量视图，不重复 DocRef 的元字段） */
export interface BookDoc {
  relPath: string;
  kind: BookKind;
  title: string;
  content: string;
}
