import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIco, dimFromByte, parseIco, pngDimensions } from "./ico-container.mjs";
import { DEFAULT_SIZES, parseArgs } from "./build-brand-icons.mjs";

/**
 * 品牌图标这条链路的容器闸（2026-10-12 用户授权修复清单第 5 项：`build-brand-icons.ps1` 跨平台移植）。
 *
 * 移植切的是这一刀：**像素重采样需要图像栈，容器不需要**。原先两件事缠在那份 PowerShell 里，
 * 于是「在 Windows 之外重新出这枚 .ico」整个做不到。现在容器住在 `ico-container.mjs`（纯 Node、
 * 可单测、任何平台一样跑），重采样交给本仓已经装着的 Electron `nativeImage`。
 *
 * 这里钉的都是**能失败**的结构：条目表与 PNG 自己声明的尺寸必须互相咬合、256 的宽高字节写 0
 * 这个老约定必须两边一致、越界与不像 ICO 的输入必须抛而不是静默出一张坏图。
 * 最后两条把口径钉在已入库的那枚 `resources/icon.ico` 上——新解析器要能读懂旧生成器出的文件，
 * 读不懂就说明字段口径漂了（那才是这仓唯一真在用的图标）。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const TRACKED_ICO = path.join(ROOT, "apps", "desktop", "resources", "icon.ico");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * 造一份「PNG 前缀」当夹具载荷：只填容器真会读的那几个字段（签名、IHDR 长度、类型、宽高），
 * 尾部按 `filler` 补长，好让偏移与长度这两个字段有意义。
 * 别拿它当能显示的 PNG——本闸只判容器对不对，像素口径归 Electron 那半边。
 */
function fakePng(width, height, filler = 8) {
  const buf = Buffer.alloc(24 + filler);
  PNG_SIGNATURE.copy(buf, 0);
  buf.writeUInt32BE(13, 8); // IHDR chunk 数据长度
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function entriesOf(sizes, filler = 8) {
  return sizes.map((size) => ({ size, png: fakePng(size, size, filler) }));
}

test("往返：条目数、声明尺寸、偏移链与载荷逐字节都能读回来", () => {
  const sizes = [16, 48, 256];
  const built = entriesOf(sizes, 40);
  const ico = buildIco(built);
  const parsed = parseIco(ico);

  expect(parsed.count).toBe(3);
  expect(parsed.entries.map((e) => [e.width, e.height])).toEqual([
    [16, 16],
    [48, 48],
    [256, 256]
  ]);
  for (const entry of parsed.entries) {
    expect(entry.planes, `第 ${entry.index} 条 planes 不是 1`).toBe(1);
    expect(entry.bits, `第 ${entry.index} 条不是 32 位色`).toBe(32);
    // 表里声明的与 PNG 自己的 IHDR 两份都到场，且互相一致。
    expect([entry.pngWidth, entry.pngHeight], `第 ${entry.index} 条的 IHDR 与声明不符`).toEqual([
      entry.width,
      entry.height
    ]);
  }

  // 偏移链：表后面紧跟载荷，首条从 6 + 16×条数 起，往后逐条首尾相接，最后一条正好把文件写完。
  expect(parsed.entries[0].offset).toBe(6 + 16 * 3);
  for (let i = 1; i < parsed.entries.length; i += 1) {
    const prev = parsed.entries[i - 1];
    const cur = parsed.entries[i];
    expect(cur.offset, `第 ${i} 条没接在第 ${i - 1} 条后面`).toBe(prev.offset + prev.length);
  }
  const last = parsed.entries.at(-1);
  expect(last.offset + last.length, "末条没有正好落在文件末尾（后面有垃圾或长度说假话）").toBe(
    ico.length
  );

  for (const [i, entry] of parsed.entries.entries()) {
    expect(Buffer.compare(entry.png, built[i].png), `第 ${i} 条载荷不是原样回来的`).toBe(0);
  }
});

test("同输入两次出图逐字节相同（别让人往容器里塞时间戳或随机填充）", () => {
  const built = entriesOf([16, 256]);
  expect(Buffer.compare(Buffer.from(buildIco(built)), Buffer.from(buildIco(built)))).toBe(0);
});

test("256 档的宽高字节写 0，读回来仍是 256（ICO 的老约定，不是 bug）", () => {
  const ico = Buffer.from(buildIco(entriesOf([16, 256])));
  const second = 6 + 16 * 1; // 第二条目录项的起点
  expect(ico.readUInt8(second), "256 档的宽字节没写成 0——老约定漂了").toBe(0);
  expect(ico.readUInt8(second + 1), "256 档的高字节没写成 0").toBe(0);
  expect(dimFromByte(ico.readUInt8(second))).toBe(256);
  const parsed = parseIco(ico);
  expect(parsed.entries[1].width).toBe(256);
  // 反向对照：小于 256 的档不许写 0，否则「0 = 256」这条约定就两头都不能信。
  expect(ico.readUInt8(6)).toBe(16);
  // 阈值单独再钉一次：128 与 256 挨着放时，只有 256 走 0 那条约定。
  // 少了这一条，`size >= 128 ? 0 : size` 这种写法能全绿——而它会让 OS 把 128 档当成 256 来拉伸。
  const pair = Buffer.from(buildIco(entriesOf([128, 256])));
  expect(pair.readUInt8(6), "128 档被当成 256 写了 0").toBe(128);
  expect(pair.readUInt8(6 + 16), "256 档没写成 0").toBe(0);
});

test("表与 PNG 各说一套就不写：声明 32 而载荷自己是 24 的条目必须被拒", () => {
  // 这正是 OS 悄悄拉伸、谁都不报错的那一类；本仓不当它存在。
  expect(() => buildIco([{ size: 32, png: fakePng(24, 24) }])).toThrow(/不自洽/);
  // 只有高不对的那种也要逮住：宽对了就放过，等于让纵向拉伸的条目蒙混过关。
  expect(() => buildIco([{ size: 32, png: fakePng(32, 24) }])).toThrow(/不自洽/);
  expect(() => buildIco([{ size: 32, png: fakePng(24, 32) }])).toThrow(/不自洽/);
  // 反向对照：自洽的同一份条目必须过，否则这条闸只会逼人改判据。
  expect(() => buildIco([{ size: 24, png: fakePng(24, 24) }])).not.toThrow();
});

test("条目数越界要拒：空表与超过 255 条都不出图", () => {
  expect(() => buildIco([])).toThrow(/至少要有一个条目/);
  // 目录字段是 u16，但 ICO 约定条目数不超过 255；照旧脚本的 7 档来说这闸门平时碰不到，
  // 碰不到不代表能不管——它一旦溢出就会写出半张表。
  expect(() => buildIco(entriesOf(Array.from({ length: 256 }, () => 16)))).toThrow(/条目过多/);
});

test("不像 ICO 的头就抛，别把光标文件或半截文件当图标读", () => {
  const ok = Buffer.from(buildIco(entriesOf([16])));
  expect(ok.readUInt16LE(0)).toBe(0);
  expect(ok.readUInt16LE(2)).toBe(1); // 类型 1 = 图标
  const cursor = Buffer.from(ok);
  cursor.writeUInt16LE(2, 2); // 类型 2 = 光标
  expect(() => parseIco(cursor)).toThrow(/头不像 ICO/);
  expect(() => parseIco(ok.subarray(0, 4))).toThrow(/不是 ICO/);
});

test("目录说了一条不存在的载荷就抛：越界不许静默返回半条数据", () => {
  const tampered = Buffer.from(buildIco(entriesOf([16, 48])));
  tampered.writeUInt32LE(999999, 6 + 8); // 第一条的长度改成超出文件的值
  expect(() => parseIco(tampered)).toThrow(/越界/);
  // 表本身吹牛：说有 40 条，文件里只有 2 条的位置。
  const lying = Buffer.from(buildIco(entriesOf([16, 48])));
  lying.writeUInt16LE(40, 4);
  expect(() => parseIco(lying)).toThrow(/文件却只有/);
});

test("条目不是 PNG 就抛（旧式 BMP 条目不在我们的口径里）", () => {
  const fake = Buffer.from(buildIco(entriesOf([16])));
  const at = parseIco(fake).entries[0].offset;
  const bmp = Buffer.concat([Buffer.from("BM"), Buffer.alloc(32)]);
  bmp.copy(fake, at);
  expect(() => pngDimensions(bmp)).toThrow(/不是 PNG/);
  expect(() => parseIco(fake)).toThrow(/不是 PNG/);
  expect(() => pngDimensions(fakePng(16, 16, 0).subarray(0, 20))).toThrow(/不足 24 字节/);
});

test("已入库那枚 icon.ico 能被新解析器读懂，且结构就是七档", () => {
  // 旧生成器（System.Drawing）出的文件必须由新解析器原样读通：读不通就说明字段口径漂了。
  const bytes = fs.readFileSync(TRACKED_ICO);
  const parsed = parseIco(bytes);
  expect(parsed.count, "盘上这枚 .ico 的档数变了：任务栏图标会跟着变，那是品牌资产的决定").toBe(7);
  expect(parsed.entries.map((e) => e.width)).toEqual([16, 24, 32, 48, 64, 128, 256]);
  for (const entry of parsed.entries) {
    expect([entry.planes, entry.bits]).toEqual([1, 32]);
    expect([entry.pngWidth, entry.pngHeight], `第 ${entry.index} 条声明与 IHDR 不符`).toEqual([
      entry.width,
      entry.height
    ]);
    expect(entry.png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
  }
  expect(parsed.entries[0].offset).toBe(6 + 16 * parsed.count);
  expect(parsed.entries.at(-1).offset + parsed.entries.at(-1).length).toBe(bytes.length);
});

test("默认档位与已入库那枚 .ico 同一口径（两台生成器不许各有一套）", () => {
  const widths = parseIco(fs.readFileSync(TRACKED_ICO)).entries.map((e) => e.width);
  expect(DEFAULT_SIZES, "换档位等于换图标：这里必须与盘上资产一致").toEqual(widths);
});

test("参数解析只会接受说得出口的写法", () => {
  const bare = parseArgs([]);
  // 品牌资产的那枚 .ico 不设默认落点：指哪儿写哪儿，没指就当场失败（判据在 runCli 那道闸）。
  expect(bare.out, "parseArgs 给出了默认输出路径——那等于默许覆盖已入库的品牌资产").toBeNull();
  expect(bare.sizes).toEqual(DEFAULT_SIZES);

  expect(parseArgs(["--sizes", "16,32,256"]).sizes).toEqual([16, 32, 256]);
  // 脏值逐个滤掉而不是整段报错：命令行是人敲的，`16,,32` 这种手滑不该变成一次失败。
  expect(parseArgs(["--sizes", "16,,32,x"]).sizes).toEqual([16, 32]);
  expect(parseArgs(["--help"]).help).toBe(true);
  expect(parseArgs(["-h"]).help).toBe(true);

  expect(() => parseArgs(["--sizes", "512"])).toThrow(/上限是 256/);
  expect(() => parseArgs(["--sizes"])).toThrow(/正整数/);
  expect(() => parseArgs(["--sizes", "abc"])).toThrow(/正整数/);
  expect(() => parseArgs(["--out"])).toThrow(/要接一个路径/);
  expect(() => parseArgs(["--out", "  "])).toThrow(/要接一个路径/);
  expect(() => parseArgs(["--nope"])).toThrow(/不认识参数/);
  // --out 落到绝对路径：相对写法由调用方的 cwd 决定，这里当场 resolve，免得 Electron 那头换个 cwd 就写歪。
  expect(path.isAbsolute(parseArgs(["--out", "build/x.ico"]).out)).toBe(true);
});

test("只有一台生成器：那份 Windows 专用的 .ps1 已经不在盘上", () => {
  // 「同一件事只留一处真身」是这仓的硬规矩。留着 .ps1 就是留着第二个出图口径
  // （System.Drawing 的 HighQualityBicubic 与 Chromium 的缩放核不是同一个核），
  // 下一个人无从判断哪台说了算。旧文件在 git 历史里，要挖随时挖得回。
  expect(fs.existsSync(path.join(HERE, "build-brand-icons.ps1")), "又出现第二台生成器了").toBe(
    false
  );
  expect(fs.existsSync(path.join(HERE, "build-brand-icons.mjs"))).toBe(true);
  expect(fs.existsSync(path.join(HERE, "ico-container.mjs"))).toBe(true);
});
