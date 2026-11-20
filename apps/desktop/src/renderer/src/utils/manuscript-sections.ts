import type { BookKind, DocRef } from "@mochen/contracts";
import type { IconName } from "../types/icons";
import { BOOK_KIND_LABELS, BOOK_KIND_ORDER } from "./book-kinds";
import { KIND_ICON } from "./kind-icons";

/**
 * 文稿树里的一组（一种 BookKind）。标签与图标都取自既有的两张表——
 * 组件只渲染，不自己抄第二份（铁律 6）。
 */
export interface ManuscriptSection {
  id: BookKind;
  label: string;
  icon: IconName;
  nodes: DocRef[];
}

/**
 * 常驻分组：开着书就在树上，哪怕这一组一篇文档都没有。
 *
 * 【为什么只有章节一组】章节是正文所在——新书的第一篇正文就是从这枚「+」建出来的。
 * 原先的过滤只放行「有文档的分组」与「正在行内新建的分组」，于是**空书时树里空无一物**：
 * 首次引导第 3 步教的那句「在左栏『章节』分组里点『+ 新建』」指向一枚根本不存在的钮，
 * 第一篇正文建不出来（要绕到中栏工作台空卡才碰得到那个放行判定）。
 *
 * 资料类分组（世界观 / 人物…）空着时仍然不露——十三组空标题挂在侧边栏上只是噪音，
 * 它们有别的入口（左栏「素材与台账」那一组）。
 */
const RESIDENT_SECTIONS: readonly BookKind[] = ["chapter"];

/**
 * 该露哪些分组的唯一判定（铁律 6：组件不自己再写一份 filter）。
 *
 * 放行三条：
 * ① 这一组有文档；
 * ② 正在这一组行内新建（空组也得有个落笔的地方，否则那枚「+」按下去没反应）；
 * ③ 常驻分组且已经开着书。
 */
export function manuscriptSections(
  docs: readonly DocRef[],
  addingKind: BookKind | null,
  hasBook: boolean
): ManuscriptSection[] {
  return BOOK_KIND_ORDER.map((kind) => ({
    id: kind,
    label: BOOK_KIND_LABELS[kind],
    icon: KIND_ICON[kind],
    nodes: docs.filter((doc) => doc.kind === kind)
  })).filter(
    (section) =>
      section.nodes.length > 0 ||
      addingKind === section.id ||
      (hasBook && RESIDENT_SECTIONS.includes(section.id))
  );
}
