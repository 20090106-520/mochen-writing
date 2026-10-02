import { describe, expect, it } from "vitest";
import { prefillText } from "./composer-draft";

/**
 * F-A 前置通路的唯一判定点：预填绝不吞掉用户已经在输入框里打的字。
 * 变异 W4 靶：把实现改成无条件 `return incoming;` ⇒ 第 1/2 条同时转红。
 */
describe("prefillText · 已有草稿时预填不吞字（F-A 前置）", () => {
  it("current 有内容 ⇒ 原样返回 current，incoming 一个字都不进", () => {
    expect(prefillText("我写了一半", "我想改这一章：先读它。")).toBe("我写了一半");
  });

  it("current 前后带空白也算有字 ⇒ 逐字节原样返回（不 trim、不替换）", () => {
    expect(prefillText("   草稿   ", "预填指令")).toBe("   草稿   ");
  });

  it("current 为空串 ⇒ 返回 incoming（预填真正落地）", () => {
    expect(prefillText("", "我想改这一章：先读它。")).toBe("我想改这一章：先读它。");
  });

  it("current 为纯空白 ⇒ 视作空，返回 incoming", () => {
    expect(prefillText("   \n\t ", "预填指令")).toBe("预填指令");
  });

  it("current 空、incoming 也空 ⇒ 返回空串而不是 undefined", () => {
    expect(prefillText("", "")).toBe("");
  });
});
