import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  DEFAULT_PERMISSION_MODE,
  IPC_CHANNELS,
  parseBookMeta,
  sanitizeDocFileName,
  type BookCreateInput,
  type BookCreateResult,
  type BookMeta,
  type BookOpenResult,
  type DocContent,
  type DocCreateResult,
  type DocRef,
  type DocWriteResult
} from "@mochen/contracts";
import {
  createBookSkeleton,
  createDocFile,
  readDocFile,
  scanBook,
  sortChapters,
  writeDocFile
} from "@mochen/fs-store";

export interface BookSnapshot {
  root: string;
  meta: BookMeta;
  docs: DocRef[];
}

export interface BookService {
  open(rootPath: string): Promise<BookOpenResult>;
  /** 建新书骨架并立刻打开：成功返回与 open 同构的结果，渲染层一套填充逻辑两用。 */
  createBook(input: BookCreateInput): Promise<BookCreateResult>;
  saveMeta(meta: BookMeta): Promise<void>;
  readDoc(relPath: string): Promise<DocContent>;
  writeDoc(relPath: string, content: string, expectedFingerprint: string): Promise<DocWriteResult>;
  /** 按规划好的书内路径建一篇空文档；relPath 由渲染层用 contracts 的 planDocRelPath 生成，这里兜底再验一遍。 */
  createDoc(relPath: string, title: string): Promise<DocCreateResult>;
  /** 运行期现取；未打开目录返回 null。permissionMode 会被人随时改，所以每次现取而不是缓存值。 */
  current(): BookSnapshot | null;
  close(): Promise<void>;
}

export function registerBookIpc(
  ipcMain: { handle(channel: string, fn: (...args: unknown[]) => unknown): void },
  service: BookService
): void {
  ipcMain.handle(IPC_CHANNELS.bookOpen, (_event, rootPath) => service.open(rootPath as string));
  ipcMain.handle(IPC_CHANNELS.bookCreate, (_event, input) =>
    service.createBook(input as BookCreateInput)
  );
  ipcMain.handle(IPC_CHANNELS.bookSaveMeta, (_event, meta) => service.saveMeta(meta as BookMeta));
  ipcMain.handle(IPC_CHANNELS.docRead, (_event, relPath) => service.readDoc(relPath as string));
  ipcMain.handle(IPC_CHANNELS.docWrite, (_event, relPath, content, expectedFingerprint) =>
    service.writeDoc(relPath as string, content as string, expectedFingerprint as string)
  );
  ipcMain.handle(IPC_CHANNELS.docCreate, (_event, relPath, title) =>
    service.createDoc(relPath as string, title as string)
  );
}

/**
 * 装配 `BookService` 需要的外部读口。
 *
 * `retention` 是**必填**的（2026-10-06 批次 5-⑧）：它直接决定 `writeDoc` 留完备份后删掉多少。
 * 做成可选会有一个很坏的失败模式——某个装配点忘了传，于是界面上用户把上限调到 10 份，
 * 盘上照旧按 50 份删，控件说的和它做的事对不上，而代码里看不出任何异常。
 * 必填让「忘了传」变成编译期错误。
 */
export interface BookServiceDeps {
  /** 现取当前保留上限（每次写盘都读一次，不缓存：设置页可能刚改过）。 */
  retention(): { maxCount: number; maxBytes: number };
}

export function createBookService(deps: BookServiceDeps): BookService {
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

    async createBook(input) {
      const title = typeof input?.title === "string" ? input.title.trim() : "";
      const directory = typeof input?.directory === "string" ? input.directory.trim() : "";
      if (title === "") return { ok: false, message: "书名不能是空的。" };
      if (directory === "") return { ok: false, message: "还没选择新书要放在哪个目录。" };
      // 新书的骨架照样走 zod 校验（parseBookMeta）：id/stages/chapterOrder 的形状不许有第二套标准。
      // 权限档取 contracts 的 DEFAULT_PERMISSION_MODE，不在主进程捏一个档位名——用户裁定是「新书默认全开」，
      // 而主进程其它地方（agent-service 的 context、渲染层的 PermissionMenu）兜的都是这一个常量；
      // 这里曾写死 "read-only"，于是同一本书「刚建出来是只读、没开书时兜底却是全开」，两处自相矛盾。
      const meta = parseBookMeta({
        id: randomUUID(),
        title,
        schemaVersion: 1,
        stages: [{ id: "draft", name: "正文" }],
        activeStage: "draft",
        permissionMode: DEFAULT_PERMISSION_MODE,
        chapterOrder: []
      });
      const skeleton = await createBookSkeleton(directory, meta);
      if (!skeleton.ok) return { ok: false, message: skeleton.message };
      return { ok: true, book: await this.open(directory) };
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
      // 上限现取（不缓存）：设置页随时可能改，而这一条链路上没有「设置变了」的信号可订阅。
      // 取不到就退回默认档——`writeDocFile` 里的 resolveRetention 还会再夹一次，两处口径一致。
      let retention: { maxCount: number; maxBytes: number } | null = null;
      try {
        retention = deps.retention();
      } catch {
        // 装配没给好不等于保存失败：正文必须照写，淘汰退回默认档。
      }
      return writeDocFile(snapshot.root, relPath, content, expectedFingerprint, retention);
    },

    async createDoc(relPath, title) {
      if (snapshot === null)
        return { ok: false, reason: "no-book", message: "尚未打开作品目录，建不了新文档。" };
      const cleanTitle = sanitizeDocFileName(title);
      if (cleanTitle === null)
        return { ok: false, reason: "invalid-path", message: "标题起不了文件名，换一个名字。" };
      const result = await createDocFile(snapshot.root, relPath, cleanTitle);
      if (!result.ok) return result;
      // 盘上多了新文件：重扫一次让 docs 与磁盘对齐（excerpt/chars 一并补齐），再回报指纹。
      snapshot = {
        ...snapshot,
        docs: sortChapters(await scanBook(snapshot.root), snapshot.meta.chapterOrder)
      };
      return { ok: true, relPath, fingerprint: result.fingerprint };
    },

    current() {
      return snapshot;
    },

    async close() {
      snapshot = null;
    }
  };
}
