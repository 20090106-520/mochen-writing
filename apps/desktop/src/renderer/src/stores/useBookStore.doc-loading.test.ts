/**
 * 中栏读稿的行为测试（2026-10-05 批次 3 尾巴）。
 *
 * 钉的是三件事，全是「真跑起来之后的状态」，接线在
 * `components/document-pane-readout-wiring.test.ts` 读源码钉：
 *
 * ① **在途标志**：`readDoc` 没回来之前 `docLoading` 必须为 true。中栏据此摆骨架，
 *    不摆正文——不摆的话，切标签那一瞬中栏是**新标题配旧正文**，
 *    用户照着改就会把上一篇写进这一篇（2026-10-05 读代码撞到，磁盘延迟只是把它暴露出来）。
 * ② **竞态**：快速连点两个标签时，先发的那次读回来**不许**覆盖后一次的结果。
 *    没有这道闸，慢的那次会把中栏永久停在错的那一篇上。
 * ③ **读失败**：不许把上一篇的正文留在新标题底下；也不许静默吞掉——
 *    正文清空 + notice 说清哪一篇没打开。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  DEFAULT_CHANGE_RETENTION,
  DEFAULT_PERMISSION_MODE,
  type BookOpenResult,
  type ProviderView,
  type RendererApi
} from "@mochen/contracts";
import { useBookStore } from "./useBookStore";

const A = "chapters/01-开局.md";
const B = "chapters/02-潮信.md";

const openResult: BookOpenResult = {
  rootPath: "/book",
  meta: {
    id: "b1",
    title: "深渊之下",
    schemaVersion: 1,
    stages: [{ id: "draft", name: "正文" }],
    activeStage: "draft",
    permissionMode: DEFAULT_PERMISSION_MODE,
    chapterOrder: [A, B]
  },
  docs: [
    { relPath: A, kind: "chapter" as const, title: "开局" },
    { relPath: B, kind: "chapter" as const, title: "潮信" }
  ]
};

/** 每个 relPath 的盘上正文；也用它控制 readDoc 的快慢（挂住的 promise 由测试自己放行）。 */
const 正文: Record<string, string> = { [A]: "第一篇的正文\n", [B]: "第二篇的正文\n" };
const 手动放行 = new Map<string, () => void>();
const 挂起 = new Set<string>();

const readDoc = vi.fn(async (relPath: string) => {
  if (挂起.has(relPath)) {
    await new Promise<void>((resolve) => 手动放行.set(relPath, resolve));
  }
  return { relPath, content: 正文[relPath] ?? "", fingerprint: `fp-${relPath}` };
});

/** 本文件不碰 provider，给一份形状正确的空视图就够（`satisfies` 会照它判类型）。 */
const providerViewStub: ProviderView = {
  connections: [
    {
      id: "c-1",
      providerId: "custom",
      label: "自定义（自己填地址）",
      baseURL: "http://127.0.0.1:8899/v1",
      authHeader: "bearer",
      thinkingWire: "standard",
      hasKey: false,
      keyMask: ""
    }
  ],
  profiles: []
};

/**
 * 三个返回形状有精确判别联合的桩必须逐字声明类型（`DocWriteResult.ok` 是 `true` 字面量、
 * `providerSave` 得回 ProviderView），照 `useBookStore.changes.test.ts` 的写法用
 * `vi.fn<RendererApi["方法名"]>()`——`satisfies` 只保证键齐，不会替你把返回类型对上。
 */
const writeDoc = vi.fn<RendererApi["writeDoc"]>(async () => ({
  ok: true,
  fingerprint: "fp-next",
  backupRelPath: null
}));
const providerSave = vi.fn<RendererApi["providerSave"]>(async () => ({
  ...providerViewStub,
  connectionId: providerViewStub.connections[0]?.id ?? "doc-loading-conn"
}));
const restoreChange = vi.fn<RendererApi["restoreChange"]>(async () => ({
  ok: true,
  fingerprint: "fp-restored",
  backupRelPath: null,
  restoredFrom: "bak"
}));

const api = {
  pickBookDirectory: vi.fn(async (): Promise<string | null> => "/book"),
  openBook: vi.fn(async () => openResult),
  createBook: vi.fn(async () => {
    throw new Error("不该建书");
  }),
  saveMeta: vi.fn(async () => {}),
  readDoc,
  writeDoc,
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
  providerView: vi.fn(async () => providerViewStub),
  providerSave,
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
  listChanges: vi.fn(async () => []),
  readChange: vi.fn(async () => ({ content: "", fingerprint: "fp-bak" })),
  // 逐行对比（2026-10-13）：这一组不测改稿历史，给一份「算出来了、逐行相同」的最小答复。
  diffChange: vi.fn(async () => ({ ok: true as const, diff: "" })),
  restoreChange,

  // 2026-10-06 批次 5-⑧：保留上限的读 / 写 / 立即清理。
  // 下面这些 store 都用不到它们，桩成「越权就抛」——真被调用到时那条用例会立刻炸，
  // 而不是悄悄返回 undefined 让断言在别处莫名其妙地红。
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
  // 设定落盘两枚（2026-10-09 扫描总单 P0-7）：加载正文这条路不碰书里的设定文件，
  // 给的是「越权即抛」的假身——静默返回空表会让误用变得看不见。
  readBookData: async () => {
    throw new Error("不该读书里的设定文件");
  },
  writeBookData: async () => {
    throw new Error("不该写书里的设定文件");
  },
  // 只重算一篇（2026-10-10 P1-4 后半）与回收站三条、更新检查（同日）：satisfies RendererApi
  // 要求它们在场，但这些用例一条都不消费——空实现回合法形状，真被调到也不至于污染用例。
  refreshDoc: async () => ({ ok: true, doc: null }),
  trashDoc: async () => ({ ok: true, trashName: "fixture" }),
  listTrash: async () => ({ ok: true, entries: [] }),
  restoreTrash: async () => ({ ok: true, relPath: "chapters/fixture.md" }),
  createBookBackup: async () => ({ ok: true, name: null, fileCount: 0 }),
  listBookBackups: async () => ({ ok: true, entries: [] }),
  restoreBookBackup: async () => ({ ok: true, destName: "恢复目录" }),
  updateCheck: async () => ({ status: "disabled", version: "", latestVersion: null, note: "" }),
  importTxtPreview: async () => {
    throw new Error("不该做 TXT 导入预览");
  },
  importTxtCommit: async () => {
    throw new Error("不该提交 TXT 导入");
  },
  replaceAllInBook: async () => {
    throw new Error("不该在这条用例里做全书替换");
  },
  // WebDAV 远程备份（2026-10-15）：这条路上一个都不该被调到——谁真要用它在用例里显式铺好 mock。
  webdavConfigGet: async () => {
    throw new Error("不该读 WebDAV 配置");
  },
  webdavConfigSave: async () => {
    throw new Error("不该存 WebDAV 配置");
  },
  webdavVerify: async () => {
    throw new Error("不该验活 WebDAV");
  },
  webdavPush: async () => {
    throw new Error("不该推 WebDAV 远程备份");
  },
  webdavList: async () => {
    throw new Error("不该列 WebDAV 远程备份");
  },
  webdavPull: async () => {
    throw new Error("不该拉 WebDAV 远程备份");
  }
} satisfies RendererApi;

beforeEach(() => {
  setActivePinia(createPinia());
  挂起.clear();
  手动放行.clear();
  正文[A] = "第一篇的正文\n";
  正文[B] = "第二篇的正文\n";
  vi.stubGlobal("window", {
    mochen: api,
    localStorage: { getItem: () => null, setItem: () => {} }
  });
  readDoc.mockClear();
});

afterEach(() => {
  // 别让挂住的 promise 跨用例泄漏：把没放行的都放掉。
  for (const release of 手动放行.values()) release();
  手动放行.clear();
});

/** 让微任务队列跑完（readDoc 的 await 落定），但**不**放行挂起的那次。 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe("在途标志", () => {
  it("readDoc 没回来之前 docLoading 为 true，回来之后为 false", async () => {
    const book = useBookStore();
    await book.openBook("/book");
    expect(book.docLoading, "开书本身不该算在读稿").toBe(false);

    挂起.add(A);
    const pending = book.openDocTab(A);
    await settle();
    expect(book.docLoading).toBe(true);
    expect(book.activeDocTab, "标签指针是先换的").toBe(A);

    手动放行.get(A)?.();
    await pending;
    expect(book.docLoading).toBe(false);
    expect(book.draft).toBe(正文[A]);
  });

  it("有暂存副本时不发 IPC，也不进在途（同一格，零延迟）", async () => {
    const book = useBookStore();
    await book.openBook("/book");
    await book.openDocTab(A);
    await book.openDocTab(B);
    // 在**两次都读过之后**才清计数：B 那次读盘是合法的，
    // 清早了就会把它算到「切回有暂存的那篇」头上（第一版就栽在这儿）。
    readDoc.mockClear();

    await book.openDocTab(A);

    expect(readDoc, "切回有暂存的那篇不该再读盘").not.toHaveBeenCalled();
    expect(book.docLoading).toBe(false);
    expect(book.draft).toBe(正文[A]);
  });
});

describe("切标签的竞态", () => {
  it("先发的那次读回来，不许盖掉后一次的结果", async () => {
    const book = useBookStore();
    await book.openBook("/book");

    // 两次都挂起：A 先发、B 后发，然后**先放行 B**——模拟 B 更快回来。
    挂起.add(A);
    挂起.add(B);
    const first = book.openDocTab(A);
    await settle();
    const second = book.openDocTab(B);
    await settle();

    手动放行.get(B)?.();
    await second;
    expect(book.draft).toBe(正文[B]);

    手动放行.get(A)?.();
    await first;
    expect(book.activeDocTab).toBe(B);
    expect(book.draft, "慢的那次回来后必须什么都不改").toBe(正文[B]);
  });

  it("废弃的那次不许顺手把在途标志也清了（否则骨架提前消失）", async () => {
    const book = useBookStore();
    await book.openBook("/book");

    挂起.add(A);
    挂起.add(B);
    const first = book.openDocTab(A);
    await settle();
    const second = book.openDocTab(B);
    await settle();

    手动放行.get(A)?.();
    await first;
    expect(book.docLoading, "A 是废弃的那次，它落地不许把 B 的在途清掉").toBe(true);

    手动放行.get(B)?.();
    await second;
    expect(book.docLoading).toBe(false);
  });
});

describe("读失败不许留旧正文，也不许静默", () => {
  it("失败时正文清空 + notice 说清哪一篇没打开", async () => {
    const book = useBookStore();
    await book.openBook("/book");
    await book.openDocTab(A);
    expect(book.draft).toBe(正文[A]);

    readDoc.mockImplementationOnce(async () => {
      throw new Error("盘上读不出来");
    });
    await book.openDocTab(B);

    expect(book.draft, "新标题底下摆着旧正文就是撒谎").toBe("");
    expect(book.notice).toContain(B);
    expect(book.notice).toContain("盘上读不出来");
    expect(book.docLoading, "失败也要把在途标志收回去").toBe(false);
  });

  it("失败不许把这一篇的暂存副本写成空（否则下次切回来以为是空的）", async () => {
    const book = useBookStore();
    await book.openBook("/book");

    readDoc.mockImplementationOnce(async () => {
      throw new Error("炸了");
    });
    await book.openDocTab(A);
    expect(book.draftsByPath[A], "读失败不该进暂存").toBeUndefined();
  });
});
