/// <reference types="node" />
/**
 * 查找高亮的 mirror 层与 textarea 必须**逐像素同宽**（2026-10-06 批次 5-㉑）。
 *
 * 为什么值得单独钉：`.find-replace-mirror` 是压在 textarea 底下、专门画高亮的那层，
 * 用户开着查找时 textarea 的字是透明的（`.document-editor--with-find { color: transparent }`），
 * 眼睛读的是 mirror 画的字，**可光标、选中框、滚动仍按 textarea 的排版走**。
 * 两层列宽只要差一格，断行点就分家——真机实测（两套夹具 × 10 个列宽档，抽查 320 处匹配）：
 * 改前 138 处错位（最多偏 2 行），改后 1 处。
 *
 * 差一格的来源不是谁写错了数值，而是**滚动条占位**：textarea overflow-y:auto，内容超一屏时
 * 经典滚动条吃掉全局那条 8px；mirror 原来是 overflow:hidden，永远不占。
 * 于是 mirror 照抄了 textarea 的全部排版声明，却还是宽 8px——约每行多塞一个字。
 *
 * 这里钉的是那几处**耦合决定**，不是整份 CSS 的长相：
 * ① mirror 的 overflow-y 必须是 auto（回退成 hidden 就是本批次修的那个缺陷）；
 * ② textarea 那条 auto 得同时还在（这一对拆开就没意义，只删一边也要红）；
 * ③ 折行规则逐项对齐 textarea 的计算值：word-break: normal + overflow-wrap: break-word；
 * ④ 两层的排版声明逐项相同（从两条规则里各解析出来比，不抄字面量）；
 * ⑤ 占位留着但画不出来——滚动条 thumb 得是透明的，否则凭空多一条看得见的滚动条。
 */
import { describe, expect, it } from "vitest";
import { ruleBlock, strippedStyleSource } from "../utils/vue-source-reader";

const CSS_FILE = "editor-pane.css";
const css = strippedStyleSource(CSS_FILE);

/**
 * textarea 的排版声明住在与浏览态共用的那条规则里（`.document-editor, .document-preview`）。
 * 取它的正文时按 `.document-preview` 找：选择器列表怎么折行是 prettier 的事，
 * 按其中一个成员去取就不会被换行方式绑住。
 */
const TA_BLOCK = ruleBlock(css, ".document-preview");
const MIRROR_BLOCK = ruleBlock(css, ".find-replace-mirror");

/** 解析一条规则的声明表（按 `;` 切、再取第一个 `:`，值里的 var() 逗号不受影响）。 */
function decls(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const chunk of block.split(";")) {
    const at = chunk.indexOf(":");
    if (at === -1) continue;
    const prop = chunk.slice(0, at).trim();
    if (prop === "" || prop.startsWith("--")) continue;
    out.set(
      prop,
      chunk
        .slice(at + 1)
        .replace(/\s+/g, " ")
        .trim()
    );
  }
  return out;
}

const taDecls = decls(TA_BLOCK);
const mirrorDecls = decls(MIRROR_BLOCK);

/** 影响「一行断在哪里」的那几项：两层必须逐字相同（自定义属性的兜底也相同，所以不用归一化）。 */
const SHARED_LAYOUT_PROPS = [
  "font-family",
  "font-size",
  "line-height",
  "letter-spacing",
  "padding"
];

describe("查找高亮 mirror · 与 textarea 同宽同折行（批次 5-㉑）", () => {
  it("mirror 的 overflow-y 是 auto —— 它要自己占出与 textarea 同宽的滚动条位", () => {
    expect(mirrorDecls.get("overflow-y")).toBe("auto");
    // 顺带钉住横向：不许改成 visible/auto，否则 mirror 的字会横向漏出去。
    expect(mirrorDecls.get("overflow-x")).toBe("hidden");
  });

  it("textarea 那条 overflow-y: auto 还在（这一对是耦合的，只删一边也要红）", () => {
    expect(taDecls.get("overflow-y")).toBe("auto");
    // 而且确实还是同一个元素：这条规则的选择器里得有 .document-editor。
    expect(css).toMatch(/\.document-editor\s*,\s*\.document-preview\s*\{/);
  });

  it("折行规则对齐 textarea 的计算值：word-break: normal + overflow-wrap: break-word", () => {
    // UA 给 textarea 的就是这一对；mirror 自己多写一条 break-word 只会让两层分家。
    expect(mirrorDecls.get("word-break")).toBe("normal");
    expect(mirrorDecls.get("overflow-wrap")).toBe("break-word");
    expect(mirrorDecls.get("white-space")).toBe("pre-wrap");
  });

  it("整份样式表里不许再出现 word-break: break-word（那正是会让两层分家的值）", () => {
    expect(css).not.toContain("word-break: break-word");
  });

  it("两层的排版声明逐项相同，且这几项在 mirror 上不许缺", () => {
    for (const prop of SHARED_LAYOUT_PROPS) {
      expect(mirrorDecls.has(prop), `mirror 规则里没有 ${prop}，两层排版就对不齐了`).toBe(true);
      expect(taDecls.has(prop), `textarea 规则里没有 ${prop}，比较基准没了`).toBe(true);
      expect(mirrorDecls.get(prop), `mirror 与 textarea 的 ${prop} 不一致`).toBe(taDecls.get(prop));
    }
  });

  it("滚动条占位留着但画不出来：thumb 透明（mirror 不接受指针，不该有第二条滚动条）", () => {
    const thumb = ruleBlock(css, ".find-replace-mirror::-webkit-scrollbar-thumb");
    expect(decls(thumb).get("background")).toBe("transparent");
  });

  it("mirror 仍靠 inset:0 贴着 wrap（不许改成自己定位，否则尺寸对不上）", () => {
    expect(mirrorDecls.get("position")).toBe("absolute");
    expect(mirrorDecls.get("inset")).toBe("0");
  });

  /**
   * 开着查找时 textarea 的字必须真的让位给 mirror —— 不让位就是**两层字叠着印**。
   *
   * 这是本批次真机截图撞出来的另一个缺陷，比列宽那 8px 严重得多：凡超一屏的稿子，
   * 查找面板一开整屏糊成乱码（两层的字都画在同一个盒子上，行又不重合）。
   * 病根是特异度：theme-runtime.css 那条主题兜底
   *   `html[data-theme] :where(…, .document-editor, …) { color: var(--text-primary) }`
   * 里 `:where()` 贡献 0 分，可外层 `html[data-theme]` 仍给到 (0,1,1)，
   * 压得住裸的 `.document-editor--with-find`（0,1,0）。加上 `.editor-textarea-wrap`
   * 前缀才是 (0,2,0)，压得住。
   */
  it("开着查找时 textarea 的字真的让位了（选择器要压得住主题兜底那条 (0,1,1)）", () => {
    expect(css).toMatch(/\.editor-textarea-wrap\s+\.document-editor--with-find\s*\{/);
    const block = ruleBlock(css, ".editor-textarea-wrap .document-editor--with-find");
    expect(decls(block).get("color")).toBe("transparent");
    // 光标要留下：字让位了，光标不让。
    expect(decls(block).get("caret-color")).toBe("var(--text-primary, #26292d)");
    // 裸类名那条不许留着——留着一份永远不生效的声明，下一个人会以为改它有用。
    expect(css).not.toMatch(/^\.document-editor--with-find\s*\{/m);
  });

  it("主题兜底里仍躺着 .document-editor（特异度冲突是真的，两边一起钉）", () => {
    // 若哪天有人把 .document-editor 从那条 :where() 里摘掉（编辑器自己的规则已经给了
    // --text-primary，这条对文稿区是冗余的），上面那条前缀就多余了——那时候连同这条一起改。
    expect(strippedStyleSource("theme-runtime.css")).toMatch(
      /:where\([^)]*\.document-editor[^)]*\)/s
    );
  });
});
