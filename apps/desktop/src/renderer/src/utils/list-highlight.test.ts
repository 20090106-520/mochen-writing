import { describe, expect, it } from "vitest";
import { clampHighlightIndex, moveHighlightIndex } from "./list-highlight";

/**
 * 这一族浮层（模型选择器 / 权限档 / 阶段选择 / 设置页的模型名单 / @ 引用菜单）
 * 共用的高亮判据。两条性质缺一不可：
 * ① 上下键**回绕**（在第一项按 ↑ 落到最后一项——手不用离开键盘）；
 * ② 列表变短时高亮**夹住**（不能指着一条已经不存在的项，那会让 Enter 切到一个看不见的模型）。
 */
describe("list-highlight · 上下键环绕", () => {
  it("往下走到头回到第一项", () => {
    expect(moveHighlightIndex(2, 1, 3)).toBe(0);
  });

  it("往回走到头落到最后一项", () => {
    expect(moveHighlightIndex(0, -1, 3)).toBe(2);
  });

  it("中间照常走", () => {
    expect(moveHighlightIndex(1, 1, 3)).toBe(2);
  });

  it("列表是空的 ⇒ 落在 0（不许算出 NaN 或负下标）", () => {
    expect(moveHighlightIndex(0, 1, 0)).toBe(0);
    expect(moveHighlightIndex(4, -1, 0)).toBe(0);
  });

  it("总数为负也当空处理", () => {
    expect(moveHighlightIndex(0, 1, -1)).toBe(0);
  });
});

describe("list-highlight · 夹住下标", () => {
  it("下标越界夹到边界", () => {
    expect(clampHighlightIndex(9, 0)).toBe(0);
    expect(clampHighlightIndex(9, 4)).toBe(3);
    expect(clampHighlightIndex(-2, 4)).toBe(0);
    expect(clampHighlightIndex(2, 4)).toBe(2);
  });

  it("列表空 ⇒ 0", () => {
    expect(clampHighlightIndex(3, 0)).toBe(0);
  });
});
