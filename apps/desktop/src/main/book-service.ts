import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  DEFAULT_PERMISSION_MODE,
  IPC_CHANNELS,
  parseBookMeta,
  sanitizeDocFileName,
  type BookCreateInput,
  type BookCreateResult,
  type BookDataReadResult,
  type BookDataWriteResult,
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
  isBookDataKey,
  readBookData,
  readDocFile,
  scanBook,
  sortChapters,
  writeBookData,
  writeBookMetaFile,
  writeDocFile,
  type AtomicWriteFs
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
  /**
   * 读这本书里的设定数据（2026-10-09 扫描总单 P0-7）。
   *
   * 入参写成 `unknown` 是刻意的：这条通路跨进程而来，键与 JSON 文本都不能假定合法，
   * 主进程自己按白名单认。没开书时回 `no-book` 而不是 `json:null`——见 contracts 里那四档的分工。
   */
  readData(key: unknown): Promise<BookDataReadResult>;
  /** 写某一枚键；失败带原因回来，由渲染层显示。这里绝不 `catch {}`（P0-2 那条病）。 */
  writeData(key: unknown, json: unknown): Promise<BookDataWriteResult>;
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
  // 设定数据这两条**不把参数 cast 成 string 再交给 service**：键与文本都要由 service 按 unknown
  // 判一遍（白名单、有没有开书）。在这里 `as BookDataKey` 等于把判定推到调用方，白名单就白了。
  ipcMain.handle(IPC_CHANNELS.bookDataRead, (_event, key) => service.readData(key));
  ipcMain.handle(IPC_CHANNELS.bookDataWrite, (_event, key, json) => service.writeData(key, json));
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
  /**
   * 写盘用的那份 fs（2026-10-09 全仓扫描 P0-1）。
   *
   * 不传就是产品默认那份（真文件系统 + 原子写）。做成可注入的唯一理由是：本体要防的失败
   * 是「某一次系统调用抛错」，真文件系统上复现不了，只能在测试里注入「只坏一步」的实现，
   * 然后断言**盘上到底剩了什么**。产品装配点不传它——所以传不传下去本身就是一条可测的接线。
   */
  fs?: AtomicWriteFs;
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
      const skeleton = await createBookSkeleton(directory, meta, deps.fs);
      if (!skeleton.ok) return { ok: false, message: skeleton.message };
      return { ok: true, book: await this.open(directory) };
    },

    async saveMeta(meta: BookMeta) {
      if (snapshot === null) throw new Error("尚未打开作品目录，无法保存 book.json");
      // 原子写（P0-1）：book.json 是这本书的门牌，半截 JSON 会让「正文一篇没丢」变成「书打不开」。
      // 形状与写法都住在 fs-store 的 `book-meta` 那一处，主进程不再自己 stringify（铁律 6）。
      // 只有写成功才刷新快照：否则界面上显示的是新书名/新权限档，盘上还是旧的，两处从此分家。
      const parsed = await writeBookMetaFile(snapshot.root, meta, deps.fs);
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
      return writeDocFile(snapshot.root, relPath, content, expectedFingerprint, retention, deps.fs);
    },

    async createDoc(relPath, title) {
      if (snapshot === null)
        return { ok: false, reason: "no-book", message: "尚未打开作品目录，建不了新文档。" };
      const cleanTitle = sanitizeDocFileName(title);
      if (cleanTitle === null)
        return { ok: false, reason: "invalid-path", message: "标题起不了文件名，换一个名字。" };
      const result = await createDocFile(snapshot.root, relPath, cleanTitle, deps.fs);
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

    async readData(key: unknown) {
      if (!isBookDataKey(key)) {
        return {
          ok: false,
          reason: "invalid-key",
          message: `不在设定数据白名单里：${String(key)}`
        };
      }
      if (snapshot === null) {
        // 刻意不说「没有」：渲染层把 no-book 读成空库，就会把上一本书的内容当成这一本的迁进来。
        return { ok: false, reason: "no-book", message: "还没打开作品目录，读不到这本书的设定。" };
      }
      return readBookData(snapshot.root, key);
    },

    async writeData(key: unknown, json: unknown) {
      if (!isBookDataKey(key)) {
        return {
          ok: false,
          reason: "invalid-key",
          message: `不在设定数据白名单里：${String(key)}`
        };
      }
      if (typeof json !== "string") {
        return { ok: false, reason: "not-json", message: "要写的不是一段文本。" };
      }
      if (snapshot === null) {
        return { ok: false, reason: "no-book", message: "还没打开作品目录，设定没地方落。" };
      }
      // deps.fs 一路传到设定写盘：产品装配点注入的那份 fs 与正文写盘是同一份（铁律 6）。
      return writeBookData(snapshot.root, key, json, deps.fs);
    },

    async close() {
      snapshot = null;
    }
  };
}
