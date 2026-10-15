import { vi, type Mock } from "vitest";
import {
  DEFAULT_CHANGE_RETENTION,
  DEFAULT_PERMISSION_MODE,
  type BookCreateInput,
  type BookCreateResult,
  type BookDataKey,
  type BookDataReadResult,
  type BookDataWriteResult,
  type BookMeta,
  type BookOpenResult,
  type DocWriteResult,
  type FlushQuitReply,
  type RendererApi
} from "@mochen/contracts";

/**
 * 「丢字」这三条用例（P0-2 / P0-3 / P0-6）共用的渲染层 API 假身。
 *
 * 只铺 book 这一侧用得上的通道：`readDoc` / `writeDoc` 是可编程的，其余一律「不该被调到」。
 * 之所以在 store 用例里注入假 fs：本体要防的失败是**某一次写盘抛错**，真文件系统复现不了，
 * 而 store 这一层要钉的是「IPC 抛错时 saving/notice/标签各停在什么位置」。
 */
export const DRAFT_A = "chapters/01-a.md";
export const DRAFT_B = "chapters/02-b.md";

export const draftBook: BookOpenResult = {
  rootPath: "/book",
  meta: {
    id: "b1",
    title: "深渊之下",
    schemaVersion: 1,
    stages: [{ id: "draft", name: "正文" }],
    activeStage: "draft",
    permissionMode: DEFAULT_PERMISSION_MODE,
    chapterOrder: [DRAFT_A]
  },
  docs: [
    { relPath: DRAFT_A, kind: "chapter", title: "开局" },
    { relPath: DRAFT_B, kind: "chapter", title: "第二篇" }
  ]
};

/**
 * `writeDoc` 假身的过程类型：`Mock<>` 与 `vi.fn<>` 两处共用这一份参数表。
 * 原先写的是 `WriteDocMock["MockProcedure"]`——vitest 3 的 `Mock` 上没有这个成员，
 * vitest 全绿也照样带着它（跑的是编译后的 JS），只有 tsc 关卡抓得到（本轮实测）。
 */
type WriteDocProcedure = (
  relPath: string,
  content: string,
  expectedFingerprint: string
) => Promise<DocWriteResult>;

export type WriteDocMock = Mock<WriteDocProcedure>;

export type BookApiFixture = {
  api: RendererApi;
  writeDoc: WriteDocMock;
  readDoc: Mock<
    (relPath: string) => Promise<{ relPath: string; content: string; fingerprint: string }>
  >;
  prefs: Map<string, string>;
  /**
   * 主进程发来的「先把稿子落盘」监听器（P0-6 握手）。用例用 `fireQuitFlush()` 点火，
   * 再断言 `quitFlushDone` 收到了什么——这条通路的终点是回程载荷，不是屏上的 notice。
   */
  quitRequests: (() => void)[];
  quitFlushDone: Mock<(reply: FlushQuitReply) => Promise<void>>;
  /** book.json 的落盘通道（见 createBookApi 里那段注释）。 */
  saveMeta: Mock<(meta: BookMeta) => Promise<void>>;
  /** 设定读写（P0-7）：换书那道闸的用例点名它们。 */
  readBookData: Mock<(key: BookDataKey) => Promise<BookDataReadResult>>;
  writeBookData: Mock<(key: BookDataKey, json: string) => Promise<BookDataWriteResult>>;
  createBook: Mock<(input: BookCreateInput) => Promise<BookCreateResult>>;
};

/** 默认写成：用例用 `writeDoc.mockRejectedValueOnce` / `mockResolvedValueOnce` 改道。 */
export function createBookApi(): BookApiFixture {
  const prefs = new Map<string, string>();
  const quitRequests: (() => void)[] = [];
  const writeDoc = vi.fn<WriteDocProcedure>(async (): Promise<DocWriteResult> => ({
    ok: true,
    fingerprint: "fp-next",
    backupRelPath: null
  }));
  const readDoc = vi.fn(async (relPath: string) => ({
    relPath,
    content: "正文\n",
    fingerprint: "fp-a"
  }));
  const offLimits = (name: string) =>
    vi.fn(async () => {
      throw new Error(`useBookStore 不该调用 ${name}`);
    });
  /**
   * book.json 的落盘通道（权限档、工作模式、阶段、档案、章节次序都走它）。
   * 与 writeDoc 同法暴露出来：用例要把它改道成「抛错」或「挂住不回来」——
   * 章节重排那组用例钉的正是「落盘没成功之前屏上不许跟着动」，匿名留在对象里就没法点火。
   */
  const saveMeta = vi.fn<(meta: BookMeta) => Promise<void>>(async () => {});

  /**
   * 设定数据落盘通路（P0-7）。默认「盘上没有这类数据」——book 这一侧的用例
   * 关心的不是设定内容，而是**换书前有没有先把上一本的设定交回去**，
   * 所以这两枚和方法本身都点名暴露给那条用例。
   */
  const readBookData = vi.fn(async (): Promise<BookDataReadResult> => ({ ok: true, json: null }));
  const writeBookData = vi.fn(async (): Promise<BookDataWriteResult> => ({ ok: true }));
  /** 新建一本书：默认仍然「不该被调到」，用例用 mockResolvedValueOnce 改道。 */
  const createBook = vi.fn(async (): Promise<BookCreateResult> => {
    throw new Error("useBookStore 不该调用 createBook");
  });

  const api = {
    pickBookDirectory: vi.fn(async (): Promise<string | null> => "/book"),
    openBook: vi.fn(async () => draftBook),
    createBook,
    saveMeta,
    readDoc,
    writeDoc,
    createDoc: offLimits("createDoc"),
    readBookData,
    writeBookData,
    appearanceGet: offLimits("appearanceGet"),
    appearanceSave: offLimits("appearanceSave"),
    startTurn: offLimits("startTurn"),
    interruptTurn: offLimits("interruptTurn"),
    decideProposal: offLimits("decideProposal"),
    proposalDiff: offLimits("proposalDiff"),
    loadSession: offLimits("loadSession"),
    listSessions: vi.fn(async () => []),
    contextPreview: offLimits("contextPreview"),
    providerView: offLimits("providerView"),
    providerSave: offLimits("providerSave"),
    providerConnectionRemove: offLimits("providerConnectionRemove"),
    providerVerify: offLimits("providerVerify"),
    openProviderKeyPage: offLimits("openProviderKeyPage"),
    openWebSource: offLimits("openWebSource"),
    listModels: offLimits("listModels"),
    profileUpsert: offLimits("profileUpsert"),
    profileRemove: offLimits("profileRemove"),
    profileEnable: offLimits("profileEnable"),
    onAgentEvent: vi.fn(() => () => {}),
    // 退出握手：订阅收进 quitRequests，回程进 quitFlushDone，两个都由用例点名。
    onQuitFlushRequest: vi.fn((listener: () => void) => {
      quitRequests.push(listener);
      return () => {
        const at = quitRequests.indexOf(listener);
        if (at >= 0) quitRequests.splice(at, 1);
      };
    }),
    quitFlushDone: vi.fn(async (): Promise<void> => {}),
    saveFile: offLimits("saveFile"),
    buildExport: offLimits("buildExport"),
    listChanges: vi.fn(async () => []),
    readChange: offLimits("readChange"),
    diffChange: offLimits("diffChange"),
    restoreChange: offLimits("restoreChange"),
    notify: vi.fn(),
    listSkills: offLimits("listSkills"),
    readSkill: offLimits("readSkill"),
    changesRetentionGet: async () => ({ persisted: false, retention: DEFAULT_CHANGE_RETENTION }),
    changesRetentionSave: async (retention: typeof DEFAULT_CHANGE_RETENTION) => retention,
    changesPruneNow: async () => ({ removed: 0, kept: 0, freedBytes: 0, keptBytes: 0 }),
    listMarket: async () => ({ entries: [], listed: false, notice: "" }),
    installMarketSkill: offLimits("installMarketSkill"),
    uninstallMarketSkill: offLimits("uninstallMarketSkill"),
    listPlugins: async () => ({ entries: [], listed: true }),
    togglePlugin: offLimits("togglePlugin"),
    uninstallPlugin: offLimits("uninstallPlugin"),
    readPluginSource: offLimits("readPluginSource"),
    // 只重算一篇（2026-10-10 P1-4 后半）与回收站三条、更新检查（同日）：satisfies 在场即可，
    // 这份夹具的路上一个都不该被调到——offLimits 让越界当场喊出来。
    refreshDoc: offLimits("refreshDoc"),
    trashDoc: offLimits("trashDoc"),
    listTrash: offLimits("listTrash"),
    restoreTrash: offLimits("restoreTrash"),
    createBookBackup: offLimits("createBookBackup"),
    listBookBackups: offLimits("listBookBackups"),
    restoreBookBackup: offLimits("restoreBookBackup"),
    updateCheck: offLimits("updateCheck"),
    importTxtPreview: offLimits("importTxtPreview"),
    importTxtCommit: offLimits("importTxtCommit"),
    replaceAllInBook: offLimits("replaceAllInBook"),
    // WebDAV 远程备份（2026-10-15）：这条路上一个都不该被调到——谁真要用它在用例里显式铺好 mock。
    webdavConfigGet: offLimits("webdavConfigGet"),
    webdavConfigSave: offLimits("webdavConfigSave"),
    webdavVerify: offLimits("webdavVerify"),
    webdavPush: offLimits("webdavPush"),
    webdavList: offLimits("webdavList"),
    webdavPull: offLimits("webdavPull")
  } satisfies RendererApi;

  return {
    api,
    writeDoc,
    readDoc,
    prefs,
    quitRequests,
    saveMeta,
    readBookData,
    writeBookData,
    createBook,
    quitFlushDone: api.quitFlushDone
  };
}

/** 把假身挂到 window 上：localStorage 用一份 Map，自动保存档位因此可控。 */
export function stubBookWindow(fixture: BookApiFixture): void {
  vi.stubGlobal("window", {
    mochen: fixture.api,
    localStorage: {
      getItem: (key: string) => fixture.prefs.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        fixture.prefs.set(key, value);
      },
      removeItem: (key: string): void => {
        fixture.prefs.delete(key);
      }
    }
  });
}
