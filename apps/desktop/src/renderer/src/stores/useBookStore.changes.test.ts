/**
 * 改稿历史与回滚的**行为**测试（2026-10-05）。
 *
 * 接线契约在 `components/change-history-wiring.test.ts`（读源码钉「按钮调了谁」），
 * 这里钉的是真动作跑起来之后的状态：指纹现读现传、竞态下不摆错内容、以及**回滚成功的提示
 * 必须是最后写进 notice 的那一条**。
 *
 * 最后这条是 CDP 真机跑出来的：回滚确实成功了，但 `reloadActive()` 紧接着把 notice 改写成
 * 「已重载盘上内容」，用户从头到尾没看见「已回滚」三个字——功能对了，告知丢了。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  DEFAULT_CHANGE_RETENTION,
  DEFAULT_PERMISSION_MODE,
  type BookOpenResult,
  type ChangeEntry,
  type DocWriteResult,
  type RendererApi
} from "@mochen/contracts";
import { useBookStore } from "./useBookStore";

const openResult: BookOpenResult = {
  rootPath: "/book",
  meta: {
    id: "b1",
    title: "深渊之下",
    schemaVersion: 1,
    stages: [{ id: "draft", name: "正文" }],
    activeStage: "draft",
    permissionMode: DEFAULT_PERMISSION_MODE,
    chapterOrder: ["chapters/01-a.md"]
  },
  docs: [{ relPath: "chapters/01-a.md", kind: "chapter" as const, title: "开局" }]
};

const DOC = "chapters/01-a.md";
const entry: ChangeEntry = {
  stamp: "2026-10-05T12-34-31-168Z",
  docRelPath: DOC,
  backupRelPath: `.mochen/changes/2026-10-05T12-34-31-168Z/${DOC}.bak`,
  bytes: 26
};

let 盘上正文 = "改坏了的正文\n";
let 盘上指纹 = "fp-broken";
const readDoc = vi.fn(async (relPath: string) => ({
  relPath,
  content: 盘上正文,
  fingerprint: 盘上指纹
}));
const listChanges = vi.fn(async (): Promise<ChangeEntry[]> => [entry]);
const readChange = vi.fn<RendererApi["readChange"]>(async () => ({
  content: "改前的样子\n",
  fingerprint: "fp-bak"
}));

/** 桩的默认回滚：动盘上那两份变量，好让「右栏现读回来」断言有东西可读。 */
async function 回滚到改前(): Promise<Awaited<ReturnType<RendererApi["restoreChange"]>>> {
  盘上正文 = "改前的样子\n";
  盘上指纹 = "fp-restored";
  return {
    ok: true,
    fingerprint: "fp-restored",
    backupRelPath: null,
    restoredFrom: entry.backupRelPath
  };
}
const restoreChange = vi.fn<RendererApi["restoreChange"]>(回滚到改前);

const api = {
  pickBookDirectory: vi.fn(async (): Promise<string | null> => "/book"),
  openBook: vi.fn(async () => openResult),
  createBook: vi.fn(async () => {
    throw new Error("不该建书");
  }),
  saveMeta: vi.fn(async () => {}),
  readDoc,
  writeDoc: vi.fn(async (): Promise<DocWriteResult> => ({
    ok: true,
    fingerprint: "fp-next",
    backupRelPath: null
  })),
  createDoc: vi.fn(async () => {
    throw new Error("不该建稿");
  }),
  appearanceGet: vi.fn(async () => {
    throw new Error("不该读外观");
  }),
  appearanceSave: vi.fn(async () => {}),
  startTurn: vi.fn(async () => {
    throw new Error("不该发轮次");
  }),
  interruptTurn: vi.fn(async () => {
    throw new Error("不该打断");
  }),
  decideProposal: vi.fn(async () => {
    throw new Error("不该裁决提案");
  }),
  proposalDiff: vi.fn(async () => {
    throw new Error("不该算 diff");
  }),
  loadSession: vi.fn(async () => {
    throw new Error("不该载会话");
  }),
  listSessions: vi.fn(async () => []),
  contextPreview: vi.fn(async () => {
    throw new Error("不该算上下文预览");
  }),
  providerView: vi.fn(async () => {
    throw new Error("不该读 provider");
  }),
  providerSave: vi.fn(async () => {
    throw new Error("不该写 provider");
  }),
  providerConnectionRemove: vi.fn(async () => {
    throw new Error("不该删连接");
  }),
  providerVerify: vi.fn(async () => {
    throw new Error("不该体检");
  }),
  openProviderKeyPage: vi.fn(async () => {
    throw new Error("不该开密钥页");
  }),
  openWebSource: vi.fn(async () => {
    throw new Error("不该点开搜索来源");
  }),
  listModels: vi.fn(async () => {
    throw new Error("不该拉模型");
  }),
  profileUpsert: vi.fn(async () => {
    throw new Error("不该建档");
  }),
  profileRemove: vi.fn(async () => {
    throw new Error("不该删档");
  }),
  profileEnable: vi.fn(async () => {
    throw new Error("不该启停");
  }),
  onAgentEvent: vi.fn(() => () => {}),
  // 退出握手（P0-6）：这一格用例不碰它，给一对无害的假身即可过 RendererApi 的形状关。
  onQuitFlushRequest: () => () => {},
  quitFlushDone: async () => {},
  saveFile: vi.fn(async () => true),
  buildExport: vi.fn(async () => ({
    content: "",
    bytes: null,
    format: "markdown" as const,
    filename: "",
    byteSize: 0
  })),
  listChanges,
  readChange,
  restoreChange,

  // 2026-10-06 批次 5-⑧：`satisfies RendererApi` 要求这三个通道在场，但**这个 store 一个都不用**。
  // 给的是默认档快照，所以真被调到也只会拿到「什么都没设过」这一种结果——不会让断言莫名其妙地红。
  changesRetentionGet: async () => ({ persisted: false, retention: DEFAULT_CHANGE_RETENTION }),
  changesRetentionSave: async (r) => r,
  changesPruneNow: async () => ({ removed: 0, kept: 0, freedBytes: 0, keptBytes: 0 }),
  notify: vi.fn(),
  listSkills: vi.fn(async () => {
    throw new Error("不该列技能");
  }),
  readSkill: vi.fn(async () => {
    throw new Error("不该读技能");
  }),
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
  // 设定落盘两枚（2026-10-09 扫描总单 P0-7）：改稿备份这条路不碰书里的设定文件，
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
  盘上正文 = "改坏了的正文\n";
  盘上指纹 = "fp-broken";
  vi.stubGlobal("window", {
    mochen: api,
    localStorage: { getItem: () => null, setItem: () => {} }
  });
  readDoc.mockClear();
  listChanges.mockClear();
  readChange.mockClear();
  restoreChange.mockClear();
  restoreChange.mockImplementation(回滚到改前);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function openedBook() {
  const store = useBookStore();
  await store.openBook("/book");
  await store.openDocTab(DOC);
  return store;
}

describe("回滚", () => {
  it("成功后最后一条提示是「已回滚」，不许被刷新正文那句盖掉", async () => {
    const store = await openedBook();
    await store.restoreChange(entry);
    expect(store.notice).toContain("已回滚");
  });

  it("右栏正文跟着回到改前的样子（现读回来，不是停在旧内容上）", async () => {
    const store = await openedBook();
    await store.restoreChange(entry);
    expect(store.draft).toBe("改前的样子\n");
    expect(store.dirty).toBe(false);
  });

  it("指纹是盘上此刻现读现传的，不许用打开文稿时那个旧的", async () => {
    const store = await openedBook();
    readDoc.mockClear();
    await store.restoreChange(entry);
    expect(readDoc).toHaveBeenCalledWith(DOC);
    expect(restoreChange).toHaveBeenCalledWith(entry.backupRelPath, "fp-broken");
  });

  it("stale：说人话，且不刷新正文（那份内容已经不是当时的了）", async () => {
    const store = await openedBook();
    restoreChange.mockImplementationOnce(async () => ({
      ok: false as const,
      reason: "stale" as const,
      currentFingerprint: "fp-other",
      restoredFrom: entry.backupRelPath
    }));
    await store.restoreChange(entry);
    expect(store.notice).toContain("又被改过了");
    expect(store.draft).toBe("改坏了的正文\n");
  });

  it("没打开那一篇正文就不发 IPC（否则刷的是别的文稿）", async () => {
    const store = await openedBook();
    store.activeDocTab = null;
    await store.restoreChange(entry);
    expect(restoreChange).not.toHaveBeenCalled();
    expect(store.notice).toContain("先打开那一篇正文");
  });
});

describe("看改前", () => {
  it("读回的内容挂在选中那一条上", async () => {
    const store = await openedBook();
    await store.peekChange(entry);
    expect(store.changeHistory?.backupRelPath).toBe(entry.backupRelPath);
    expect(store.changePreview?.content).toBe("改前的样子\n");
  });

  it("期间用户改选了别的条目，读回来的旧预览要丢掉（不许摆错内容）", async () => {
    const store = await openedBook();
    const other: ChangeEntry = {
      ...entry,
      stamp: "2026-10-05T13-00-00-000Z",
      backupRelPath: ".mochen/changes/2026-10-05T13-00-00-000Z/chapters/01-a.md.bak"
    };
    let 放行!: () => void;
    const 卡住 = new Promise<void>((resolve) => {
      放行 = resolve;
    });
    readChange.mockImplementationOnce(async () => {
      await 卡住;
      return { content: "旧那一份\n", fingerprint: "fp-old" };
    });
    const pending = store.peekChange(entry);
    store.changeHistory = other;
    放行();
    await pending;
    expect(store.changePreview).toBeNull();
  });

  it("读不出来：说人话，不留半截预览", async () => {
    const store = await openedBook();
    readChange.mockImplementationOnce(async () => {
      throw new Error("EACCES");
    });
    await store.peekChange(entry);
    expect(store.notice).toContain("读不出来");
    expect(store.changePreview).toBeNull();
  });
});

describe("列表", () => {
  it("读不出来：说人话 + 给空表，不留上一份的旧列表骗人", async () => {
    const store = await openedBook();
    listChanges.mockImplementationOnce(async () => {
      throw new Error("ENOENT");
    });
    await store.loadChanges();
    expect(store.notice).toContain("没读回来");
    expect(store.changeList).toEqual([]);
  });

  it("关掉面板把选中与预览一起清掉（下次打开是干净的一张表）", async () => {
    const store = await openedBook();
    await store.peekChange(entry);
    store.closeChangeHistory();
    expect(store.changeHistory).toBeNull();
    expect(store.changePreview).toBeNull();
    expect(store.changeHistoryOpen).toBe(false);
  });
});
