/**
 * 最小 ZIP 写入器（2026-10-05，批次 5-②），只为 EPUB 服务。
 *
 * **为什么不引依赖**：EPUB 就是个 zip，用 `node:zlib` 的 `deflateRawSync` + `crc32`
 * 两行就够；引 jszip/archiver 是给一个「本仓只要存不压缩与 deflate 两种」的需求背一整个包。
 * Node 24 自带这两个（`zlib.crc32` 从 v20.15 起可用），所以本文件零依赖。
 *
 * **两条 EPUB 硬要求写死在 `buildZip` 的参数里，不给关掉的口子**：
 * ① 第一个条目必须是 `mimetype`，**不压缩**（stored，method 0）——
 *    压缩了或排第二，Calibre 之类会直接判定「这不是 EPUB」；
 * ② `mimetype` 内容恰为 20 字节 `application/epub+zip`，**不许带换行**。
 * 见 OCF 规范与多个独立实现教程的同一说法。
 *
 * **只做 EPUB 用得到的两件事**：stored 与 deflate。不做目录条目、不做 ZIP64、
 * 不做加密与 Unicode 文件名标志位（EPUB 内部文件名全是 ASCII，够用）。
 * 这些「不做」是刻意的：多写一份通用 zip 库，就是多一处会漂移的实现。
 */
import { crc32, deflateRawSync } from "node:zlib";

export interface ZipEntry {
  /** 归档内路径（用 `/` 分隔）。 */
  name: string;
  /** 文件内容的 UTF-8 文本。 */
  text: string;
  /** `false` = 不压缩（stored）。默认 deflate。 */
  store?: boolean;
}

/** DOS 时间戳：EPUB 内部文件的时间戳没有语义价值，固定一个合法值即可（1980-01-01 是 zip 纪元起点）。 */
const DOS_TIME = 0;
const DOS_DATE = 33; // 1980-01-01

function crcOf(buf: Buffer): number {
  // zlib.crc32 返回无符号 32 位；这里 & 0xffffffff 保证是合法非负整数。
  return crc32(buf) >>> 0;
}

/**
 * 造一个 zip 字节。
 *
 * `entries` 的**顺序就是归档内顺序**——mimetype 排第一是规范要求，
 * 所以调用方必须把 mimetype 放第一位；这里不替它排序（排序等于把规范藏进实现里，
 * 下次有人调换顺序就再也看不出来）。
 */
export function buildZip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const raw = Buffer.from(entry.text, "utf8");
    const store = entry.store === true;
    const body = store ? raw : deflateRawSync(raw, { level: 9 });
    const method = store ? 0 : 8;
    const sum = crcOf(raw);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0); // 本地文件头签名
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags（不用 UTF-8 位：内部名全 ASCII）
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    locals.push(local, body);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0); // 中央目录头签名
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centrals.push(central);

    offset += local.length + body.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // 中央目录结束记录
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment 长度

  return Buffer.concat([...locals, centralBuf, end]);
}

/** EPUB 的 mimetype 文件内容：规范要求**恰好**这 20 字节，不许有换行。 */
export const EPUB_MIMETYPE = "application/epub+zip";
