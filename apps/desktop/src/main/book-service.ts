import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  IPC_CHANNELS,
  parseBookMeta,
  type BookMeta,
  type BookOpenResult,
  type DocContent,
  type DocRef,
  type DocWriteResult
} from "@mochen/contracts";
import { readDocFile, scanBook, sortChapters, writeDocFile } from "@mochen/fs-store";

export interface BookSnapshot {
  root: string;
  meta: BookMeta;
  docs: DocRef[];
}

export interface BookService {
  open(rootPath: string): Promise<BookOpenResult>;
  saveMeta(meta: BookMeta): Promise<void>;
  readDoc(relPath: string): Promise<DocContent>;
  writeDoc(relPath: string, content: string, expectedFingerprint: string): Promise<DocWriteResult>;
  /** 运行期现取；未打开目录返回 null。permissionMode 会被人随时改，所以每次现取而不是缓存值。 */
  current(): BookSnapshot | null;
  close(): Promise<void>;
}

export function registerBookIpc(
  ipcMain: { handle(channel: string, fn: (...args: unknown[]) => unknown): void },
  service: BookService
): void {
  ipcMain.handle(IPC_CHANNELS.bookOpen, (_event, rootPath) => service.open(rootPath as string));
  ipcMain.handle(IPC_CHANNELS.bookSaveMeta, (_event, meta) => service.saveMeta(meta as BookMeta));
  ipcMain.handle(IPC_CHANNELS.docRead, (_event, relPath) => service.readDoc(relPath as string));
  ipcMain.handle(IPC_CHANNELS.docWrite, (_event, relPath, content, expectedFingerprint) =>
    service.writeDoc(relPath as string, content as string, expectedFingerprint as string)
  );
}

export function createBookService(): BookService {
  let snapshot: BookSnapshot | null = null;

  return {
    async open(rootPath: string) {
      const raw = await readFile(path.join(rootPath, "book.json"), "utf8");
      let meta: BookMeta;
      try {
        meta = parseBookMeta(JSON.parse(raw));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`无法解析 book.json：${message}`, { cause: error });
      }
      const docs = sortChapters(await scanBook(rootPath), meta.chapterOrder);
      snapshot = { root: rootPath, meta, docs };
      return { rootPath, meta, docs };
    },

    async saveMeta(meta: BookMeta) {
      if (snapshot === null) throw new Error("尚未打开作品目录，无法保存 book.json");
      const parsed = parseBookMeta(meta);
      const body = `${JSON.stringify(parsed, null, 2)}\n`;
      await writeFile(path.join(snapshot.root, "book.json"), body, "utf8");
      // 权限档与阶段就住在 meta 里：不刷新快照，审批时查到的就是旧档位
      snapshot = { ...snapshot, meta: parsed };
    },

    async readDoc(relPath: string) {
      if (snapshot === null) throw new Error("尚未打开作品目录");
      return { relPath, ...(await readDocFile(snapshot.root, relPath)) };
    },

    async writeDoc(relPath, content, expectedFingerprint) {
      if (snapshot === null) return { ok: false, reason: "io-error", message: "尚未打开作品目录" };
      return writeDocFile(snapshot.root, relPath, content, expectedFingerprint);
    },

    current() {
      return snapshot;
    },

    async close() {
      snapshot = null;
    }
  };
}
