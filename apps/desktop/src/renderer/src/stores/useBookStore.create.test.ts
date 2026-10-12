import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type {
  BookCreateResult,
  BookOpenResult,
  DocCreateResult,
  DocWriteResult,
  RendererApi
} from "@mochen/contracts";
import { DEFAULT_CHANGE_RETENTION } from "@mochen/contracts";
import { useBookStore } from "./useBookStore";

/**
 * 「新建通路 + 自动保存」主题的用例（useBookStore.test.ts 超出 800 行预算后按主题拆出，拆法照
 * useAgentStore 的同例）。fixture 只留这三块用到的通道，其余一律 offLimits——通道
 * 一旦被打到就当场报错，免得用例悄悄串了别的通路还绿着。
 */
const result: BookOpenResult = {
  rootPath: "/book",
  meta: {
    id: "b1",
    title: "深渊之下",
    schemaVersion: 1,
    stages: [{ id: "draft", name: "正文" }],
    activeStage: "draft",
    permissionMode: "read-only",
    chapterOrder: ["chapters/01-a.md"]
  },
  docs: [
    { relPath: "chapters/01-a.md", kind: "chapter", title: "开局" },
    { relPath: "materials/雾.md", kind: "material", title: "雾" }
  ]
};

const readDoc = vi.fn(async (relPath: string) => ({
  relPath,
  content: "正文\n",
  fingerprint: "fp-a"
}));
// 泛型签名带上三个形参：自动保存用例要读 mock.calls 的第 0/1 格（relPath/content）。
const writeDoc = vi.fn<
  (relPath: string, content: string, expectedFingerprint: string) => Promise<DocWriteResult>
>(async (): Promise<DocWriteResult> => ({
  ok: false,
  reason: "stale",
  currentFingerprint: "fp-x"
}));
const createDocIpc = vi.fn<(relPath: string, title: string) => Promise<DocCreateResult>>(
  async (relPath) => ({
    ok: true,
    relPath,
    fingerprint: "fp-new"
  })
);
const createBookIpc = vi.fn(async (): Promise<BookCreateResult> => ({
  ok: false,
  message: "stub"
}));
function offLimits(name: string) {
  return vi.fn(async () => {
    throw new Error(`useBookStore 不该调用 ${name}`);
  });
}

const api = {
  pickBookDirectory: offLimits("pickBookDirectory"),
  openBook: vi.fn(async (): Promise<BookOpenResult> => result),
  createBook: createBookIpc,
  saveMeta: offLimits("saveMeta"),
  readDoc,
  writeDoc,
  createDoc: createDocIpc,
  startTurn: offLimits("startTurn"),
  interruptTurn: offLimits("interruptTurn"),
  decideProposal: offLimits("decideProposal"),
  proposalDiff: offLimits("proposalDiff"),
  loadSession: offLimits("loadSession"),
  listSessions: offLimits("listSessions"),
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
  appearanceGet: offLimits("appearanceGet"),
  appearanceSave: offLimits("appearanceSave"),
  onAgentEvent: vi.fn(() => {
    throw new Error("useBookStore 不该订阅 agent");
  }),
  // 退出握手（P0-6）：这些用例不该摸这条通道，一摸就抛——订阅要同步返回退订函数，故不套 offLimits。
  onQuitFlushRequest: vi.fn(() => {
    throw new Error("不该订阅退出握手");
  }),
  quitFlushDone: offLimits("quitFlushDone"),
  saveFile: vi.fn(async () => true),
  buildExport: vi.fn(async () => ({
    content: "",
    bytes: null,
    format: "markdown" as const,
    filename: "",
    byteSize: 0
  })),
  notify: vi.fn(),
  listSkills: offLimits("listSkills"),
  readSkill: offLimits("readSkill"),
  listChanges: offLimits("listChanges"),
  readChange: offLimits("readChange"),
  diffChange: offLimits("diffChange"),
  restoreChange: offLimits("restoreChange"),

  // 2026-10-06 批次 5-⑧：`satisfies RendererApi` 要求这三个通道在场，但**这个 store 一个都不用**。
  // 给的是默认档快照，所以真被调到也只会拿到「什么都没设过」这一种结果——不会让断言莫名其妙地红。
  changesRetentionGet: async () => ({ persisted: false, retention: DEFAULT_CHANGE_RETENTION }),
  changesRetentionSave: async (r) => r,
  changesPruneNow: async () => ({ removed: 0, kept: 0, freedBytes: 0, keptBytes: 0 }),
  // 技能市场三枚（2026-10-07 批次 5-㉖）：satisfies RendererApi 要求它们在场，
  // 但这些 store 一个都不用。给的是「空表 + 没问过」的默认档，
  // 真被调到也只会拿到「市场里什么都没有」这一种结果——不会让无关的断言莫名其妙地红。
  listMarket: async () => ({ entries: [], listed: false, notice: "" }),
  installMarketSkill: async () => {
    throw new Error("不该装技能");
  },
  uninstallMarketSkill: async () => {
    throw new Error("不该卸技能");
  },
  listPlugins: async () => ({ entries: [], listed: true }),
  togglePlugin: async () => {
    throw new Error("不该停用插件");
  },
  uninstallPlugin: async () => {
    throw new Error("不该卸插件");
  },
  readPluginSource: async () => {
    throw new Error("不该读插件源码");
  },
  // 设定落盘两枚（2026-10-09 扫描总单 P0-7）：建书这条路不碰书里的设定文件，
  // 给的是「越权即抛」的假身——静默返回空表会让误用变得看不见。
  readBookData: async () => {
    throw new Error("不该读书里的设定文件");
  },
  writeBookData: async () => {
    throw new Error("不该写书里的设定文件");
  }
} satisfies RendererApi;

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal("window", { mochen: api });
  // mockReset 而不是 mockClear：清掉 mockResolvedValueOnce 的排队（残留丢一次就会串进下一个用例），
  // 同时保留 vi.fn(impl) 传入的默认实现。
  readDoc.mockReset();
  writeDoc.mockReset();
  createDocIpc.mockReset();
  createBookIpc.mockReset();
  api.openBook.mockReset();
});

describe("新建通路（doc:create / book:create）", () => {
  it("createDoc：规划路径 → IPC → 温和重扫 → 打开新标签", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    api.openBook.mockClear();
    // 重扫桩：第二次 openBook 返回「盘上已多出新文件」的 docs，模拟主进程 scanBook。
    const refreshed: BookOpenResult = {
      ...result,
      docs: [...result.docs, { relPath: "chapters/第二章.md", kind: "chapter", title: "第二章" }]
    };
    api.openBook.mockResolvedValueOnce(refreshed);

    const ok = await store.createDoc("chapter", "第二章");
    expect(ok).toBe(true);
    expect(createDocIpc).toHaveBeenCalledWith("chapters/第二章.md", "第二章");
    expect(store.docs.map((doc) => doc.relPath)).toContain("chapters/第二章.md");
    expect(store.activeDocTab).toBe("chapters/第二章.md");
    expect(store.notice).toBe("已新建 chapters/第二章.md");
    expect(api.openBook).toHaveBeenCalledTimes(1); // refreshDocs 温和重扫只发生一次
  });

  it("createDoc：同名被渲染层拦截，IPC 落一个字都没落", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    const ok = await store.createDoc("chapter", "01-a");
    expect(ok).toBe(false);
    expect(store.notice).toContain("已经有同名的");
    expect(createDocIpc).not.toHaveBeenCalled();
  });

  it("createDoc：标题起不了文件名（纯点）被拦截", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    const ok = await store.createDoc("chapter", "...");
    expect(ok).toBe(false);
    expect(store.notice).toContain("起不了文件名");
    expect(createDocIpc).not.toHaveBeenCalled();
  });

  it("createDoc：主进程拒绝时如实转述理由", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    createDocIpc.mockResolvedValueOnce({
      ok: false,
      reason: "already-exists",
      message: "chapters/第二章.md 已经存在，没有覆盖它"
    });
    const ok = await store.createDoc("chapter", "第二章");
    expect(ok).toBe(false);
    expect(store.notice).toBe("chapters/第二章.md 已经存在，没有覆盖它");
  });

  it("createBook：成功后走 openBook 同款落点填充（标签、草稿清空、meta 换新）", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    createBookIpc.mockResolvedValueOnce({
      ok: true,
      book: { ...result, rootPath: "/new-book", meta: { ...result.meta, title: "新书" } }
    });
    const ok = await store.createBook("/new-book", "新书");
    expect(ok).toBe(true);
    expect(store.rootPath).toBe("/new-book");
    expect(store.meta?.title).toBe("新书");
    expect(store.docTabs).toEqual([]);
    expect(store.activeDocTab).toBeNull();
    expect(store.dirty).toBe(false);
    expect(store.notice).toContain("新书");
  });

  it("createBook：失败时 notice 带主进程理由，已有作品状态一动不动", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    const ok = await store.createBook("/occupied", "想盖过去");
    expect(ok).toBe(false);
    expect(store.notice).toBe("stub");
    expect(store.rootPath).toBe("/book");
    expect(store.activeDocTab).toBe("chapters/01-a.md");
  });

  it("refreshDocs：只更新 meta 与 docs，标签与草稿原样", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    store.onEdit("我改了一半的字");
    store.cancelAutoSave();
    api.openBook.mockResolvedValueOnce({
      ...result,
      docs: [...result.docs, { relPath: "chapters/03.md", kind: "chapter", title: "三" }]
    });
    await store.refreshDocs();
    expect(store.docs).toHaveLength(3);
    expect(store.activeDocTab).toBe("chapters/01-a.md");
    expect(store.draft).toBe("我改了一半的字");
    expect(store.dirty).toBe(true);
  });
});

describe("自动保存（dirty 防抖）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    useBookStore().cancelAutoSave();
    vi.useRealTimers();
  });

  async function openForEdit() {
    const store = useBookStore();
    await store.openBook("/book");
    await store.openDocTab("chapters/01-a.md");
    writeDoc.mockResolvedValue({ ok: true, fingerprint: "fp-saved", backupRelPath: null });
    writeDoc.mockClear();
    return store;
  }

  it("编辑后静默 2s 自动落盘：走同一条 writeDoc 指纹链，notice 说「已自动保存」", async () => {
    const store = await openForEdit();
    store.onEdit("自动保存的新字");
    expect(writeDoc).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(writeDoc).toHaveBeenCalledTimes(1);
    expect(writeDoc.mock.calls[0]?.[0]).toBe("chapters/01-a.md");
    expect(writeDoc.mock.calls[0]?.[1]).toBe("自动保存的新字");
    expect(store.dirty).toBe(false);
    expect(store.notice).toBe("已自动保存");
  });

  it("连续打字只排一次：静默窗被重置，不逐键落盘", async () => {
    const store = await openForEdit();
    store.onEdit("一");
    await vi.advanceTimersByTimeAsync(1500);
    store.onEdit("一二");
    await vi.advanceTimersByTimeAsync(1500);
    expect(writeDoc).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(writeDoc).toHaveBeenCalledTimes(1);
    expect(writeDoc.mock.calls[0]?.[1]).toBe("一二");
  });

  it("冲突挂起时不自动保存：SaveConflictDialog 在处理的事，自动保存绝不插手", async () => {
    const store = await openForEdit();
    writeDoc.mockResolvedValue({
      ok: false,
      reason: "stale",
      currentFingerprint: "fp-external"
    });
    store.onEdit("第一笔");
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.conflict).toEqual({ currentFingerprint: "fp-external" });
    writeDoc.mockClear();
    store.onEdit("第二笔");
    await vi.advanceTimersByTimeAsync(3000);
    expect(writeDoc).not.toHaveBeenCalled();
  });

  it("保存发出后又打了字：dirty 竖回来并再次排程——那几个字不能活在「已保存」的假象里", async () => {
    const store = await openForEdit();
    const pending: Array<(value: { ok: true; fingerprint: string; backupRelPath: null }) => void> =
      [];
    writeDoc.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        })
    );
    store.onEdit("先发的字");
    await vi.advanceTimersByTimeAsync(2000);
    expect(writeDoc).toHaveBeenCalledTimes(1);
    store.onEdit("先发的字，后补的几个");
    expect(store.dirty).toBe(true);
    pending.shift()?.({ ok: true, fingerprint: "fp-submitted", backupRelPath: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.dirty).toBe(true);
    expect(store.savedFingerprint).toBe("fp-submitted");
    // auto 语境里发现领先会自己重新排程，不需要新编辑。
    await vi.advanceTimersByTimeAsync(2000);
    expect(writeDoc).toHaveBeenCalledTimes(2);
    expect(writeDoc.mock.calls[1]?.[1]).toBe("先发的字，后补的几个");
    pending.shift()?.({ ok: true, fingerprint: "fp-final", backupRelPath: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.dirty).toBe(false);
  });

  it("手动保存的文案不带「自动」：同一通路，语义分开", async () => {
    const store = await openForEdit();
    store.onEdit("手动的字");
    store.cancelAutoSave();
    await store.saveActive();
    expect(store.notice).toBe("已保存");
  });
});

describe("改标题（doc:title 通路）", () => {
  const FENCED = "---\ntitle: 开局\n---\n\n正文\n";
  /** 排队丢一次：盘上是「带围栏文档」的读回；谁先读谁消费，要读几次就排几次。 */
  function queueFence(): void {
    readDoc.mockResolvedValueOnce({
      relPath: "chapters/01-a.md",
      content: FENCED,
      fingerprint: "fp-a"
    });
  }

  it("成功：读盘 → 只改 title → 指纹链写回 → 温和重扫，docs 换新", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    queueFence();
    writeDoc.mockResolvedValueOnce({ ok: true, fingerprint: "fp-t", backupRelPath: null });
    api.openBook.mockResolvedValueOnce({
      ...result,
      docs: [{ relPath: "chapters/01-a.md", kind: "chapter", title: "雨夜" }, result.docs[1]!]
    });
    const ok = await store.renameDocTitle("chapters/01-a.md", "雨夜");
    expect(ok).toBe(true);
    expect(readDoc).toHaveBeenCalledWith("chapters/01-a.md");
    expect(writeDoc).toHaveBeenCalledWith(
      "chapters/01-a.md",
      "---\ntitle: 雨夜\n---\n\n正文\n",
      "fp-a"
    );
    expect(store.refOf("chapters/01-a.md")?.title).toBe("雨夜");
    expect(store.notice).toBe("标题已改为「雨夜」");
  });

  it("干净的活动文档：改名后草稿同步成盘上新内容，指纹跟进，不留过期存档", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    queueFence();
    await store.openDocTab("chapters/01-a.md");
    queueFence();
    writeDoc.mockResolvedValueOnce({ ok: true, fingerprint: "fp-t", backupRelPath: null });
    api.openBook.mockResolvedValueOnce({
      ...result,
      docs: [{ relPath: "chapters/01-a.md", kind: "chapter", title: "雨夜" }, result.docs[1]!]
    });
    await store.renameDocTitle("chapters/01-a.md", "雨夜");
    expect(store.draft).toBe("---\ntitle: 雨夜\n---\n\n正文\n");
    expect(store.savedFingerprint).toBe("fp-t");
    expect(store.dirty).toBe(false);
  });

  it("有未保存手改的活动文档：草稿一个字不丢，挂冲突由人决定重载还是覆盖", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    queueFence();
    await store.openDocTab("chapters/01-a.md");
    store.onEdit("我改了一半的字");
    store.cancelAutoSave();
    queueFence();
    writeDoc.mockResolvedValueOnce({ ok: true, fingerprint: "fp-t", backupRelPath: null });
    api.openBook.mockResolvedValueOnce({
      ...result,
      docs: [{ relPath: "chapters/01-a.md", kind: "chapter", title: "雨夜" }, result.docs[1]!]
    });
    await store.renameDocTitle("chapters/01-a.md", "雨夜");
    expect(store.draft).toBe("我改了一半的字");
    expect(store.dirty).toBe(true);
    expect(store.conflict).toEqual({ currentFingerprint: "fp-t" });
    expect(store.notice).toBe("标题已改为「雨夜」");
  });

  it("同名与空名：当场拒绝，readDoc/writeDoc 落一个字都没落", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    expect(await store.renameDocTitle("chapters/01-a.md", "开局")).toBe(false);
    expect(store.notice).toBe("标题没变，不用改。");
    expect(await store.renameDocTitle("chapters/01-a.md", "   ")).toBe(false);
    expect(store.notice).toBe("标题不能是空的。");
    expect(readDoc).not.toHaveBeenCalled();
    expect(writeDoc).not.toHaveBeenCalled();
  });

  it("没有元数据栏的文件：拒绝并说清原因，绝不写盘", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    const ok = await store.renameDocTitle("chapters/01-a.md", "雨夜");
    expect(ok).toBe(false);
    expect(store.notice).toContain("元数据栏");
    expect(writeDoc).not.toHaveBeenCalled();
  });

  it("stale：文件刚被别处改动，notice 指路重试", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    queueFence();
    // writeDoc 默认桩就是 stale（fp-x），直接用它。
    const ok = await store.renameDocTitle("chapters/01-a.md", "雨夜");
    expect(ok).toBe(false);
    expect(store.notice).toBe("标题没改成：文件刚被别处改动，再试一次。");
  });

  it("浏览标签里的旧 DocRef 也换新：右栏浏览态不显示旧标题", async () => {
    const store = useBookStore();
    await store.openBook("/book");
    const fog = store.refOf("materials/雾.md")!;
    store.browse(fog);
    readDoc.mockResolvedValueOnce({
      relPath: "materials/雾.md",
      content: "---\ntitle: 雾\n---\n\n",
      fingerprint: "fp-f"
    });
    writeDoc.mockResolvedValueOnce({ ok: true, fingerprint: "fp-g", backupRelPath: null });
    api.openBook.mockResolvedValueOnce({
      ...result,
      docs: [result.docs[0]!, { relPath: "materials/雾.md", kind: "material", title: "浓雾" }]
    });
    await store.renameDocTitle("materials/雾.md", "浓雾");
    expect(store.browseTabs.find((doc) => doc.relPath === "materials/雾.md")?.title).toBe("浓雾");
  });
});
