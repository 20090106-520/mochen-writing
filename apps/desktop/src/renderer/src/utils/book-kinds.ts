import type { BookKind } from "@mochen/contracts";

/** 分组的固定展示顺序（左栏与「作品资料」共用同一条序列，不留两份）。 */
export const BOOK_KIND_ORDER: BookKind[] = ["chapter", "outline", "character", "plot", "material"];

/** BookKind 的中文标签唯一来源（铁律 6：Record<联合类型, string>，加一类不写标签编译不过）。 */
export const BOOK_KIND_LABELS: Record<BookKind, string> = {
  chapter: "章节",
  outline: "大纲",
  character: "人物",
  plot: "剧情",
  material: "素材库"
};
