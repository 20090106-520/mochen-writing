import type { BookKind } from "@mochen/contracts";

/** 分组的固定展示顺序（左栏与「作品资料」共用同一条序列，不留两份）。 */
export const BOOK_KIND_ORDER: BookKind[] = [
  "chapter",
  "volume",
  "outline",
  "worldview",
  "character",
  "faction",
  "location",
  "timeline",
  "plot",
  "material",
  "glossary",
  "foreshadow",
  "skill"
];

/** BookKind 的中文标签唯一来源（铁律 6：Record<联合类型, string>，加一类不写标签编译不过）。 */
export const BOOK_KIND_LABELS: Record<BookKind, string> = {
  chapter: "章节",
  outline: "大纲",
  character: "人物",
  plot: "剧情",
  material: "素材库",
  worldview: "世界观",
  faction: "势力/组织",
  location: "地图",
  timeline: "时间线",
  glossary: "专有名词",
  volume: "分卷",
  foreshadow: "伏笔",
  skill: "技能库"
};
