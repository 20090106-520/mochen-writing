import { describe, expect, it } from "vitest";
import { escapeHtml } from "../src/export-shared.js";

/**
 * `escapeHtml` 是**全仓唯一**的 HTML 转义真身（渲染层的高亮 mirror 与导出侧的 HTML/EPUB/print 都用它，
 * 见 `apps/desktop/src/renderer/src/utils/html-escape-single.test.ts` 的普查）。
 *
 * 正因为两边共用，这里的口径不能松：少转一个引号，导出页里 `<title>`、`<td>` 之类的属性拼接
 * 与渲染层将来把文本塞进带引号的属性时就是同一件事——一段手稿文本能闭合属性。
 * 这组用例是安全回归线，与 `export-service-markdown.test.ts` 同性质：红了按真实漏洞处理。
 */
describe("escapeHtml · 五个实体一个都不能少", () => {
  it("五个 HTML 特殊字符各自转成实体", () => {
    expect(escapeHtml("&")).toBe("&amp;");
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml(">")).toBe("&gt;");
    expect(escapeHtml('"')).toBe("&quot;");
    expect(escapeHtml("'")).toBe("&#39;");
  });

  it("& 必须先转：否则后面四条产出的实体自己会被二次转义", () => {
    // 顺序写反（先转 < 再转 &）时，"<" → "&lt;" → "&amp;lt;"，页面上就显示成字面的 &lt;。
    expect(escapeHtml('<a href="x">&</a>')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });

  it("已经是实体的文本按字面处理，不当实体放行", () => {
    expect(escapeHtml("&lt;script&gt;")).toBe("&amp;lt;script&amp;gt;");
  });

  it("普通中文与换行原样保留（mirror 靠它跟 textarea 逐字对齐）", () => {
    expect(escapeHtml("第一章 海雾\n第二行")).toBe("第一章 海雾\n第二行");
  });

  it("空串原样出：调用方拼字符串时不必再判空", () => {
    expect(escapeHtml("")).toBe("");
  });
});
