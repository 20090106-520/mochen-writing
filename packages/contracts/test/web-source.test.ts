import { describe, expect, it } from "vitest";
import { sourceKey } from "../src/web-source.js";

/**
 * 来源键的判据（批次 5-⑩）。
 *
 * 这条函数同时决定「回执里给模型的编号」与「工具卡上显示的标签」，两边共用同一份实现。
 * 它最要紧的性质只有一条：**同一个链接永远得到同一个键，且与它在列表里的位置无关**——
 * 有了这条，一轮里搜好几次也不会出现两个「[2]」互相指代；少了这条，改动不报错、
 * 界面也不报错，只是模型引用的东西悄悄对不上了。
 */
describe("来源键", () => {
  it("同一个链接两次算出的键一模一样（与顺序、与调用次数都无关）", () => {
    const url = "https://baike.baidu.com/item/darkforest";
    expect(sourceKey(url)).toBe(sourceKey(url));
    // 末尾斜杠与 www. 前缀是同一个页面的两种写法，键认不出来就会误判成两条来源。
    expect(sourceKey("https://www.baike.baidu.com/item/darkforest/")).toBe(sourceKey(url));
  });

  it("不同链接必得不同的键，哪怕它们同路径不同参数", () => {
    const a = sourceKey("https://www.so.com/link?m=abc");
    const b = sourceKey("https://www.so.com/link?m=xyz");
    // 360 递的绝大多数是这种不透明跳转链，光看路径全都长一个样——只有指纹能把它们分开。
    expect(a).not.toBe(b);
    expect(a).toBe("so.com/link-" + a.split("-").at(-1));
    expect(a).toContain("so.com/link-");
  });

  it("形态是「域名/路径末段-四位指纹」，www. 与中段目录都被去掉", () => {
    expect(sourceKey("https://www.zhihu.com/question/123/answer/456")).toMatch(
      /^zhihu\.com\/456-[0-9a-f]{4}$/
    );
    // 中段目录对用户辨认来源没用，留在键里只会把标签撑长。
    expect(sourceKey("https://www.zhihu.com/question/123/answer/456")).toBe(
      sourceKey("https://zhihu.com/question/123/answer/456")
    );
  });

  it("百分号编码的中文路径解开来再进键（解不开就原样留着，不为一个标签丢掉整条结果）", () => {
    expect(sourceKey("https://example.com/%E6%96%87%E7%AB%A0")).toBe(
      sourceKey("https://example.com/文章")
    );
    // %E6%96 是个截断的三字节序列（合法的 %E6%96%87 才是「文」）——这种才真的解不开。
    const broken = sourceKey("https://example.com/%E6%96");
    expect(broken).toContain("example.com/%E6%96-");
    expect(broken).not.toContain("undefined");
  });

  it("没有路径的地址给键而不是空串", () => {
    expect(sourceKey("https://example.com")).toMatch(/^example\.com-[0-9a-f]{4}$/);
    expect(sourceKey("https://example.com/")).toBe(sourceKey("https://example.com"));
  });

  it("解不开的地址也给键：标签难看不该让一条真结果从清单里消失", () => {
    for (const bad of ["", "not a url", "//example.com/x", "javascript:alert(1)"]) {
      const key = sourceKey(bad);
      expect(key).toMatch(/^[^-]+-[0-9a-f]{4}$/);
      expect(key).not.toContain("undefined");
    }
    expect(sourceKey("")).not.toBe(sourceKey("not a url"));
  });

  it("键有长度上限，超长路径截断但指纹仍跟着（截断的两条不同链接不会撞）", () => {
    const long = `https://example.com/${"a".repeat(120)}`;
    const other = `https://example.com/${"a".repeat(120)}b`;
    const key = sourceKey(long);
    expect(key.length).toBeLessThanOrEqual(48);
    expect(key).toContain("…");
    expect(key).not.toBe(sourceKey(other));
  });
});
