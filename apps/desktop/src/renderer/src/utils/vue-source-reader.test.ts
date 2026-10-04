/**
 * 读取器自己的钉（#113d 的 M12 教出来的）：`ruleBlock` 的正文必须去掉首尾空白。
 * 存在的理由不是风格：`expect(ruleBlock(…)).not.toBe("")` 这类「规则不许是空壳」的反向断言，
 * 在未 trim 的版本上挡不住 `selector {\n}`——正文是换行不是空串，空壳照样绿。
 * 十条源码契约测试都从这个口子读样式，所以关门口修在读取器里，不在每个调用点补 `.trim()`（铁律 6）。
 */
import { describe, expect, it } from "vitest";
import { ruleBlock } from "./vue-source-reader";

describe("vue-source-reader · ruleBlock", () => {
  it("正文首尾空白已剥：空壳规则读出来就是空串", () => {
    expect(ruleBlock(".x {\n}", ".x")).toBe("");
    expect(ruleBlock(".x {\n  \n}", ".x")).toBe("");
  });

  it("有正文时只剥首尾，中间的声明与换行原样保留", () => {
    const body = ruleBlock(".x {\n  color: red;\n  gap: 6px;\n}", ".x");
    expect(body).toBe("color: red;\n  gap: 6px;");
  });

  it("规则不存在一律抛错：静默返回空串会让整批断言假绿", () => {
    expect(() => ruleBlock(".other { color: red; }", ".x")).toThrow(/找不到规则/);
  });
});
