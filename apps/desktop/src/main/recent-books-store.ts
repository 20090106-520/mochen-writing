import { readFile } from "node:fs/promises";
import path from "node:path";
import { IPC_CHANNELS, type RecentBookEntry, type RecentBooksSnapshot } from "@mochen/contracts";
import { defaultAtomicFs, writeFileAtomic, type AtomicWriteFs } from "@mochen/fs-store";
import type { ReadTextFile } from "./credential-store.js";
// 来源闸 + 参数形状闸的唯一出处：注册通道只许走 handleTrusted（与本目录其它 store 同一安排）。
import { handleTrusted } from "./ipc-guard.js";

/** ipcMain.handle 的窄形状（由装配处裹一层，与 appearance-store 同款）。 */
type Handler = (channel: string, fn: (...args: unknown[]) => unknown) => void;

/**
 * 清单上限：二十本够一个人把最近在写的都摆在眼前，再多左栏就变成一份需要滚动的目录。
 * 超出部分按最久未打开淘汰——淘汰只影响清单，盘上的书一个字都不动。
 */
export const MAX_RECENT_BOOKS = 20;

export interface RecentBooksStore {
  list(): Promise<RecentBooksSnapshot>;
  /** 打开/新建成功后记一笔（同一路径只留一条，时间刷新）。 */
  touch(
    rootPath: string,
    title: string,
    stats?: { chapterCount?: number; totalChars?: number }
  ): Promise<void>;
  /** 只把一条从清单里划掉，返回划掉之后的整份清单。 */
  forget(rootPath: string): Promise<RecentBooksSnapshot>;
}

/** Windows 上盘符大小写与斜杠方向都不固定，同一本书不能被记成两条。 */
function pathKey(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/** 盘上那一份的宽容读：坏了就当空清单——作品库丢了不该挡住开书，下次打开会再记一笔。 */
function parseSnapshot(raw: string): RecentBooksSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { books: [] };
  }
  const rawBooks = (parsed as { books?: unknown } | null)?.books;
  if (!Array.isArray(rawBooks)) return { books: [] };
  const books: RecentBookEntry[] = [];
  for (const item of rawBooks) {
    if (typeof item !== "object" || item === null) continue;
    const entry = item as Partial<RecentBookEntry>;
    if (
      typeof entry.rootPath !== "string" ||
      entry.rootPath.trim() === "" ||
      typeof entry.title !== "string" ||
      typeof entry.lastOpenedAt !== "string"
    ) {
      continue;
    }
    books.push({
      rootPath: entry.rootPath,
      title: entry.title,
      lastOpenedAt: entry.lastOpenedAt,
      ...(typeof entry.chapterCount === "number" ? { chapterCount: entry.chapterCount } : {}),
      ...(typeof entry.totalChars === "number" ? { totalChars: entry.totalChars } : {})
    });
  }
  return { books };
}

function sortByRecency(books: RecentBookEntry[]): RecentBookEntry[] {
  return [...books]
    .sort((a, b) => Date.parse(b.lastOpenedAt) - Date.parse(a.lastOpenedAt))
    .slice(0, MAX_RECENT_BOOKS);
}

/**
 * 作品库的落盘真身（`<appData>/recent-books.json`）。
 *
 * 错误策略与外观设置同档：读坏了退空清单继续跑，写失败也不把异常抛给「打开作品」那条链——
 * 记不住「最近打开过」是遗憾，不是打不开书的理由。
 */
export function createRecentBooksStore(deps: {
  dir: string;
  readFile?: ReadTextFile;
  fs?: AtomicWriteFs;
}): RecentBooksStore {
  const configFile = path.join(deps.dir, "recent-books.json");
  const readText: ReadTextFile = deps.readFile ?? ((p) => readFile(p, "utf8"));
  const writeFs: AtomicWriteFs = deps.fs ?? defaultAtomicFs;

  async function read(): Promise<RecentBooksSnapshot> {
    let raw: string;
    try {
      raw = await readText(configFile);
    } catch {
      return { books: [] };
    }
    if (raw.trim() === "") return { books: [] };
    return { books: sortByRecency(parseSnapshot(raw).books) };
  }

  async function write(books: RecentBookEntry[]): Promise<void> {
    try {
      await writeFileAtomic(
        configFile,
        `${JSON.stringify({ books: sortByRecency(books) }, null, 2)}\n`,
        writeFs
      );
    } catch {
      // 见上面那段：清单写不进去不影响本次开书，下一次成功打开时会再试一遍。
    }
  }

  return {
    list: read,

    async touch(rootPath, title, stats) {
      if (rootPath.trim() === "") return;
      const { books } = await read();
      const key = pathKey(rootPath);
      const entry: RecentBookEntry = {
        rootPath,
        title: title.trim() === "" ? path.basename(rootPath) : title,
        lastOpenedAt: new Date().toISOString()
      };
      if (stats?.chapterCount !== undefined) entry.chapterCount = stats.chapterCount;
      if (stats?.totalChars !== undefined) entry.totalChars = stats.totalChars;
      const next: RecentBookEntry[] = [
        entry,
        ...books.filter((book) => pathKey(book.rootPath) !== key)
      ];
      await write(next);
    },

    async forget(rootPath) {
      const { books } = await read();
      const key = pathKey(rootPath);
      const next = books.filter((book) => pathKey(book.rootPath) !== key);
      await write(next);
      return { books: next };
    }
  };
}

/** 只注册作品库那两条：读整份清单、划掉一条（参数是绝对路径，形状闸在 ipc-guard）。 */
export function registerRecentBooksIpc(handle: Handler, store: RecentBooksStore): void {
  handleTrusted(handle, IPC_CHANNELS.bookRecent, () => store.list());
  handleTrusted(handle, IPC_CHANNELS.bookForget, (_event, rootPath) =>
    store.forget(rootPath as string)
  );
}
