/**
 * 最小 ZIP 写入器的测试（2026-10-05，批次 5-②）。
 *
 * **关键：验的是「能被别人解开」，不是「字节看起来对」**——
 * 自己写 zip 最容易出的错是偏移量/长度算错，而那种错在自己这边是自洽的。
 * 所以这里用 Node 自带的 `zlib.inflateRawSync` 真解一遍，并按中央目录逐条读回文件名与内容。
 * （系统里未必有 unzip 命令，Node 自带的解压器更可靠，也不引入外部依赖。）
 */
import { describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { EPUB_MIMETYPE, buildZip } from "../src/zip.js";

interface ReadEntry {
  name: string;
  method: number;
  text: string;
}

/** 按中央目录逐条解出来 —— 这是「能被别人读」的证明。 */
function readZip(buf: Buffer): ReadEntry[] {
  // 从尾部找中央目录结束记录（EOCD 签名 0x06054b50）
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
  const out: ReadEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`第 ${i} 条中央目录签名不对`);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");

    // 跳到本地头取实际数据
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    out.push({
      name,
      method,
      text: method === 0 ? raw.toString("utf8") : inflateRawSync(raw).toString("utf8")
    });

    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe("最小 ZIP 写入器", () => {
  it("写出来的东西能逐条解回来（存与压两种都验）", () => {
    const buf = buildZip([
      { name: "mimetype", text: EPUB_MIMETYPE, store: true },
      { name: "META-INF/container.xml", text: "<container/>" },
      { name: "OEBPS/a.xhtml", text: "<html>中文也要对</html>" }
    ]);
    const read = readZip(buf);
    expect(read.map((e) => e.name)).toEqual([
      "mimetype",
      "META-INF/container.xml",
      "OEBPS/a.xhtml"
    ]);
    expect(read[0]?.text).toBe(EPUB_MIMETYPE);
    expect(read[0]?.method).toBe(0);
    expect(read[1]?.method).toBe(8);
    expect(read[2]?.text).toBe("<html>中文也要对</html>");
  });

  it("条目顺序就是传入顺序（mimetype 必须排第一，规范要求；实现不替调用方排序）", () => {
    const buf = buildZip([
      { name: "zzz", text: "a" },
      { name: "aaa", text: "b" }
    ]);
    expect(readZip(buf).map((e) => e.name)).toEqual(["zzz", "aaa"]);
  });

  it("本地头与中央目录头在正确位置（签名能对上）", () => {
    const buf = buildZip([{ name: "mimetype", text: EPUB_MIMETYPE, store: true }]);
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);
  });

  it("空归档也造得出合法结构（不是崩在半路）", () => {
    const buf = buildZip([]);
    expect(buf.readUInt32LE(buf.length - 22)).toBe(0x06054b50);
    expect(readZip(buf)).toEqual([]);
  });

  it("压缩确实省了体积（证明走的是 deflate 而不是原样塞）", () => {
    const long = "他推开门。".repeat(400);
    const buf = buildZip([{ name: "a.xhtml", text: long }]);
    expect(buf.length).toBeLessThan(long.length);
  });

  it("store: true 时不省体积（那就是 stored 的定义）", () => {
    const long = "他推开门。".repeat(400);
    const buf = buildZip([{ name: "a.xhtml", text: long, store: true }]);
    expect(buf.length).toBeGreaterThan(long.length);
  });

  it("中文文件名/内容都不乱码（内部名走 utf8 解回）", () => {
    const buf = buildZip([{ name: "OEBPS/第一章.xhtml", text: "雾从海面涌上来。" }]);
    const read = readZip(buf);
    expect(read[0]?.name).toBe("OEBPS/第一章.xhtml");
    expect(read[0]?.text).toBe("雾从海面涌上来。");
  });

  it("EPUB mimetype 恰 20 字节、不带换行（OCF 规范硬要求）", () => {
    expect(Buffer.byteLength(EPUB_MIMETYPE, "utf8")).toBe(20);
    expect(EPUB_MIMETYPE).not.toContain("\n");
  });
});
