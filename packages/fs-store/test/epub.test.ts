/**
 * EPUB 装配的测试（2026-10-05，批次 5-②）。
 *
 * 验的是**规范硬要求**，不是「看起来像那么回事」：
 * ① mimetype 是第一条、不压缩、内容恰 20 字节无换行；
 * ② container.xml / content.opf / nav.xhtml / toc.ncx 都在，且 OPF 指向对；
 * ③ OPF 里每个 manifest id 都有对应文件、spine 不跳号不重复；
 * ④ 章节正文是 XHTML 安全的（`&` 转义了，原文不破坏 XML）。
 *
 * 另外**真解一遍 zip**（复用 zip.test.ts 的读法）——只查字符串拼得像，不查文件真能打开，
 * 那是最容易自己骗自己的地方。
 */
import { describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import type { BookKind } from "@mochen/contracts";
import { buildEpub, bodyToXhtml, escapeXml } from "../src/epub.js";
import { EPUB_MIMETYPE } from "../src/zip.js";

function readZip(buf: Buffer): Map<string, { method: number; text: string }> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("找不到中央目录结束记录");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, { method: number; text: string }>();
  for (let i = 0; i < count; i += 1) {
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    out.set(name, {
      method,
      text: method === 0 ? raw.toString("utf8") : inflateRawSync(raw).toString("utf8")
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function chapter(
  title: string,
  content: string
): {
  relPath: string;
  kind: BookKind;
  title: string;
  content: string;
} {
  return { relPath: `chapters/${title}.md`, kind: "chapter", title, content };
}

const META = { title: "F-6 验收书" } as never;
const DOCS = [
  chapter("01-开局", "---\ntitle: 开局\n---\n雾从海面涌上来。\n\n他推开门。"),
  chapter("02-暗涌", "水下的东西动了。")
];

describe("EPUB · OCF 硬要求", () => {
  it("mimetype 是第一条、不压缩、内容恰 20 字节且无换行", () => {
    const buf = buildEpub(DOCS, META);
    if (buf === null) throw new Error("不该是 null");
    const entries = readZip(buf);
    // 顺序：中央目录里第一条就是 mimetype
    const first = [...entries.keys()][0];
    expect(first).toBe("mimetype");
    const entry = entries.get("mimetype");
    // method 0 = stored（不压缩）
    expect(entry?.method).toBe(0);
    expect(entry?.text).toBe(EPUB_MIMETYPE);
    expect(entry?.text).not.toBe(`${EPUB_MIMETYPE}\n`);
    expect(Buffer.byteLength(entry?.text ?? "", "utf8")).toBe(20);
  });

  it("META-INF/container.xml 指向 OEBPS/content.opf", () => {
    const buf = buildEpub(DOCS, META);
    if (buf === null) throw new Error("不该是 null");
    const container = readZip(buf).get("META-INF/container.xml")?.text ?? "";
    expect(container).toContain('full-path="OEBPS/content.opf"');
    expect(container).toContain('media-type="application/oebps-package+xml"');
  });

  it("OPF 声明 unique-identifier、title、language", () => {
    const buf = buildEpub(DOCS, META);
    if (buf === null) throw new Error("不该是 null");
    const opf = readZip(buf).get("OEBPS/content.opf")?.text ?? "";
    expect(opf).toContain('<dc:identifier id="bookid">');
    expect(opf).toContain("<dc:title>F-6 验收书</dc:title>");
    expect(opf).toContain("<dc:language>zh-CN</dc:language>");
  });

  it("同时给 EPUB 2 的 toc.ncx 与 EPUB 3 的 nav.xhtml（挑设备的阅读器都认）", () => {
    const buf = buildEpub(DOCS, META);
    if (buf === null) throw new Error("不该是 null");
    const files = readZip(buf);
    expect(files.has("OEBPS/nav.xhtml")).toBe(true);
    expect(files.has("OEBPS/toc.ncx")).toBe(true);
    expect(files.get("OEBPS/nav.xhtml")?.text).toContain('epub:type="toc"');
    expect(files.get("OEBPS/toc.ncx")?.text).toContain("<navMap>");
  });

  it("ncx 的 playOrder 从 1 连续递增（跳号会让部分阅读器目录崩）", () => {
    const buf = buildEpub(DOCS, META);
    if (buf === null) throw new Error("不该是 null");
    const ncx = readZip(buf).get("OEBPS/toc.ncx")?.text ?? "";
    expect(ncx).toContain('playOrder="1"');
    expect(ncx).toContain('playOrder="2"');
  });
});

describe("EPUB · manifest 与 spine 自洽", () => {
  it("OPF manifest 里每个 id 都有真实存在的文件（不悬空）", () => {
    const buf = buildEpub(DOCS, META);
    if (buf === null) throw new Error("不该是 null");
    const files = readZip(buf);
    const opf = files.get("OEBPS/content.opf")?.text ?? "";
    const hrefs = [...opf.matchAll(/<item id="[^"]+" href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(files.has(`OEBPS/${href}`)).toBe(true);
    }
  });

  it("spine 的每个 idref 都能在 manifest 里找到", () => {
    const buf = buildEpub(DOCS, META);
    if (buf === null) throw new Error("不该是 null");
    const opf = readZip(buf).get("OEBPS/content.opf")?.text ?? "";
    const ids = new Set([...opf.matchAll(/<item id="([^"]+)"/g)].map((m) => m[1]));
    const idrefs = [...opf.matchAll(/<itemref idref="([^"]+)"/g)].map((m) => m[1]);
    expect(idrefs).toHaveLength(DOCS.length);
    for (const idref of idrefs) {
      expect(ids.has(idref as string)).toBe(true);
    }
  });

  it("只收章节：人物卡这类不进电子书（否则目录全是碎片）", () => {
    const withCharacter = [
      ...DOCS,
      { relPath: "characters/甲.md", kind: "character" as BookKind, title: "甲", content: "设定" }
    ];
    const buf = buildEpub(withCharacter, META);
    if (buf === null) throw new Error("不该是 null");
    const ncx = readZip(buf).get("OEBPS/toc.ncx")?.text ?? "";
    expect(ncx).toContain("开局");
    expect(ncx).not.toContain("甲");
  });

  it("一章都没有时回 null（导出一本零章的书不如不导）", () => {
    const onlyCharacter = [
      { relPath: "characters/甲.md", kind: "character" as BookKind, title: "甲", content: "设定" }
    ];
    expect(buildEpub(onlyCharacter, META)).toBeNull();
    expect(buildEpub([], META)).toBeNull();
  });
});

describe("EPUB · 正文是 XHTML 安全的", () => {
  it("XML 特殊字符被转义（漏一个整个文件解析不了）", () => {
    expect(escapeXml("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
    const doc = chapter("01", '他想了很久，终于说："走" & <不回来了>');
    const buf = buildEpub([doc], META);
    if (buf === null) throw new Error("不该是 null");
    const xhtml = readZip(buf).get("OEBPS/ch001.xhtml")?.text ?? "";
    expect(xhtml).toContain("&amp;");
    expect(xhtml).toContain("&lt;不回来了&gt;");
    // 原始的裸 < 不该出现（只允许标签自带的 <）
    expect(xhtml).not.toContain("<不回来了>");
  });

  it("frontmatter 不进正文（那是墨宸的元数据，不是书里的内容）", () => {
    const buf = buildEpub(DOCS, META);
    if (buf === null) throw new Error("不该是 null");
    const xhtml = readZip(buf).get("OEBPS/ch001.xhtml")?.text ?? "";
    expect(xhtml).toContain("雾从海面涌上来。");
    expect(xhtml).not.toContain("title: 开局");
  });

  it("空段落转成 p，章内标题转成真标题", () => {
    expect(bodyToXhtml("第一段。\n\n第二段。")).toBe("<p>第一段。</p>\n<p>第二段。</p>");
    expect(bodyToXhtml("## 小节")).toBe("<h2>小节</h2>");
    expect(bodyToXhtml("")).toContain("这一篇还没有正文");
  });

  it("书名里的 XML 特殊字符在标题与目录里都转义了", () => {
    const buf = buildEpub(DOCS, { title: "A & B <书>" } as never);
    if (buf === null) throw new Error("不该是 null");
    const files = readZip(buf);
    expect(files.get("OEBPS/content.opf")?.text).toContain("A &amp; B &lt;书&gt;");
    expect(files.get("OEBPS/toc.ncx")?.text).toContain("A &amp; B &lt;书&gt;");
  });

  it("没填作者时不写 dc:creator（不替用户编一个「佚名」）", () => {
    const buf = buildEpub(DOCS, META);
    if (buf === null) throw new Error("不该是 null");
    expect(readZip(buf).get("OEBPS/content.opf")?.text).not.toContain("dc:creator");
    const withAuthor = buildEpub(DOCS, META, { author: "潇潇" });
    if (withAuthor === null) throw new Error("不该是 null");
    expect(readZip(withAuthor).get("OEBPS/content.opf")?.text).toContain(
      "<dc:creator>潇潇</dc:creator>"
    );
  });

  it("同一本书两次导出的 unique-identifier 相同（不用时间戳，免得每次都不一样）", () => {
    const a = buildEpub(DOCS, META);
    const b = buildEpub(DOCS, META);
    if (a === null || b === null) throw new Error("不该是 null");
    const grab = (buf: Buffer) =>
      /<dc:identifier id="bookid">([^<]+)</.exec(
        readZip(buf).get("OEBPS/content.opf")?.text ?? ""
      )?.[1];
    expect(grab(a)).toBe(grab(b));
    expect(grab(a)).not.toBe("");
  });
});
