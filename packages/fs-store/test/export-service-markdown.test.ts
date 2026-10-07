import { describe, expect, it } from "vitest";
import { markdownToSimpleHtml } from "../src/export-service.js";

/**
 * markdownToSimpleHtml 的输出被 DocumentPane 用 v-html 注入渲染进程
 * （`v-html="previewHtml"`）。渲染进程带 preload、拿得到 window.mochen 的读写通路，
 * 所以这里一旦漏出裸标签，就等于让「书目录里的一份 .md」在渲染进程里执行脚本。
 *
 * 这组用例是安全回归线，不许改松：任何一条红了都按真实漏洞处理，不要改成 toContain 糊过去。
 */
describe("markdownToSimpleHtml · 裸 HTML 必须被转义", () => {
  it("行内的 <script> 不能原样进 HTML", () => {
    const html = markdownToSimpleHtml("正文一句。 <script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("独占一行的裸标签（原段落规则的负向先行断言会放它过去）不能原样进 HTML", () => {
    // 旧实现的段落正则是 /^(?!<[a-z/]|```|$)(.+)$/gm：行首是 < + 小写字母时**不**包 <p>，
    // 于是这一行原封不动地留在输出里。必须被转义成文本。
    const html = markdownToSimpleHtml("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("裸 HTML 里的引号与 & 也不能留着", () => {
    const html = markdownToSimpleHtml(`<a href="javascript:alert(1)">点我 & 走</a>`);
    expect(html).not.toContain("<a ");
    expect(html).not.toContain('"javascript:');
  });

  it("我们自己生成的标签不受影响（转义不能把 <h1>/<strong> 也吃掉）", () => {
    const html = markdownToSimpleHtml("# 标题\n\n**加粗**与*斜体*\n\n- 一条\n");
    expect(html).toContain("<h1>标题</h1>");
    expect(html).toContain("<strong>加粗</strong>");
    expect(html).toContain("<em>斜体</em>");
    expect(html).toContain("<ul>");
  });

  it("代码块里的尖括号是文本，不是标签", () => {
    const html = markdownToSimpleHtml("```ts\nconst a = b < c && d > e;\n```\n");
    expect(html).toContain("<pre><code>");
    expect(html).toContain("&lt;");
    expect(html).not.toMatch(/<code>[^<]*<[a-z]/i);
  });
});
