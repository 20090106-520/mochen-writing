/**
 * ICO 容器的读写（纯 Node，无依赖，跨平台）。
 *
 * 为什么单独立一份：品牌图标这条链路里**只有像素重采样需要图像栈**，
 * 容器本身是一串定长小端字段——原先它和 System.Drawing 的调用缠在 `build-brand-icons.ps1` 里，
 * 于是「在 Windows 之外重新出这枚 .ico」这件事整个做不到（扫描总单 P2-12 的可移植性那一子项）。
 * 拆出来之后：容器在这里，能单测、能跨平台跑；重采样交给本仓**已经装着**的 Electron `nativeImage`
 * （零新依赖，见 `build-brand-icons.mjs`）。
 *
 * 口径照那份 PowerShell 逐字对齐：PNG 压缩条目（Vista+）、`planes=1`、`bits=32`、
 * 宽高字节 **256 写 0**（这是 ICO 的老约定，不是 bug：0 在读者眼里就是 256）。
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * 统一成 Buffer 再读字段。
 * 注意别图省事写成 `new Uint8Array(bytes)`：`readUInt32BE` 与 `toString("hex")` 是 Buffer 的方法，
 * Uint8Array 上没有——真跑过一次才暴露出来（拿 Node 解析盘上那枚已入库的 .ico，直接 TypeError）。
 * Buffer 视图不复制字节，256 档那种几十 KB 的载荷也不必多备份。
 */
function asBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
  return Buffer.from(bytes);
}

/** 读 PNG 的 IHDR 尺寸（宽在 16、高在 20，都是大端 u32）。不是 PNG 就抛，别往下写假条目。 */
export function pngDimensions(bytes) {
  const u = asBuffer(bytes);
  if (u.length < 24) throw new Error("PNG 数据不足 24 字节，读不到 IHDR 尺寸");
  for (let i = 0; i < 8; i += 1) {
    if (u[i] !== PNG_SIGNATURE[i])
      throw new Error(`条目不是 PNG（前 8 字节是 ${u.subarray(0, 8).toString("hex")}）`);
  }
  return { width: u.readUInt32BE(16), height: u.readUInt32BE(20) };
}

/** 条目里声明的边长：字节 0 是 256 的约定写法。 */
export function dimFromByte(byte) {
  return byte === 0 ? 256 : byte;
}

function byteForDim(size) {
  return size >= 256 ? 0 : size;
}

/**
 * 把 `[{ size, png }]` 打成一份 .ico 的字节。
 * 条目顺序 = 传入顺序；每条的 `size` 必须与 PNG 自己的 IHDR 一致（否则 OS 会按声明去拉伸，
 * 画面糊掉且没有任何地方报错——这正是「静默说谎」那一类，本仓不当它存在）。
 */
export function buildIco(entries) {
  if (entries.length === 0) throw new Error("ICO 至少要有一个条目");
  if (entries.length > 255) throw new Error(`ICO 条目过多（${entries.length}，上限 255）`);
  const parts = entries.map((entry) => {
    const png = asBuffer(entry.png);
    const { width, height } = pngDimensions(png);
    if (width !== entry.size || height !== entry.size) {
      throw new Error(
        `条目声明 ${entry.size}×${entry.size}，但 PNG 自己是 ${width}×${height}——不写这种不自洽的表`
      );
    }
    return png;
  });

  const headerSize = 6 + 16 * entries.length;
  const out = Buffer.alloc(headerSize + parts.reduce((sum, p) => sum + p.length, 0));
  out.writeUInt16LE(0, 0); // 保留
  out.writeUInt16LE(1, 2); // 类型：图标
  out.writeUInt16LE(entries.length, 4);

  let offset = headerSize;
  for (let i = 0; i < entries.length; i += 1) {
    const { size } = entries[i];
    const png = parts[i];
    const at = 6 + 16 * i;
    out.writeUInt8(byteForDim(size), at); // 宽（256 → 0）
    out.writeUInt8(byteForDim(size), at + 1); // 高
    out.writeUInt8(0, at + 2); // 调色板颜色数：PNG 条目不配
    out.writeUInt8(0, at + 3); // 保留
    out.writeUInt16LE(1, at + 4); // planes
    out.writeUInt16LE(32, at + 6); // bits per pixel
    out.writeUInt32LE(png.length, at + 8);
    out.writeUInt32LE(offset, at + 12);
    Buffer.from(png.buffer, png.byteOffset, png.length).copy(out, offset);
    offset += png.length;
  }
  return new Uint8Array(out);
}

/**
 * 反向解析：把 .ico 拆成条目表，并核对每条的偏移与长度真的落在文件里。
 * 这道闸与那份生成脚本共用——**能读回来**才算写对了，光看字节数不够。
 */
export function parseIco(bytes) {
  const buf = asBuffer(bytes);
  if (buf.length < 6) throw new Error("文件不足 6 字节，不是 ICO");
  const reserved = buf.readUInt16LE(0);
  const type = buf.readUInt16LE(2);
  const count = buf.readUInt16LE(4);
  if (reserved !== 0 || type !== 1)
    throw new Error(`头不像 ICO：保留=${reserved}（应为 0）类型=${type}（应为 1）`);
  if (6 + 16 * count > buf.length)
    throw new Error(`表说有 ${count} 条，文件却只有 ${buf.length} 字节`);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    const at = 6 + 16 * i;
    const entry = {
      index: i,
      width: dimFromByte(buf.readUInt8(at)),
      height: dimFromByte(buf.readUInt8(at + 1)),
      planes: buf.readUInt16LE(at + 4),
      bits: buf.readUInt16LE(at + 6),
      length: buf.readUInt32LE(at + 8),
      offset: buf.readUInt32LE(at + 12)
    };
    if (entry.offset + entry.length > buf.length) {
      throw new Error(
        `第 ${i} 条越界：偏移 ${entry.offset} + 长度 ${entry.length} > 文件 ${buf.length}`
      );
    }
    const png = buf.subarray(entry.offset, entry.offset + entry.length);
    const dims = pngDimensions(png);
    // 表里声明的尺寸与 PNG 自己的 IHDR **两份都留着**：只回一份就会把不一致吃掉，
    // 而「声明 32 实际 24」这种条目正是 OS 悄悄拉伸、谁都不报错的那种。
    // `png` 是原文件的视图（不复制），回读测试要拿它比对逐字节往返。
    entries.push({ ...entry, png, pngWidth: dims.width, pngHeight: dims.height });
  }
  return { count, entries };
}
