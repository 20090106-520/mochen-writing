import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  DEFAULT_BOOK_STAGES,
  DEFAULT_PERMISSION_MODE,
  IPC_CHANNELS,
  normalizeBookProject,
  parseBookMeta,
  sanitizeDocFileName,
  windowsReservedNameProblem,
  type BookCreateInput,
  type BookCreateResult,
  type BookDataReadResult,
  type BookDataWriteResult,
  type BookMeta,
  type BookOpenResult,
  type BookReplaceResult,
  type DocContent,
  type DocCreateResult,
  type DocRefreshResult,
  type DocRef,
  type DocWriteResult
} from "@mochen/contracts";
import {
  createBookSkeleton,
  createDocFile,
  docRefFor,
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
// 来源闸 + 参数形状 + 书根 realpath 判定：判据只有这一份，注册点只调不改写（P1-7）。
import { handleTrusted, relPathStaysInsideRoot, type IpcRegistrar } from "./ipc-guard.js";
// 全书替换的循环住在自己那个模块里（与 book-backup / doc-trash 同一安排）：
// 这一段是「很多篇各自的一次写」，凑进 book-service 只会让这一份越写越长。
import { replaceAcrossBook } from "./book-replace.js";

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
  /**
   * 全书替换（2026-10-15）：按当前快照逐篇「读 → 换 → 写」，回执如实分报。
   * 入参按 unknown 收——形状（有没有 query/replacement）由 `replaceAcrossBook` 自己判，
   * 不在注册点 cast 成类型（那样等于把判定推回给调用方）。
   */
  replaceAllInBook(input: unknown): Promise<BookReplaceResult>;
  /** 按规划好的书内路径建一篇空文档；relPath 由渲染层用 contracts 的 planDocRelPath 生成，这里兜底再验一遍。 */
  createDoc(relPath: string, title: string): Promise<DocCreateResult>;
  /**
   * 只重算**一篇**文稿的 DocRef（`doc:refresh`，P1-4 后半）。
   *
   * 与 `createDoc` 用同一份判据（fs-store 的 `docRefFor`，也就是 `scanBook` 那一份），
   * 算出来同时换掉自己快照里那一根——渲染层的树与主进程 agent 工具看到的清单因此是同一时刻的真值。
   */
  refreshDoc(relPath: string): Promise<DocRefreshResult>;
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
  service: BookService,
  /**
   * 打开 / 新建成功那一刻的旁路（2026-10-21 作品库）。
   *
   * 记账点只能在这里：`book:open` 与 `book:create` 是「打开过哪本」的唯一真身，
   * 放到渲染层再报一次就是第二种通路（而且换渲染层存储就全丢）。
   * 【2026-10-22 窄窗走查】回调改成**可等待**（`void | Promise<void>`）并在回执前等它落地：
   * 此前是同步 void + 装配处 fire-and-forget，`book:recent` 可能在清单写完之前就被读走
   * ⇒ 渲染层镜像读到的仍是旧清单，刚打开的这一本不入库（重启后才补上）。
   * 等待不会把开书拖失败：清单那头的读写错误一律在 store 内部咽掉（见 recent-books-store）。
   */
  hooks: { onOpened?: (book: BookOpenResult) => void | Promise<void> } = {}
): void {
  // 【2026-10-10 全仓扫描 P1-7】这八条原先一律写成 `(_event, …)`：主进程从不问「这条是谁发的」，
  // 于是 `book:open` 收来的 string 会被当成**绝对路径**直接去读 `book.json`。
  // 来源与参数形状的判定只在 `ipc-guard.ts` 有一份，这里只负责「注册」和「当前这本书的根在哪」。
  const register: IpcRegistrar = (channel, fn) => ipcMain.handle(channel, fn);

  handleTrusted(register, IPC_CHANNELS.bookOpen, async (_event, rootPath) => {
    const opened = await service.open(rootPath as string);
    await hooks.onOpened?.(opened);
    return opened;
  });
  handleTrusted(register, IPC_CHANNELS.bookCreate, async (_event, input) => {
    const result = await service.createBook(input as BookCreateInput);
    if (result.ok) await hooks.onOpened?.(result.book);
    return result;
  });
  handleTrusted(register, IPC_CHANNELS.bookSaveMeta, (_event, meta) =>
    service.saveMeta(meta as BookMeta)
  );
  handleTrusted(register, IPC_CHANNELS.docRead, (_event, relPath) =>
    service.readDoc(relPath as string)
  );
  handleTrusted(
    register,
    IPC_CHANNELS.docWrite,
    (_event, relPath, content, expectedFingerprint) =>
      service.writeDoc(relPath as string, content as string, expectedFingerprint as string),
    { check: insideCurrentBook("存稿", service) }
  );
  handleTrusted(
    register,
    IPC_CHANNELS.docCreate,
    (_event, relPath, title) => service.createDoc(relPath as string, title as string),
    { check: insideCurrentBook("新建文稿", service) }
  );
  // 只重算一篇（P1-4 后半）：新开的通道一律按最严的现有判据挂闸——形状 + 书内 realpath，
  // 不继承 `doc:read` 当年的历史遗漏（那条要不要补记在扫描总单 P1-7 的后续里）。
  handleTrusted(
    register,
    IPC_CHANNELS.docRefresh,
    (_event, relPath) => service.refreshDoc(relPath as string),
    { check: insideCurrentBook("重算文稿", service) }
  );
  // 全书替换（2026-10-15）：**不挂 insideCurrentBook**——闸把 args[0] 当 relPath 看，
  // 这条通道递来的是一个对象，取出来是空串，会被判成「书外」而一律拒。
  // 要动哪几篇由主进程自己的快照决定，每一篇在读写时仍各自过一遍 realpath 闸（fs-store 那一层）。
  handleTrusted(register, IPC_CHANNELS.bookReplaceAll, (_event, input) =>
    service.replaceAllInBook(input)
  );
  // 设定数据这两条**不把参数 cast 成 string 再交给 service**：键与文本都要由 service 按 unknown
  // 判一遍（白名单、有没有开书）。在这里 `as BookDataKey` 等于把判定推到调用方，白名单就白了。
  handleTrusted(register, IPC_CHANNELS.bookDataRead, (_event, key) => service.readData(key));
  handleTrusted(register, IPC_CHANNELS.bookDataWrite, (_event, key, json) =>
    service.writeData(key, json)
  );
}

/**
 * 「这一条 `doc:*` 只能落在当前那本书的目录里面」——realpath 级。
 *
 * 为什么 fs-store 那层词法检查不够（P1-7 后半段）：`chapters/01.md` 完全可能是个指向
 * `<appData>/plugins/x/index.js` 的软链，逐字形状检查全对；而插件目录里的 js 会被 `plugins:list`
 * 的 `import()` 执行 ⇒ 渲染层递一次路径就能在主进程跑任意代码。
 *
 * 没开书时放行（返回 null）：「没开书」该回什么形状归 service 自己定（`writeDoc` 回 io-error、
 * `createDoc` 回 no-book），闸不替它编第四种理由。
 */
function insideCurrentBook(
  label: string,
  service: BookService
): (args: unknown[]) => Promise<string | null> {
  return async (args) => {
    const snapshot = service.current();
    if (snapshot === null) return null;
    const rel = typeof args[0] === "string" ? args[0] : "";
    if (await relPathStaysInsideRoot(snapshot.root, rel)) return null;
    return `这条${label}的路径落在这本书外面（书根 ${snapshot.root}，递来的 ${rel === "" ? "空路径" : rel}）：软链与越界都按写不到书外处理。`;
  };
}

/**
 * 把「刚重算出来的那一篇」换进快照，返回新快照（P1-4 后半，`createDoc` 与 `refreshDoc` 共用）。
 *
 * 为什么要有这一个函数而不是两处各写一遍：`doc:create` 与 `doc:refresh` 都在做同一件事——
 * 用 `docRefFor` 的成品替换树里同 `relPath` 的那一根，再让整棵树照 `chapterOrder` 落位。
 * 两处各写一遍就会出现「建章会去重、重算不去重」这种分叉（铁律 6）。
 * 落位本身用的是 contracts 的 `sortDocs`（fs-store 的 `sortChapters` 只是它的别名），
 * 与渲染层拼树走的是同一个函数，所以「主进程的树」与「渲染层的树」不会判出两种顺序。
 */
function withFreshDocRef(current: BookSnapshot, fresh: DocRef): BookSnapshot {
  // 同 relPath 以新值为准：重名建章已被 createDocFile 的 already-exists 挡住，这里是防外力的第二层。
  return {
    ...current,
    docs: sortChapters(
      [...current.docs.filter((doc) => doc.relPath !== fresh.relPath), fresh],
      current.meta.chapterOrder
    )
  };
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
      // 默认阶段取 contracts 的 DEFAULT_BOOK_STAGES（2026-11-12 收上来）：出厂技能的 frontmatter
      // `stage` 也读这同一份的第一枚 name——技能推荐比的是阶段名，两处各写一份就会永不命中。
      // 立项六格（W-07）：主进程再做一次归一化，不信任跨进程来的形状；
      // 六格全空或没传 ⇒ 不写这一格，建书结果与旧流程逐字一致。
      const project = normalizeBookProject(input?.project);
      const meta = parseBookMeta({
        id: randomUUID(),
        title,
        schemaVersion: 1,
        stages: DEFAULT_BOOK_STAGES.map((stage) => ({ ...stage })),
        activeStage: DEFAULT_BOOK_STAGES[0]!.id,
        permissionMode: DEFAULT_PERMISSION_MODE,
        chapterOrder: [],
        ...(project === undefined ? {} : { project })
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

    async replaceAllInBook(input) {
      if (snapshot === null)
        return {
          ok: false,
          reason: "no-book",
          message: "尚未打开作品目录，全书替换没有可动的文稿。"
        };
      // 上限取哪一份、每一篇怎么读怎么写，全在 `replaceAcrossBook` 一处（与 `writeDoc` 同一条链子：
      // readDocFile / writeDocFile 自带 realpath 闸、指纹守卫、整篇备份与原子写），这里只把「当前这本书」递给它。
      return replaceAcrossBook(input, {
        root: snapshot.root,
        docs: snapshot.docs,
        retention: deps.retention,
        // `exactOptionalPropertyTypes` 下 `{ fs: undefined }` 不是「没传 fs」：只在真有值时才带上这一项。
        ...(deps.fs === undefined ? {} : { fs: deps.fs })
      });
    },

    async createDoc(relPath, title) {
      if (snapshot === null)
        return { ok: false, reason: "no-book", message: "尚未打开作品目录，建不了新文档。" };
      // 先单问一次保留名（P2-2 的后半）：`sanitizeDocFileName` 对保留名也回 null，但那是「起不出文件名」
      // 这一档的笼统理由。用户撞上的时候需要知道**为什么**起不出来——那句人话的真身在 contracts，
      // 这里只是把它递上屏，不另编第二份文案。
      const reserved = windowsReservedNameProblem(title);
      if (reserved !== null) return { ok: false, reason: "invalid-path", message: reserved };
      const cleanTitle = sanitizeDocFileName(title);
      if (cleanTitle === null)
        return { ok: false, reason: "invalid-path", message: "标题起不了文件名，换一个名字。" };
      const result = await createDocFile(snapshot.root, relPath, cleanTitle, deps.fs);
      if (!result.ok) return result;
      // P1-4（2026-10-09 全仓扫描）：这一行过去是 `sortChapters(await scanBook(snapshot.root), …)`——
      // 建一章把**整本**读一遍。1000 章 × 3000 字（盘上 8.66 MB）实测整本重扫 99–136 ms，
      // 而只算新那一篇的 docRefFor 是 1 ms（夹具与数字记在扫描总单 P1-4 那一行）。
      // 现在只算新那一篇：判据仍是 fs-store 的 `docRefFor`，与 `scanBook` 同一份（铁律 6，不另立第二套
      // title/excerpt/chars 口径），落位仍由同一条 `sortChapters` 决定（主进程不自己排）。
      const fresh = await docRefFor(snapshot.root, relPath);
      if (fresh !== null) {
        snapshot = withFreshDocRef(snapshot, fresh);
        return { ok: true, relPath, fingerprint: result.fingerprint, doc: fresh };
      }
      // 刚写完却读不回这一篇（盘被外部改动、权限、杀软占用……）：退回整本重扫。
      // 这条兜底不装作免费——它确实要读全本书，但它只在异常路径上烧，烧完 docs 仍是真数据；
      // 另一条路（拿文件名倒推一个 DocRef 挂上去）会让界面显示「有这一章」而盘上读不到，两处从此分家。
      const rescan = sortChapters(await scanBook(snapshot.root), snapshot.meta.chapterOrder);
      snapshot = { ...snapshot, docs: rescan };
      // 带回给渲染层的那一根取自**排好序的快照**，不是另算一次：两处必须同值（P1-4 后半的用例钉着）。
      // 找不到（重扫也没它）就如实递 null，让渲染层自己重扫——不许在这儿倒推一根盘上没有的稿件。
      return {
        ok: true,
        relPath,
        fingerprint: result.fingerprint,
        doc: rescan.find((doc) => doc.relPath === relPath) ?? null
      };
    },

    async refreshDoc(relPath) {
      if (snapshot === null)
        return { ok: false, reason: "no-book", message: "还没打开作品目录，重算不了这一篇。" };
      // 一份判据：与 scanBook / createDoc 同一条 `docRefFor`（title / excerpt / chars 都不在这儿重算口径）。
      const fresh = await docRefFor(snapshot.root, relPath);
      if (fresh === null) {
        // 盘上没有这一篇（外力删了、目录不是文稿目录）：如实递 null。文件读不到却说「有这么一篇、
        // 标题就是文件名」＝造假稿件，正是 P0 那批反复钉的病。
        return { ok: true, doc: null };
      }
      snapshot = withFreshDocRef(snapshot, fresh);
      return { ok: true, doc: fresh };
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
