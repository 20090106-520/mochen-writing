import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { REVIEW_TOOLS } from "./review-tools";

/**
 * 「审稿」下拉的清单（P0-5）。
 *
 * 五项就是原来平铺在右栏的五枚检查按钮；这份清单是入口的唯一真身，
 * 掉一项、撞一个 id、挂一个不存在的图标名，界面都会静默少一枚或者渲染成空白。
 */
const iconsSource = readFileSync(
  fileURLToPath(new URL("../types/icons.ts", import.meta.url)),
  "utf8"
);

describe("REVIEW_TOOLS", () => {
  it("五项齐全、顺序不变：平铺时代一个入口都没丢", () => {
    expect(REVIEW_TOOLS.map((tool) => tool.id)).toEqual([
      "slop",
      "review",
      "timeline",
      "cast",
      "foreshadow"
    ]);
  });

  it("id 与文案都不重复：读屏念出来的每一行都分得开", () => {
    expect(new Set(REVIEW_TOOLS.map((tool) => tool.id)).size).toBe(REVIEW_TOOLS.length);
    expect(new Set(REVIEW_TOOLS.map((tool) => tool.label)).size).toBe(REVIEW_TOOLS.length);
    expect(new Set(REVIEW_TOOLS.map((tool) => tool.hint)).size).toBe(REVIEW_TOOLS.length);
    for (const tool of REVIEW_TOOLS) {
      expect(tool.label.trim().length).toBeGreaterThan(0);
      // 悬停那句要说清它查什么，不是「打开面板」这种没有信息的话。
      expect(tool.hint.length).toBeGreaterThan(6);
    }
  });

  it("图标名都真实存在（挂一个不存在的名字会静默渲染成空白）", () => {
    for (const tool of REVIEW_TOOLS) {
      expect(iconsSource, `${tool.id} 的图标 ${tool.icon} 不在 IconName 里`).toContain(
        `| "${tool.icon}"`
      );
    }
  });
});
