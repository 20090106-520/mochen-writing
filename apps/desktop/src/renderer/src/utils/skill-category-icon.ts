/**
 * 技能卡左上那一枚图标 —— 按分类给，而不是每张卡都画同一枚（2026-11-12）。
 *
 * 【病灶】真机上 31 张技能卡，每张左上都是一枚一模一样的书册图标（`library`）。
 * 31 次重复：它没有告诉我们任何一件事。而同一张卡底部的「结构」「文风」那枚文字标签
 * 才是真分类——分类信息在，只是被塞在卡片最下面一行，扫视时最先看到的位置
 * （左上）反而给了一个零信息的色块。
 *
 * 【裁定】左上那枚图标改画分类：构思 / 结构 / 文风 / 校对 / 资料 / 技能库 六枚互不相同。
 * 于是「一眼扫过去，哪种活多」变成看得见的事，而不必逐张读底部的标签。
 *
 * 键取的是 contracts 的 `MarketCategory` 加上盘上那一档 `技能库`：
 * **加了新分类而这里没跟上，是编译期错误**，不是「新分类悄悄画成书册」。
 * 「全部」「已安装」不是分类（它们筛的是状态与范围），落进兜底那一枚。
 */
import type { MarketCategory } from "@mochen/contracts";
import type { IconName } from "../types/icons";

/** 盘上但市场清单里没有的技能，分类标签就叫「技能库」（与 stores 的 SKILL_LIBRARY_CATEGORY 同字）。 */
export const SKILL_LIBRARY_CATEGORY_LABEL = "技能库";

export const SKILL_CATEGORY_ICONS: Record<MarketCategory | "技能库", IconName> = {
  构思: "sparkles",
  结构: "map",
  文风: "pen",
  校对: "check",
  资料: "archive",
  技能库: "library"
};

/** 兜底那一枚：分类不认识时（「全部」「已安装」、或将来多出来的档）画书册。 */
export const SKILL_CATEGORY_FALLBACK_ICON: IconName = "library";

/**
 * 分类标签 → 图标名。入参是**屏幕上那个标签字符串**（`row.categoryLabel`），
 * 不是枚举：卡片那一格拿到的就是中文标签，再倒推一遍枚举等于多一份映射要同步。
 */
export function skillCategoryIcon(label: string): IconName {
  return Object.prototype.hasOwnProperty.call(SKILL_CATEGORY_ICONS, label)
    ? SKILL_CATEGORY_ICONS[label as keyof typeof SKILL_CATEGORY_ICONS]
    : SKILL_CATEGORY_FALLBACK_ICON;
}
