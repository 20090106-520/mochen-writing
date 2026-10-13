/**
 * 共享 markdown 渲染器：有序列表那条（2026-10-10 补）。
 *
 * 原实现只产 `<li>` 不包 `<ol>`。浏览器对「不在列表容器里的 li」不画编号，
 * 于是 **1. 2. 3. 整个消失**——列表行还在，序号没了。
 * 对话区最先撞上它（模型爱写编号清单），导出也会跟着受益。
 *
 * 这里补的是**反向钉**：正向断言「有 `<ol>`」很容易写成只检查某一行的输出，
 * 而这条真正要防的是「有人后来把 <ol> 那行删了、看起来还很正常」。
 */
import { describe, expect, it } from "vitest";
import { markdownToSimpleHtml } from "../src/export-shared.js";

const OL_LIST = "1. 第一项\n2. 第二项\n3. 第三项";
const UL_LIST = "- 甲\n- 乙";

describe("markdownToSimpleHtml · 有序列表", () => {
  it("包进 <ol>：编号要画出来就必须在列表容器里", () => {
    const html = markdownToSimpleHtml(OL_LIST);
    expect(html).toContain("<ol>");
    expect(html).toContain("</ol>");
    expect(html).toContain("<li>第一项</li>");
  });

  it("**反向钉**：输出里不许有落在 <ol> 之外的 <li>", () => {
    const html = markdownToSimpleHtml(OL_LIST);
    const insideOl = /<ol>[\s\S]*?<\/ol>/.exec(html)?.[0] ?? "";
    const allLi = (html.match(/<li>/g) ?? []).length;
    const insideLi = (insideOl.match(/<li>/g) ?? []).length;
    expect(allLi).toBe(3);
    expect(insideLi).toBe(allLi);
  });

  it("有序仍是无序仍各归各：<ul> 不许把 <ol> 的行吞进去，反之亦然", () => {
    const ol = markdownToSimpleHtml(OL_LIST);
    expect(ol).not.toContain("<ul>");
    const ul = markdownToSimpleHtml(UL_LIST);
    expect(ul).toContain("<ul>");
    expect(ul).not.toContain("<ol>");
  });

  it("两种列表挨在一起时各自包各自的", () => {
    const html = markdownToSimpleHtml(`${UL_LIST}\n${OL_LIST}`);
    expect(html).toContain("<ul>");
    expect(html).toContain("<ol>");
    // ul 段在前、ol 段在后。
    expect(html.indexOf("<ul>")).toBeLessThan(html.indexOf("<ol>"));
  });

  it("有序的行首编号不进正文（「1.」这个符号本身要被吃掉）", () => {
    const html = markdownToSimpleHtml(OL_LIST);
    expect(html).not.toContain("1. 第一项");
    expect(html).not.toContain("2. 第二项");
  });
});

describe("markdownToSimpleHtml · 先转义这道线不许松", () => {
  // 渲染层的 v-html 会把这段输出注入 DOM。顺序反了就是实打实的 XSS，
  // 而回归线不在这份渲染器上（见 export-service-markdown.test.ts）。
  it("裸 HTML 被转义，进不到输出里", () => {
    const html = markdownToSimpleHtml('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("markdown 与裸 HTML 混排时同样安全", () => {
    const html = markdownToSimpleHtml("**粗** <script>alert(1)</script>");
    expect(html).toContain("<strong>粗</strong>");
    expect(html).not.toContain("<script>");
  });
});
