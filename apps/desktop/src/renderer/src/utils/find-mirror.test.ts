/**
 * 找/替换高亮层（mirror）的 HTML 生成（2026-10-10 行数预算尾巴，从 DocumentPane 的 computed 抽出）。
 *
 * 为什么单独一处：这层是**贴在 textarea 背后**的那一份文本，位置由
 * `useFindReplaceStore.highlightPositions` 在 `book.draft` 上算出来，因此切分只能也在同一段
 * 字符串上做——一旦两处用的文本不同，高亮就会整体错位（差一个字都看得见）。
 * 抽成纯函数后它零 DOM、零副作用，五条规矩都能钉在这里；组件那边只剩「该不该摆这一层」。
 *
 * 转义走 `@mochen/fs-store/export-shared` 那一份（同时转 `& < > " '`）。这里原先自抄过一份
 * 只转 `& < >` 的——少转引号在这个位置不出事，但两份并存会让下一个人照抄渲染层那份、
 * 把文本往带引号的属性里塞，那就是一条真 XSS。普查与回归线：`utils/html-escape-single.test.ts`。
 */
import { describe, expect, it } from "vitest";
import { findMirrorHtml, type MirrorPosition } from "./find-mirror";

const pos = (start: number, end: number): MirrorPosition => ({ start, end });

describe("findMirrorHtml", () => {
  it("没有匹配位置：整段照原样转义摆出来，不许返回空串（否则编辑区看着像空白）", () => {
    expect(findMirrorHtml("潮信来了\n", [], -1)).toBe("潮信来了\n");
  });

  it("有匹配：普通段与匹配段交替，匹配段包进 mark，尾巴那段不许丢", () => {
    const text = "xa y";
    // 匹配 "a"（1..2），后面还剩 " y"
    expect(findMirrorHtml(text, [pos(1, 2)], -1)).toBe(`x<mark class="find-highlight">a</mark> y`);
  });

  it("当前那一条用 find-highlight-current，其余用 find-highlight", () => {
    const text = "aa";
    const html = findMirrorHtml(text, [pos(0, 1), pos(1, 2)], 1);
    expect(html).toBe(
      `<mark class="find-highlight">a</mark><mark class="find-highlight-current">a</mark>`
    );
  });

  it("currentIndex 为 -1（还没走到当前条）：不许把某一段误标成当前", () => {
    const html = findMirrorHtml("ab", [pos(0, 1), pos(1, 2)], -1);
    expect(html).not.toContain("find-highlight-current");
    expect(html.match(/<mark /g)).toHaveLength(2);
  });

  it("匹配段里的尖括号与引号一律转义：高亮层是 v-html，不转就是给自己埋 XSS", () => {
    const text = 'say "<b>"';
    const start = text.indexOf('"<b>"');
    const html = findMirrorHtml(text, [pos(start, text.length)], 0);
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("&quot;");
    expect(html).not.toContain("<b>");
  });

  it("位置落在文本之外（盘上内容与位置短暂不一致）：不崩、也不凭空多出字符", () => {
    const text = "ab";
    // end 越过文本长度：slice 自己收口，产出仍是原文的可见字符
    expect(findMirrorHtml(text, [pos(0, 99)], -1)).toBe(`<mark class="find-highlight">ab</mark>`);
  });
});
