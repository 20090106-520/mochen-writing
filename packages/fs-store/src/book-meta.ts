import path from "node:path";
import { parseBookMeta, type BookMeta } from "@mochen/contracts";
import { defaultAtomicFs, writeFileAtomic, type AtomicWriteFs } from "./atomic-write.js";

/**
 * `book.json` 的**唯一一份**盘上形状与写法（2026-10-09 全仓扫描 P0-1，顺路收掉铁律 6 的一处违规）。
 *
 * 之前这个文件有两处各写各的：建书骨架（`create.ts`）与改设置（主进程 `book-service.saveMeta`）
 * 都自己 `JSON.stringify(parsed, null, 2)` 一遍。两份形状一旦分叉，同一本书就会被两条路写出两种字节。
 *
 * 更要紧的是**它必须原子**：`book.json` 是一本书的门牌。裸写（先截断再写）半途而废会留下一份
 * 解析不了的 JSON，于是 `open()` 在 parse 那一步就抛——**正文一篇没丢，这本书却再也打不开**。
 * 这比丢一章稿子更让用户以为「软件把我的书删了」。
 */
export const BOOK_META_FILE = "book.json";

/** 盘上那一串字节：先过 zod 再序列化，所以写出去的形状与读回来的是同一个口径。 */
export function bookMetaJson(raw: unknown): string {
  const parsed = parseBookMeta(raw);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

/**
 * 原子写出 `book.json`，返回**校验过的那份** meta（调用方直接拿它刷新快照，不用再 parse 一次）。
 * 写失败时原样抛出：这一条链路上「没写成」必须让调用方知道，摆到界面上的是理由而不是猜测。
 */
export async function writeBookMetaFile(
  directory: string,
  raw: unknown,
  fs: AtomicWriteFs = defaultAtomicFs
): Promise<BookMeta> {
  const parsed = parseBookMeta(raw);
  // 字节由 `bookMetaJson` 一家定：这里再 stringify 一次就是第二份形状。
  await writeFileAtomic(path.join(directory, BOOK_META_FILE), bookMetaJson(parsed), fs);
  return parsed;
}
