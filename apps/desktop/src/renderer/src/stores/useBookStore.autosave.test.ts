/**
 * 自动保存排程 × 设置档（2026-10-05 设置页「写作」页签的接线证据）。
 * 排程真身 scheduleAutoSave 每次键入重读偏好档：默认 2000ms（与原常量同值，行为不变）；
 * 0 = 关（不排程，只剩手动保存）；5000 = 到点才存。落盘真身仍是 writeDoc 那条指纹链。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  DEFAULT_CHANGE_RETENTION,
  DEFAULT_PERMISSION_MODE,
  type BookOpenResult,
  type DocWriteResult,
  type RendererApi
} from "@mochen/contracts";
import { AUTOSAVE_PREFERENCE_KEY } from "../utils/autosave-preference";
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
  docs: [{ relPath: "chapters/01-a.md", kind: "chapter", title: "开局" }]
};

const writeDoc = vi.fn<
  (relPath: string, content: string, expectedFingerprint: string) => Promise<DocWriteResult>
>(async (): Promise<DocWriteResult> => ({
  ok: true,
  fingerprint: "fp-next",
  backupRelPath: null
}));

const prefs = new Map<string, string>();

const api = {
  pickBookDirectory: vi.fn(async (): Promise<string | null> => "/book"),
  openBook: vi.fn(async () => openResult),
  createBook: vi.fn(async () => {
    throw new Error("不该建书");
  }),
  saveMeta: vi.fn(async () => {}),
  readDoc: vi.fn(async (relPath: string) => ({
    relPath,
    content: "正文\n",
    fingerprint: "fp-a"
  })),
  writeDoc,
  createDoc: vi.fn(async () => {
    throw new Error("不该建稿");
  }),
  appearanceGet: vi.fn(async () => {
    throw new Error("不该读外观");
  }),
  appearanceSave: vi.fn(async () => {
    throw new Error("不该写外观");
  }),
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
  contextPreview: vi.fn(async () => ({
    profileId: "",
    profileName: "",
    items: [],
    chars: 0,
    approxTokens: 0,
    empty: true
  })),
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
  saveFile: vi.fn(async () => true),
  buildExport: vi.fn(async () => ({
    content: "",
    bytes: null,
    format: "markdown" as const,
    filename: "",
    byteSize: 0
  })),
  listChanges: vi.fn(async () => []),
  readChange: vi.fn(async () => {
    throw new Error("不该读改稿备份");
  }),
  restoreChange: vi.fn(async () => {
    throw new Error("不该回滚");
  }),
  notify: vi.fn(),
  listSkills: vi.fn(async () => {
    throw new Error("不该列技能");
  }),
  readSkill: vi.fn(async () => {
    throw new Error("不该读技能");
  }),
  // 2026-10-06 批次 5-⑧：`satisfies RendererApi` 要求保留上限这三枚在场，但自动保存这条路一个都不用。
  // 给默认档快照，真被调到也只会拿到「什么都没设过」，不会让本组用例的断言莫名其妙地红。
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
  }
} satisfies RendererApi;

beforeEach(() => {
  setActivePinia(createPinia());
  prefs.clear();
  vi.stubGlobal("window", {
    mochen: api,
    localStorage: {
      getItem: (key: string) => prefs.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        prefs.set(key, value);
      },
      removeItem: (key: string): void => {
        prefs.delete(key);
      }
    }
  });
  vi.useFakeTimers();
  writeDoc.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function openedBook() {
  const store = useBookStore();
  await store.openBook("/book");
  await store.openDocTab("chapters/01-a.md");
  return store;
}

describe("scheduleAutoSave × 设置档", () => {
  it("没设置过 = 原行为：停手 2000ms 自动存（静默窗内重置）", async () => {
    const store = await openedBook();
    store.onEdit("第一笔\n");
    await vi.advanceTimersByTimeAsync(1999);
    expect(writeDoc).not.toHaveBeenCalled();
    store.onEdit("第二笔\n");
    await vi.advanceTimersByTimeAsync(1999);
    expect(writeDoc).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(writeDoc).toHaveBeenCalledTimes(1);
    expect(writeDoc.mock.calls[0]?.[0]).toBe("chapters/01-a.md");
  });

  it("档位 0 = 关：onEdit 不排程，时间再长也不落盘（只剩手动保存）", async () => {
    prefs.set(AUTOSAVE_PREFERENCE_KEY, "0");
    const store = await openedBook();
    store.onEdit("写了\n");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(writeDoc).not.toHaveBeenCalled();
  });

  it("档位 5000：2000ms 时不存，5000ms 才存", async () => {
    prefs.set(AUTOSAVE_PREFERENCE_KEY, "5000");
    const store = await openedBook();
    store.onEdit("慢一点\n");
    await vi.advanceTimersByTimeAsync(2000);
    expect(writeDoc).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(writeDoc).toHaveBeenCalledTimes(1);
  });

  it("改档即时生效：下一次键入按新档排程（已在路上的那一次照旧）", async () => {
    const store = await openedBook();
    store.onEdit("先按默认\n");
    prefs.set(AUTOSAVE_PREFERENCE_KEY, "0");
    store.onEdit("再改一笔，此时已是关\n");
    await vi.advanceTimersByTimeAsync(60_000);
    // 第一笔的排程在第二笔 onEdit 时被重置，重置后读到 0 ，两次都不落盘。
    expect(writeDoc).not.toHaveBeenCalled();
  });
});
