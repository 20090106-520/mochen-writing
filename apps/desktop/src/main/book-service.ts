import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  DEFAULT_BOOK_STAGES,
  DEFAULT_PERMISSION_MODE,
  IPC_CHANNELS,
  normalizeBookProject,
  parseBookMeta,
  planDocRelPath,
  sanitizeDocFileName,
  windowsReservedNameProblem,
  type BookCreateInput,
  type BookCreateResult,
  type BookDataReadResult,
  type BookDataWriteResult,
  type BookDigest,
  type BookMeta,
  type BookOpenResult,
  type BookReplaceResult,
  type DocContent,
  type DocCreateResult,
  type DocRenameResult,
  type DocRefreshResult,
  type DocRef,
  type DocWriteResult
} from "@mochen/contracts";
import {
  assertSafeRelPath,
  createBookSkeleton,
  createDocFile,
  docRefFor,
  isBookDataKey,
  kindOfRelPath,
  readBookData,
  readDocFile,
  renameDocFile,
  scanBook,
  sortChapters,
  writeBookData,
  writeBookMetaFile,
  writeDocFile,
  type AtomicWriteFs
} from "@mochen/fs-store";
import type { BookTrashResult } from "@mochen/contracts";
// 会话文件迁移（2026-11-20 P0）：改章节文件名时同批迁该章的 AI 历史，真身判据只有 agent-runtime 那一份。
import { renameSessionsForDoc } from "@mochen/agent-runtime";
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
  /**
   * 删除作品（2026-11-24）：把整本书目录移进系统回收站。
   * 删的是当前打开的书时先关书（快照清空）再删——删完当前书根下的会话、设定全都随目录进回收站，
   * 主进程绝不能再持有那份快照（否则 agent 工具还在对一本已删除的书读写）。
   */
  trash(rootPath: string): Promise<BookTrashResult>;
  saveMeta(meta: BookMeta): Promise<void>;
  /**
   * 只把一章的摘要并进 `book.json`（2026-11-20 审计 R-4）。
   *
   * 章末摘要是后台旁路，生成要几十秒；这期间用户完全可能在设置里改书名、阶段、技能开关。
   * 此前摘要拿「生成前那份 meta」整份回写，会把用户那次改动静默回滚。这里只并 `recaps` 一格，
   * 且**在队列里现取最新 meta**——`saveMeta` 与它共用同一条写队列，不会交错落盘。
   * 没开书 / 换书后取不到原书根 ⇒ 安静丢弃（摘要丢一次比写进别人书里轻得多）。
   */
  mergeRecaps(relPath: string, text: string): Promise<void>;
  /**
   * 只把全书状态并进 `book.json`（2026-11-20）。
   *
   * 与 `mergeRecaps` 完全同构：现取最新 meta、只并 `digest` 一格、跨书安静丢弃。
   * 状态卡也是几十秒后才回来，整份回写会把用户这期间的设置改动一起回滚。
   */
  mergeDigest(digest: BookDigest): Promise<void>;
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
   * 改文件名（2026-11-20）。现有的「改标题」只动 frontmatter，文件名与 relPath 不变；
   * 这一条把文件真的改名，并在同一处迁移 `chapterOrder` / `recaps` 两处键，回执带新 meta。
   */
  renameDoc(relPath: string, title: string): Promise<DocRenameResult>;
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
  hooks: {
    onOpened?: (book: BookOpenResult) => void | Promise<void>;
    onTrashed?: (rootPath: string) => void | Promise<unknown>;
  } = {}
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
  // 删除作品（2026-11-24）：删除成功后清单同步移除该条——记账与删除是同一件事的两半，
  // 分到两处就会出现「书没了、清单还在」的假条目（点开 = openBook 抛错）。
  handleTrusted(register, IPC_CHANNELS.bookTrash, async (_event, rootPath) => {
    const result = await service.trash(rootPath as string);
    if (result.ok) await hooks.onTrashed?.(rootPath as string);
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
  // 改文件名（2026-11-20）：与新建同一套闸——形状 + 书内 realpath；迁移 chapterOrder/recaps 在 service 内一次做完。
  handleTrusted(
    register,
    IPC_CHANNELS.docRename,
    (_event, relPath, title) => service.renameDoc(relPath as string, title as string),
    { check: insideCurrentBook("改文件名", service) }
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
   * 回收站通路（2026-11-24）：Electron 的 `shell.trashItem`。
   * 产品装配点必须注入（index.ts）；**刻意不做必填**——37 处既有测试夹具会全体撞红，
   * 而缺省的失败模式要 fail closed：`trash()` 在没通路时回一句中文错误，**绝不降级成直删**。
   */
  trashItem?: (path: string) => Promise<void>;
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
  /**
   * `book.json` 的写入队列（审计 R-4）。
   *
   * 两条通路都写同一份 meta：用户保存设置（`saveMeta`，整份）与章末摘要（`mergeRecaps`，一格）。
   * 不串行时后落的那一单会盖掉前一单，而摘要总在几十秒后才落——正好踩中用户改设置。
   * 队列头只看「这一单跑完没有」：失败也放行下一单，错误仍由各自那一单抛给调用方。
   */
  let metaWrites: Promise<void> = Promise.resolve();
  function enqueueMetaWrite(task: () => Promise<void>): Promise<void> {
    const next = metaWrites.then(task);
    metaWrites = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

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

    /**
     * 删除作品（2026-11-24）：整本书目录移进系统回收站。
     *
     * 顺序是硬的：**先关书、后删目录**。反过来的话，回收站写盘的那几百毫秒里主进程
     * 快照还指着这个根——agent 工具此刻对它的一次写就是往一个正在消失的目录里落字节。
     * 删别的书不动当前快照：当前书原样还在，与 openBookInto 的「失败不动状态」同一口径。
     * 失败时不改任何状态：trashItem 抛错多半是目录被占用（资源管理器开着、杀软扫描），
     * 书还在原位，用户看到人话重试即可。
     */
    async trash(rootPath) {
      const directory = typeof rootPath === "string" ? rootPath.trim() : "";
      if (directory === "") return { ok: false, message: "还没说要删哪一本。" };
      // 没通路就拒绝：装配点忘了注入 shell 时，删除必须「做不了」，而不是「换个方式硬删」。
      if (deps.trashItem === undefined)
        return { ok: false, message: "删除作品的回收站通路没有接上，暂时删不了。" };
      const current = snapshot;
      const closing = current !== null && current.root === directory;
      if (closing) snapshot = null;
      try {
        await deps.trashItem(directory);
      } catch (error) {
        // 删失败要原样恢复关掉的那本书吗？不：快照的正文读数可能已过期，且此刻目录还在盘上，
        // 渲染层走一次 openBook 就能回来——不装作「什么都没发生」，也不留半套状态。
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, message: `没能把这本书移进回收站：${message}` };
      }
      return { ok: true };
    },

    async saveMeta(meta: BookMeta) {
      const root = snapshot?.root;
      if (root === undefined) throw new Error("尚未打开作品目录，无法保存 book.json");
      await enqueueMetaWrite(async () => {
        const current = snapshot;
        // 排队期间换了书 / 关了书：这一单带的是上一本的整份 meta，落进新书会把两本书搅在一起。
        if (current === null || current.root !== root) {
          throw new Error("书已经换过或关闭，这次设置没有保存。");
        }
        // 原子写（P0-1）：book.json 是这本书的门牌，半截 JSON 会让「正文一篇没丢」变成「书打不开」。
        // 形状与写法都住在 fs-store 的 `book-meta` 那一处，主进程不再自己 stringify（铁律 6）。
        // 只有写成功才刷新快照：否则界面上显示的是新书名/新权限档，盘上还是旧的，两处从此分家。
        const parsed = await writeBookMetaFile(current.root, meta, deps.fs);
        snapshot = { ...current, meta: parsed };
      });
    },

    async mergeRecaps(relPath, text) {
      const root = snapshot?.root;
      if (root === undefined) return;
      await enqueueMetaWrite(async () => {
        const current = snapshot;
        // 换书 / 关书后旧摘要一律丢弃：跨书落一格比丢一次摘要严重得多。
        if (current === null || current.root !== root) return;
        const parsed = await writeBookMetaFile(
          current.root,
          { ...current.meta, recaps: { ...(current.meta.recaps ?? {}), [relPath]: text } },
          deps.fs
        );
        snapshot = { ...current, meta: parsed };
      });
    },

    async mergeDigest(digest) {
      const root = snapshot?.root;
      if (root === undefined) return;
      await enqueueMetaWrite(async () => {
        const current = snapshot;
        // 同一套跨书口径：换书 / 关书后旧状态一律丢弃，绝不写进别人的书里。
        if (current === null || current.root !== root) return;
        const parsed = await writeBookMetaFile(current.root, { ...current.meta, digest }, deps.fs);
        snapshot = { ...current, meta: parsed };
      });
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

    /**
     * 改文件名（2026-11-20）。「改标题」只动 frontmatter，这一条才是文件真的改名。
     *
     * `chapterOrder` 与 `recaps` 都以 relPath 为键：改名不一起迁，排序与章末摘要立刻成孤儿，
     * 而用户从界面上完全看不出来。迁移只在这里做一次（铁律 6），渲染层直接换掉回执里的 meta。
     */
    async renameDoc(relPath, title) {
      const current = snapshot;
      if (current === null)
        return { ok: false, reason: "no-book", message: "尚未打开作品目录，改不了文件名。" };
      try {
        assertSafeRelPath(relPath);
      } catch {
        return { ok: false, reason: "invalid-path", message: "这一篇的路径不在书里，改不了名。" };
      }
      // 与 createDoc 同一句人话、同一条判据：保留名与「起不出文件名」分成两档说清楚。
      const reserved = windowsReservedNameProblem(title);
      if (reserved !== null) return { ok: false, reason: "invalid-path", message: reserved };
      const kind =
        current.docs.find((doc) => doc.relPath === relPath)?.kind ?? kindOfRelPath(relPath);
      if (kind === null)
        return {
          ok: false,
          reason: "invalid-path",
          message: "认不出这一篇属于哪一类文稿，改不了名。"
        };
      // 目标路径一律由 contracts 规划（同目录），渲染层递不了路径。
      const nextRelPath = planDocRelPath(kind, title);
      if (nextRelPath === null)
        return { ok: false, reason: "invalid-path", message: "标题起不了文件名，换一个名字。" };
      if (nextRelPath === relPath) {
        const file = await readDocFile(current.root, relPath).catch(() => null);
        return {
          ok: true,
          relPath,
          fingerprint: file?.fingerprint ?? "",
          doc: current.docs.find((doc) => doc.relPath === relPath) ?? null,
          meta: current.meta,
          sessionWarning: null
        };
      }
      const moved = await renameDocFile(current.root, relPath, nextRelPath);
      if (!moved.ok) return moved;
      // 迁移与正文落盘共用同一条 meta 写队列：用户此刻在设置里改书名也不会被这份旧 meta 回滚。
      await enqueueMetaWrite(async () => {
        const latest = snapshot;
        // 换书 / 关书后不追写：文件已经改完，但 meta 不能写进别人的书里。
        if (latest === null || latest.root !== current.root) return;
        const chapterOrder = (latest.meta.chapterOrder ?? []).map((item) =>
          item === relPath ? nextRelPath : item
        );
        const recaps = { ...(latest.meta.recaps ?? {}) };
        const recap = recaps[relPath];
        if (recap !== undefined) {
          delete recaps[relPath];
          recaps[nextRelPath] = recap;
        }
        const meta = await writeBookMetaFile(
          latest.root,
          { ...latest.meta, chapterOrder, recaps },
          deps.fs
        );
        // 清单只换这一篇：改名是低频操作，但也没必要为它整本重扫（与 createDoc 同一条 `docRefFor`）。
        const rest = latest.docs.filter((doc) => doc.relPath !== relPath);
        const fresh = await docRefFor(latest.root, nextRelPath);
        snapshot = {
          ...latest,
          meta,
          docs: sortChapters(fresh === null ? rest : [...rest, fresh], meta.chapterOrder)
        };
      });
      // 2026-11-20 P0：会话 JSONL 的章节归属写在首行 meta 的 docRelPath 里（文件名不含 relPath），
      // 不跟着迁移，这一章的 AI 历史（面板、最近一条）就在盘上成了孤儿。放在 meta 队列之后：
      // 改名已经落盘，历史只能尽量跟上；迁移失败不改名回滚，警告捎在回执里让渲染层转述。
      const sessionWarning = await renameSessionsForDoc(current.root, relPath, nextRelPath);
      const after = snapshot;
      const sameBook = after !== null && after.root === current.root;
      return {
        ok: true,
        relPath: nextRelPath,
        fingerprint: moved.fingerprint,
        doc: sameBook ? (after.docs.find((doc) => doc.relPath === nextRelPath) ?? null) : null,
        meta: sameBook ? after.meta : current.meta,
        sessionWarning
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
