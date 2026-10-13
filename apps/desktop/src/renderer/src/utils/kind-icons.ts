import type { BookKind } from "@mochen/contracts";
import type { IconName } from "../types/icons";

/**
 * BookKind → 树分组图标（2026-10-10 从 LeftSidebar 下沉成纯表）。
 * 图标是渲染资产不是业务枚举（设计决定 6）：标签/顺序仍来自 utils/book-kinds 唯一表，
 * 这张表只管「每一类在树上画哪个图标」——它不进 contracts，也不进业务判定。
 * 下沉的理由：左栏贴着 800 行预算；纯数据表下沉后可被 icons-coverage 一并钉住。
 */
export const KIND_ICON: Record<BookKind, IconName> = {
  chapter: "book",
  outline: "list",
  character: "user",
  plot: "ledger",
  material: "library",
  worldview: "globe",
  faction: "directory",
  location: "map",
  timeline: "history",
  glossary: "library",
  volume: "archive",
  foreshadow: "pin",
  skill: "wand"
};
