import { describe, expect, it } from "vitest";
import { codePointLength, normalizeNewlines, proseCharCount } from "../src/text.js";
import { FRONTMATTER_FENCE, splitFrontmatter } from "../src/frontmatter.js";

/** 源文件里不写裸 BOM 字符（它在编辑器里完全不可见），按码点显式造。 */
const BOM = String.fromCharCode(0xfeff);

/**
 * 「正文有多少字」这一条口径的唯一实现点。
 * 为什么住在 contracts：`fs-store` 扫描时要按它算 `DocRef.chars`，渲染层页脚要按它算「正文 N 字」，
 * 两边各数一遍就会出现「同一篇稿子，书卡 148 字、页脚 181 字」——本仓禁的就是这个。
 */
describe("codePointLength（唯一码点口径）", () => {
  it("一个 emoji 是一个字，不是两个 UTF-16 码元", () => {
    expect(codePointLength("🐋海雾")).toBe(3);
  });

  it("空串是 0 字，不是 null", () => {
    expect(codePointLength("")).toBe(0);
  });

  it("代理对逐个数：十个 emoji 就是十字", () => {
    expect(codePointLength("🐋".repeat(10))).toBe(10);
  });
});

/**
 * 「N 字」的唯一口径：非空白码点。页脚字数、页脚时长、书卡总字数三格都读它，
 * 所以这里的用例同时是那三格的账（变异靶：把 `ch.trim()` 去掉 ⇒ 换行与缩进开始算字）。
 */
describe("proseCharCount（字数唯一口径）", () => {
  it("换行、空格、全角空格都不算字", () => {
    expect(proseCharCount("一二三\n\n  四五六  \t七八")).toBe(8);
  });

  it("一个 emoji 是一个字，不是两个码元", () => {
    expect(proseCharCount("🐋 海雾")).toBe(3);
  });

  it("整篇只有空白 ⇒ 0 字（不是 null，也不是 1）", () => {
    expect(proseCharCount("\n  \t  \n")).toBe(0);
  });

  it("与 codePointLength 的差就是空白码点数：两口径不许混用", () => {
    const text = "海雾\n翻涌\n";
    expect(codePointLength(text)).toBe(6);
    expect(proseCharCount(text)).toBe(4);
  });
});

/**
 * 围栏切分（`---` … `---`）的唯一实现点：`fs-store` 的 `parseFrontmatter` 从这里取块与正文，
 * 渲染层页脚也从这里取正文 ⇒ 「什么算元数据」全仓一句话。
 */
describe("splitFrontmatter（围栏切分）", () => {
  it("有合法围栏 ⇒ block 含两行 ---，body 是剩下的正文", () => {
    const { block, body } = splitFrontmatter("---\ntitle: 深渊之下\n---\n正文第一段。\n");
    expect(block).toBe("---\ntitle: 深渊之下\n---");
    expect(body).toBe("正文第一段。\n");
  });

  it("无围栏 ⇒ block 为 null，body 原样（一个字也不许丢）", () => {
    const { block, body } = splitFrontmatter("只有正文。\n");
    expect(block).toBeNull();
    expect(body).toBe("只有正文。\n");
  });

  it("只按首个闭合 --- 切分：正文里那道 --- 属于正文", () => {
    const { block, body } = splitFrontmatter("---\ntitle: A\n---\n上文\n---\n下文\n");
    expect(block).toBe("---\ntitle: A\n---");
    expect(body).toBe("上文\n---\n下文\n");
  });

  it("有开栏没闭栏 ⇒ 整篇按正文算，不把半截元数据当没有", () => {
    const { block, body } = splitFrontmatter("---\ntitle: A\n正文\n");
    expect(block).toBeNull();
    expect(body).toBe("---\ntitle: A\n正文\n");
  });

  it("剥掉 Windows 编辑器塞进来的 BOM，但 body 仍从正文起", () => {
    const { block, body } = splitFrontmatter(`${BOM}---\ntitle: A\n---\n正文\n`);
    expect(block).toBe("---\ntitle: A\n---");
    expect(body).toBe("正文\n");
  });

  it("只有围栏、正文为空 ⇒ body 是空串（0 字，不是 null）", () => {
    const { block, body } = splitFrontmatter("---\ntitle: A\n---\n");
    expect(block).toBe("---\ntitle: A\n---");
    expect(body).toBe("");
    expect(codePointLength(body)).toBe(0);
  });

  it("围栏常量就是那三根横线：改动它等于改磁盘格式，必须显式", () => {
    expect(FRONTMATTER_FENCE).toBe("---");
  });

  // 2026-10-17 真机撞出（台账 §一百一十二 / §一百一十三）：CRLF 写的稿子首行是 `---\r`，
  // 旧实现只认 `---\n`，于是整篇被当成「没有围栏」——章节 title 落回相对路径、字数把元数据算进去、
  // 技能的 stage / appliesTo 全丢。Windows 上记事本与多数编辑器默认写 CRLF，这条可达。
  it("CRLF 围栏照样切得开：Windows 上写的大概率是 CRLF", () => {
    const { block, body } = splitFrontmatter("---\r\ntitle: 深渊之下\r\n---\r\n正文第一段。\r\n");
    expect(block).toBe("---\ntitle: 深渊之下\n---");
    expect(body).toBe("正文第一段。\n");
  });

  it("孤立 CR（经典 Mac 稿件）也算换行，与 import 切章同口径", () => {
    const { block, body } = splitFrontmatter("---\rtitle: A\r---\r正文\r");
    expect(block).toBe("---\ntitle: A\n---");
    expect(body).toBe("正文\n");
  });

  it("无围栏的 CRLF 正文：body 归一到 LF，字一个不丢", () => {
    const { block, body } = splitFrontmatter("只有正文。\r\n第二句。\r\n");
    expect(block).toBeNull();
    expect(body).toBe("只有正文。\n第二句。\n");
  });
});

/**
 * 「什么算换行」的唯一实现点。`import.ts` 切章与 `frontmatter.ts` 认围栏读的是同一条口径：
 * 各写一遍正则的话，Windows 写的稿子只会在这两处中的一处被认出来。
 */
describe("normalizeNewlines（换行唯一口径）", () => {
  it("CRLF 与孤立 CR 都收成 LF；本来就是 LF 的原样返回", () => {
    expect(normalizeNewlines("甲\r\n乙\r丙\n丁")).toBe("甲\n乙\n丙\n丁");
  });

  it("没有换行的串原样返回", () => {
    expect(normalizeNewlines("海雾")).toBe("海雾");
  });
});
