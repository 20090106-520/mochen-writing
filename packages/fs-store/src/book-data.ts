import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BookDataKey, BookDataReadResult, BookDataWriteResult } from "@mochen/contracts";
import { defaultAtomicFs, writeFileAtomic, type AtomicWriteFs } from "./atomic-write.js";

/**
 * 书内设定数据的读写（2026-10-09 全仓扫描 P0-7）。
 *
 * 笔记 / 故事圣经 / 写作目标原先只住全局 `localStorage`，于是两本书串台、清缓存即丢。
 * 这一层把它们挪进**这本书**的 `.mochen/data/`：正文与设定同进同出，备份、拷贝目录、
 * 换电脑都带上，`.mochen` 又本来就在书目扫描的跳过名单里（`scan.ts`），不会被当成一章。
 *
 * 三条设计上的硬约束：
 * ① **渲染层递键，主进程拼路径**。`BOOK_DATA_FILENAMES` 是唯一那张表，类型写成
 *    `Record<BookDataKey, string>`——白名单加第四枚而这里没跟着加，编译当场失败，
 *    不靠人记得。
 * ② **写下去的必须读得回来**：先 `JSON.parse` 过一遍再落盘。让 `"{半截"` 盖上好好的
 *    一份设定，比不写严重得多。
 * ③ **写走 P0-1 那套原子写**：`writeFileAtomic` 同目录临时文件 + rename，
 *    失败时旧内容原样留在盘上，临时文件清掉。这里不另抄一份写盘逻辑（铁律 6）。
 */

/** 键 → 文件名。这份表就是「书里有哪几份设定数据」的唯一事实源。 */
export const BOOK_DATA_FILENAMES: Record<BookDataKey, string> = {
  notes: "notes.json",
  "story-bible": "story-bible.json",
  "writing-goal": "writing-goal.json"
};

/** 设定数据全部收在 `.mochen/data/` 这一棵子树里，与 `.mochen/changes/` 那棵备份树分开。 */
const DATA_DIR = ".mochen/data";

/**
 * 白名单判定。
 *
 * 用 `Object.prototype.hasOwnProperty` 而不是 `key in obj`：后者顺着原型链认
 * `toString`、`constructor` 这些名字，等于把「键」开放成任意属性名。
 * 入参一律当不可信——它从渲染层跨进程过来。
 */
export function isBookDataKey(value: unknown): value is BookDataKey {
  return (
    typeof value === "string" && Object.prototype.hasOwnProperty.call(BOOK_DATA_FILENAMES, value)
  );
}

/** 绝对路径。路径只由「书根 + 白名单文件名」拼出，任何一环都不接外部文本。 */
export function bookDataPath(root: string, key: BookDataKey): string {
  return path.join(root, ...DATA_DIR.split("/"), BOOK_DATA_FILENAMES[key]);
}

/**
 * 读回来。三种结局分得清清楚楚（见 contracts 里 `BookDataReadResult` 的注释）：
 * 没有文件＝还没有设定；读到＝原样交回；读不到（那一枚是目录、权限不对）＝`unreadable`，
 * 调用方**不许**把它当空库继续保存。
 */
export async function readBookData(root: string, key: BookDataKey): Promise<BookDataReadResult> {
  const target = bookDataPath(root, key);
  try {
    return { ok: true, json: await readFile(target, "utf8") };
  } catch (error) {
    // 只有 ENOENT 才是「这本书还没写过这类数据」。EBUSY/EACCES/EISDIR 是「这一秒读不到」，
    // 混进 null 就是拿一次抖动换一份空覆盖——与 readDocFile 那条同款判定。
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, json: null };
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: "unreadable", message };
  }
}

/**
 * 写回去。空串、纯空白、读不回 JSON 的一律拒收；真落盘失败带原因回来，
 * 由渲染层决定怎么告诉用户——这里绝不 `catch {}`。
 */
export async function writeBookData(
  root: string,
  key: BookDataKey,
  json: string,
  /** 注入点同 P0-1：产品用真 fs，测试注入「只坏一步」来看盘上到底剩了什么。 */
  fs: AtomicWriteFs = defaultAtomicFs
): Promise<BookDataWriteResult> {
  if (json.trim() === "") {
    return { ok: false, reason: "not-json", message: "空内容不写：那会读不回任何东西。" };
  }
  try {
    JSON.parse(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: "not-json", message: `不是合法 JSON：${message}` };
  }
  try {
    await writeFileAtomic(bookDataPath(root, key), json, fs);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: "write-failed", message };
  }
}
