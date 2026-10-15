import { describe, expect, it } from "vitest";
import { escapeRegExpLiteral, literalPattern, replaceLiteral } from "../src/text-replace.js";

describe("字面替换（2026-10-15 全书替换的判定真身）", () => {
  it("转义让元字符按字面看：找「1.5」不会连「1x5」一起命中", () => {
    const hit = replaceLiteral("1.5 米 与 1x5 米", "1.5", "两米");
    expect(hit.count).toBe(1);
    expect(hit.text).toBe("两米 米 与 1x5 米");
    expect(escapeRegExpLiteral("a+b*c(d)")).toBe("a\\+b\\*c\\(d\\)");
  });

  it("默认不分大小写；开了 caseSensitive 就只认大写/小写那一档", () => {
    expect(replaceLiteral("Alice alice", "alice", "Bob").count).toBe(2);
    expect(replaceLiteral("Alice alice", "alice", "Bob", { caseSensitive: true }).count).toBe(1);
  });

  it("替换串里的 $ 一律当字面：不做组引用（全书替换没有捕获组这个入口）", () => {
    const hit = replaceLiteral("价格 100 元", "100", "$1 与 $&");
    expect(hit.text).toBe("价格 $1 与 $& 元");
  });

  it("整词开关把模式串括起来（与查找面板同一份口径）", () => {
    expect(literalPattern("cat", { wholeWord: true })).toBe("\\bcat\\b");
    expect(replaceLiteral("cat concat", "cat", "dog", { wholeWord: true })).toEqual({
      text: "dog concat",
      count: 1
    });
  });

  it("空查询不换任何东西：空模式会匹配每一处间隙，那是切碎不是替换", () => {
    expect(replaceLiteral("小明来了", "", "X")).toEqual({ text: "小明来了", count: 0 });
  });

  it("count 报的是**真换掉的处数**：同一处不会被数两遍（它给界面如实报数用）", () => {
    expect(replaceLiteral("啊啊啊", "啊", "").count).toBe(3);
    expect(replaceLiteral("没有这一处", "啊", "呃").count).toBe(0);
  });
});
