import { describe, expect, it } from "vitest";
import { MARKET_CATEGORIES } from "@mochen/contracts";
import {
  SKILL_CATEGORY_FALLBACK_ICON,
  SKILL_CATEGORY_ICONS,
  SKILL_LIBRARY_CATEGORY_LABEL,
  skillCategoryIcon
} from "./skill-category-icon";
import { templateSource } from "./vue-source-reader";

describe("技能卡分类图标：六枚互不相同", () => {
  it("市场那五个分类一个不落，盘上那一档也在", () => {
    // 市场分类表改了而这里没跟上，卡片就会悄悄退回书册——所以逐个钉住。
    for (const category of MARKET_CATEGORIES) {
      expect(SKILL_CATEGORY_ICONS, `缺 ${category}`).toHaveProperty(category);
    }
    expect(SKILL_CATEGORY_ICONS).toHaveProperty(SKILL_LIBRARY_CATEGORY_LABEL);
  });

  it("六枚图标两两不同——两档画同一枚等于没分", () => {
    const icons = Object.values(SKILL_CATEGORY_ICONS);
    expect(icons).toHaveLength(MARKET_CATEGORIES.length + 1);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it("「全部」「已安装」不是分类，落兜底那一枚", () => {
    expect(skillCategoryIcon("全部")).toBe(SKILL_CATEGORY_FALLBACK_ICON);
    expect(skillCategoryIcon("已安装")).toBe(SKILL_CATEGORY_FALLBACK_ICON);
    expect(skillCategoryIcon("")).toBe(SKILL_CATEGORY_FALLBACK_ICON);
  });

  it("查表按屏幕上的中文标签走，不做二次映射", () => {
    for (const category of MARKET_CATEGORIES) {
      expect(skillCategoryIcon(category)).toBe(SKILL_CATEGORY_ICONS[category]);
    }
  });

  it("卡片上的图标真读这一份：不许模板里写死一枚 name", () => {
    const page = templateSource("components/ExtensionsPage.vue");
    expect(page).toContain("skillCategoryIcon(row.categoryLabel)");
  });
});
