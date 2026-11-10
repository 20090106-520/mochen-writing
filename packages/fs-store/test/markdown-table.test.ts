/**
 * 共享 markdown 渲染器：表格那条（2026-11-10 补）。
 *
 * 原实现**完全不认表格**。模型摆「两版对比、人物对照」时最常用的就是这个排法，
 * 于是整块原样躺在屏上——一排竖线夹着 `---`，读起来跟代码块没区别。
 * 用户报「输出的东西不要代码」，有一部分其实是表格没渲染。
 *
 * 这里的用例分两类：一类钉「该渲染的渲染出来」，一类钉「拿不准的一律放过」——
 * 后者更重要：猜错会把正文拆成表格，比不渲染更糟。
 */
import { describe, expect, it } from "vitest";
import { markdownToSimpleHtml } from "../src/export-shared.js";

describe("markdownToSimpleHtml · 表格", () => {
  it("标准两列：表头进 thead/th，其余行进 tbody/td", () => {
    const html = markdownToSimpleHtml(
      ["| 方案 | 代价 |", "| --- | --- |", "| 换开头 | 重写三章 |", "| 留开头 | 节奏偏慢 |"].join(
        "\n"
      )
    );
    expect(html).toContain("<table>");
    expect(html).toContain("<thead><tr><th>方案</th><th>代价</th></tr></thead>");
    expect(html).toContain("<tbody>");
    expect(html).toContain("<tr><td>换开头</td><td>重写三章</td></tr>");
    expect(html).toContain("<tr><td>留开头</td><td>节奏偏慢</td></tr>");
    // 竖线和分隔行不能留在屏上——那正是用户看到的那堆符号。
    expect(html).not.toContain("---");
    expect(html).not.toContain("| 方案");
  });

  it("对齐标记（:---:）不影响渲染（对齐信息刻意不保留）", () => {
    const html = markdownToSimpleHtml(["| 甲 | 乙 |", "| :-- | --: |", "| 1 | 2 |"].join("\n"));
    expect(html).toContain("<th>甲</th>");
    expect(html).toContain("<td>1</td>");
    expect(html).not.toContain(":--");
  });

  it("只有表头没有数据行 ⇒ 也出表格（只有 thead，不硬塞空 tbody）", () => {
    const html = markdownToSimpleHtml(["| 人物 | 关系 |", "| --- | --- |"].join("\n"));
    expect(html).toContain("<thead>");
    expect(html).not.toContain("<tbody>");
  });

  it("第二行不是分隔行 ⇒ 原样放过（不猜，宁可朴素）", () => {
    const source = ["| 这不是表格 |", "| 只是两行竖线 |"].join("\n");
    const html = markdownToSimpleHtml(source);
    expect(html).not.toContain("<table>");
    expect(html).toContain("| 这不是表格 |");
  });

  it("表格前后有普通段落 ⇒ 段落仍然是段落", () => {
    const html = markdownToSimpleHtml(
      ["先说结论。", "", "| 甲 | 乙 |", "| --- | --- |", "| 1 | 2 |", "", "就这些。"].join("\n")
    );
    expect(html).toContain("<p>先说结论。</p>");
    expect(html).toContain("</table>");
    expect(html).toContain("<p>就这些。</p>");
  });

  it("单元格里的裸标签照样被转义（表格不能成为 XSS 的新入口）", () => {
    const html = markdownToSimpleHtml(
      ["| 名字 |", "| --- |", "| <img src=x onerror=alert(1)> |"].join("\n")
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("单元格里的强调先按行内规则处理，进 td 的是标签不是符号", () => {
    const html = markdownToSimpleHtml(["| 甲 |", "| --- |", "| **重点** |"].join("\n"));
    expect(html).toContain("<td><strong>重点</strong></td>");
  });
});
