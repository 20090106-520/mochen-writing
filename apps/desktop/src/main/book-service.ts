import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  IPC_CHANNELS,
  parseBookMeta,
  type BookMeta,
  type BookOpenResult,
  type DocContent,
  type DocWriteResult
} from "@abyss/contracts";
import { readDocFile, scanBook, sortChapters, writeDocFile } from "@abyss/fs-store";

export interface BookService {
  open(rootPath: string): Promise<BookOpenResult>;
  saveMeta(meta: BookMeta): Promise<void>;
  readDoc(relPath: string): Promise<DocContent>;
  writeDoc(relPath: string, content: string, expectedFingerprint: string): Promise<DocWriteResult>;
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
  let root: string | null = null;

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
      root = rootPath;
      return { rootPath, meta, docs };
    },

    async saveMeta(meta: BookMeta) {
      if (!root) throw new Error("尚未打开作品目录，无法保存 book.json");
      parseBookMeta(meta);
      const body = `${JSON.stringify(meta, null, 2)}\n`;
      await writeFile(path.join(root, "book.json"), body, "utf8");
    },

    async readDoc(relPath: string) {
      if (!root) throw new Error("尚未打开作品目录");
      return { relPath, ...(await readDocFile(root, relPath)) };
    },

    async writeDoc(relPath, content, expectedFingerprint) {
      if (!root) return { ok: false, reason: "io-error", message: "尚未打开作品目录" };
      return writeDocFile(root, relPath, content, expectedFingerprint);
    },

    async close() {
      root = null;
    }
  };
}
