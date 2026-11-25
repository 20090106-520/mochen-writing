import { afterEach, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type {
  AgentEvent,
  AgentOutbound,
  BookMeta,
  BookOpenResult,
  ContextPreview,
  ContextPreviewQuery,
  DecideInput,
  DecisionResult,
  DiscardDraftsInput,
  DocWriteResult,
  DraftSetResult,
  EditProposal,
  ModelListResult,
  PickDraftInput,
  ProviderSaveResult,
  ProviderView,
  RendererApi,
  SessionListItem,
  SessionLoadResult,
  SkillRef,
  StartTurnInput,
  VerifyResult
} from "@mochen/contracts";
import { DEFAULT_CHANGE_RETENTION } from "@mochen/contracts";
import { useAgentStore } from "./useAgentStore";
import { useBookStore } from "./useBookStore";
import { SKILL_API_STUBS } from "./skill-api-stub";

/**
 * `useAgentStore.test.ts` 与 `useAgentStore.hydrate.test.ts` 共用的测试夹具。
 * 抽出成独立（非 `.test.ts`）模块只为过 800 行门禁（D2）：本仓 vitest 的 include 只收
 * `.test.ts` 结尾的文件，故本文件不会被当作测试套件收集。
 * 这里是**纯搬迁**：不改任何断言语义，只把 `sessionResult` / `nextDecision` 两个
 * 跨模块不可重新赋值的 `let` 改成 setter（导入绑定只读，赋值会编译失败）。
 */

export const CH = "chapters/01-a.md";
export const OTHER = "chapters/02-b.md";

const opened: BookOpenResult = {
  rootPath: "/book",
  meta: {
    id: "b1",
    title: "深渊之下",
    schemaVersion: 1,
    stages: [{ id: "draft", name: "正文" }],
    activeStage: "draft",
    permissionMode: "chapter-write",
    chapterOrder: [CH]
  },
  docs: [
    { relPath: CH, kind: "chapter", title: "开局" },
    { relPath: OTHER, kind: "chapter", title: "转折" }
  ]
};

const view: ProviderView = {
  connections: [
    {
      id: "c-1",
      providerId: "custom",
      label: "自定义（自己填地址）",
      baseURL: "http://127.0.0.1:8787/v1",
      authHeader: "bearer",
      thinkingWire: "standard",
      hasKey: true,
      keyMask: "••••"
    }
  ],
  profiles: [{ id: "p-1", connectionId: "c-1", model: "mochen-mock", enabled: true }]
};

export function proposal(id: string, overrides: Partial<EditProposal> = {}): EditProposal {
  return {
    id,
    threadKey: CH,
    turnId: "t1",
    docRelPath: CH,
    mode: "anchor-replace",
    anchor: "夜色沉下去",
    replace: "夜色沉下去，海雾涌上来。",
    why: "补一层听觉与雾气",
    tool: "propose_patch",
    source: "tool-call",
    expectedFingerprint: "fp-a",
    createdAt: "2026-10-01T00:00:00.000Z",
    ...overrides
  };
}

export function eventOf(type: AgentEvent["type"], rest: Record<string, unknown> = {}): AgentEvent {
  return {
    id: `e-${type}`,
    ts: "2026-10-01T00:00:00.000Z",
    turnId: "t1",
    type,
    ...rest
  } as AgentEvent;
}

/** 按类型取该线程里的第一条同类事件，省掉测试里满屏的类型收窄。 */
export function typed<T extends AgentEvent["type"]>(type: T, threadKey = CH) {
  const items = useAgentStore().threads[threadKey]?.items ?? [];
  return items.find((item) => item.type === type) as Extract<AgentEvent, { type: T }>;
}

export const listeners = new Set<(payload: AgentOutbound) => void>();
export const started: StartTurnInput[] = [];
export const decided: DecideInput[] = [];

const DEFAULT_DECISION: DecisionResult = {
  ok: true,
  docRelPath: CH,
  fingerprint: "fp-b",
  backupRelPath: null,
  auto: false
};
let nextDecision: DecisionResult = DEFAULT_DECISION;
/** 跨模块不能直接给 `nextDecision` 赋值（导入绑定只读），故以 setter 编排 decide 的返回。 */
export function setNextDecision(value: DecisionResult): void {
  nextDecision = value;
}

const DEFAULT_SESSION_RESULT: SessionLoadResult = {
  found: false,
  reason: "no-session",
  message: "这本书里没有这条线程的历史。"
};
let sessionResult: SessionLoadResult = DEFAULT_SESSION_RESULT;
/** 可编排的回放取数桩：每个用例先 setSessionResult 再 ensureHydrated。 */
export function setSessionResult(value: SessionLoadResult): void {
  sessionResult = value;
}

export function loaded(events: AgentEvent[], droppedLines: number[] = []): SessionLoadResult {
  return {
    found: true,
    relPath: ".mochen/sessions/x.jsonl",
    meta: {
      type: "session-meta",
      sessionId: "s1",
      docRelPath: CH,
      stageId: "draft",
      model: "mochen-mock",
      startedAt: "2026-10-01T00:00:00.000Z"
    },
    events,
    droppedLines
  };
}

export const startTurn = vi.fn(async (input: StartTurnInput) => {
  started.push(input);
  return { turnId: "t1" };
});
export const interruptTurn = vi.fn(async (turnId: string) => turnId.length > 0);
export const decideProposal = vi.fn(async (input: DecideInput) => {
  decided.push(input);
  return nextDecision;
});
export const proposalDiff = vi.fn(async (id: string) => `diff:${id}`);
/**
 * 多稿两枚（P0-②）：默认都回成功。要测失败支的用例改它们的返回；
 * 要钉「有没有真的发出去」查它们的调用。签名走 vi.fn 的泛型参数——
 * 本仓 eslint 没配 argsIgnorePattern，给桩写个用不上的形参会被 no-unused-vars 判错。
 */
export const pickDraft = vi.fn<(input: PickDraftInput) => Promise<DraftSetResult>>(async () => ({
  ok: true
}));
export const discardDrafts = vi.fn<(input: DiscardDraftsInput) => Promise<DraftSetResult>>(
  async () => ({ ok: true })
);
export const readDoc = vi.fn(async (relPath: string) => ({
  relPath,
  content: "正文\n夜色沉下去\n",
  fingerprint: "fp-a"
}));
export const writeDoc = vi.fn(async (): Promise<DocWriteResult> => ({
  ok: true,
  fingerprint: "fp-b",
  backupRelPath: null
}));
/** 泛型签名带得上 sessionId 形参：用例要钉 `mock.lastCall` 的第二格有没有真的传过来。 */
export const loadSession = vi.fn<
  (threadKey: string, sessionId?: string) => Promise<SessionLoadResult>
>(async () => sessionResult);
/** 历史对话面板的数据源桩：默认空列表，用例用 mockResolvedValue 塞自己的行。 */
export const listSessions = vi.fn(async (): Promise<SessionListItem[]> => []);
/**
 * 上下文占用条的桩：默认「什么都没装」。
 * 用例要断言占用条真的调了它，所以签名带 query 而不是空参。
 */
export const contextPreview = vi.fn(
  async (query: ContextPreviewQuery): Promise<ContextPreview> => ({
    profileId: query.profileId ?? "",
    profileName: "",
    items: [],
    chars: 0,
    approxTokens: 0,
    empty: true
  })
);
/**
 * 技能库的两个桩。默认给一份**有内容的**表：用例要断言「挂入的是哪一条」，
 * 空表会让所有断言都只测到「没挂任何东西」。
 */
export const listSkills = vi.fn(async (): Promise<SkillRef[]> => []);
export const readSkill = vi.fn(async (_source: string, relPath: string) => ({
  relPath,
  content: `技能正文：${relPath}\n`,
  truncated: false
}));
/**
 * 写盘桩提成模块级导出常量：Task 8/9 的用例要查它的调用次数。
 * 签名走 vi.fn 的泛型参数而不是简报裁定的 `_meta: BookMeta` 形参——本仓 eslint 没有配 argsIgnorePattern，
 * 尾位的 `_meta` 会被 no-unused-vars 判错（agent-ipc.ts 的 `_event` 只在中位才免报）；
 * 泛型签名同样让 `mock.calls[0]?.[0]` 的元组下标在 tsc 里有类型可查。
 */
export const saveMeta = vi.fn<(meta: BookMeta) => Promise<void>>(async () => {});

export const api = {
  pickBookDirectory: vi.fn(async () => CH),
  openBook: vi.fn(async (): Promise<BookOpenResult> => opened),
  createBook: vi.fn(async (): Promise<never> => {
    throw new Error("agent-store-fixture 不该调用 createBook");
  }),
  // 作品库（2026-10-21）：默认空清单（openBook 之后 store 会顺手刷一次）。
  listRecentBooks: vi.fn(async () => ({ books: [] })),
  forgetRecentBook: vi.fn(async () => ({ books: [] })),
  // 删除作品（2026-11-24）：默认成功。要断言「递出去的是书根」就 clear 后查 mock.calls。
  trashBook: vi.fn(async (): Promise<{ ok: true } | { ok: false; message: string }> => ({
    ok: true
  })),
  saveMeta,
  readDoc,
  writeDoc,
  createDoc: vi.fn(async (): Promise<never> => {
    throw new Error("agent-store-fixture 不该调用 createDoc");
  }),
  renameDoc: vi.fn(async (): Promise<never> => {
    throw new Error("agent-store-fixture 不该调用 renameDoc");
  }),
  startTurn,
  interruptTurn,
  decideProposal,
  proposalDiff,
  pickDraft,
  discardDrafts,
  loadSession,
  listSessions,
  contextPreview,
  providerView: vi.fn(async (): Promise<ProviderView> => view),
  providerSave: vi.fn(async (): Promise<ProviderSaveResult> => ({
    ...view,
    connectionId: view.connections[0]?.id ?? "fixture-conn"
  })),
  providerConnectionRemove: vi.fn(async (): Promise<never> => {
    throw new Error("agent-store-fixture 不该调用 providerConnectionRemove");
  }),
  providerVerify: vi.fn(async (): Promise<VerifyResult> => ({
    state: "unverified",
    reason: "agent-store-fixture 没真出网",
    checkedAt: "2026-10-06T00:00:00.000Z"
  })),
  openProviderKeyPage: vi.fn(async (): Promise<never> => {
    throw new Error("agent-store-fixture 不该调用 openProviderKeyPage");
  }),
  openWebSource: vi.fn(async (): Promise<never> => {
    throw new Error("agent-store-fixture 不该调用 openWebSource");
  }),
  listModels: vi.fn(async (): Promise<ModelListResult> => ({
    ok: true,
    models: ["mochen-mock", "mochen-8B"]
  })),
  profileUpsert: vi.fn(async (): Promise<never> => {
    throw new Error("agent-store-fixture 不该调用 profileUpsert");
  }),
  profileRemove: vi.fn(async (): Promise<never> => {
    throw new Error("agent-store-fixture 不该调用 profileRemove");
  }),
  profileEnable: vi.fn(async (): Promise<never> => {
    throw new Error("agent-store-fixture 不该调用 profileEnable");
  }),
  setUtility: vi.fn(async (): Promise<never> => {
    throw new Error("agent-store-fixture 不该调用 setUtility");
  }),
  appearanceGet: vi.fn(async (): Promise<never> => {
    throw new Error("agent-store-fixture 不该调用 appearanceGet");
  }),
  appearanceSave: vi.fn(async (): Promise<never> => {
    throw new Error("agent-store-fixture 不该调用 appearanceSave");
  }),
  // 技能库：夹具默认给一张空表（不是抛错）——「没有技能」是常态，
  // 要测挂入的用例自己去改这两个桩（改 defaultSkillsByThread / listSkills 的返回值）。
  listSkills,
  readSkill,
  onAgentEvent: vi.fn((listener: (payload: AgentOutbound) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }),
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
  readChange: vi.fn(async (rel: string) => {
    throw new Error(`不该读改稿备份：${rel}`);
  }),
  // 逐行对比（2026-10-13）：agent store 一个都不碰改稿历史，桩成「越权就抛」。
  diffChange: vi.fn(async (rel: string) => {
    throw new Error(`不该算改稿对比：${rel}`);
  }),
  restoreChange: vi.fn(async (rel: string) => {
    throw new Error(`不该回滚：${rel}`);
  }),
  notify: vi.fn(),
  // 2026-10-06 批次 5-⑧：`satisfies RendererApi` 要求保留上限这三枚在场，但 agent store 一个都不用。
  // 给默认档快照，真被调到也只会拿到「什么都没设过」，不会让无关的断言莫名其妙地红。
  changesRetentionGet: async () => ({ persisted: false, retention: DEFAULT_CHANGE_RETENTION }),
  changesRetentionSave: async (r) => r,
  changesPruneNow: async () => ({ removed: 0, kept: 0, freedBytes: 0, keptBytes: 0 }),
  // 技能市场三枚（2026-10-07 批次 5-㉖）：satisfies RendererApi 要求它们在场，
  // 但这些 store 一个都不用。给的是「空表 + 没问过」的默认档，
  // 真被调到也只会拿到「市场里什么都没有」这一种结果——不会让无关的断言莫名其妙地红。
  listMarket: async () => ({ entries: [], listed: false, notice: "" }),
  redeemSkill: async () => ({ ok: false, notice: "", dirName: "", displayName: "" }),
  ...SKILL_API_STUBS,
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
  // 设定落盘两枚（2026-10-09 扫描总单 P0-7）：satisfies RendererApi 要求它们在场，
  // 但 agent 这条路一个都不用——真被调到就是越界，抛出来比静默返回空表更容易发现。
  readBookData: async () => {
    throw new Error("不该读书里的设定文件");
  },
  writeBookData: async () => {
    throw new Error("不该写书里的设定文件");
  },
  // 只重算一篇（2026-10-10 P1-4 后半）与回收站三条、更新检查（同日）：satisfies RendererApi
  // 要求它们在场，但 agent 这条路一个都不用——真被调到就是越界。
  refreshDoc: async () => {
    throw new Error("不该单篇重算 DocRef");
  },
  trashDoc: async () => {
    throw new Error("不该移入回收站");
  },
  listTrash: async () => {
    throw new Error("不该列回收站");
  },
  restoreTrash: async () => {
    throw new Error("不该还原回收站");
  },
  createBookBackup: async () => ({ ok: true, name: null, fileCount: 0 }),
  listBookBackups: async () => ({ ok: true, entries: [] }),
  restoreBookBackup: async () => ({ ok: true, destName: "恢复目录" }),
  updateCheck: async () => {
    throw new Error("不该检查更新");
  },
  importTxtPreview: async () => {
    throw new Error("不该做 TXT 导入预览");
  },
  materialsSearch: async () => {
    throw new Error("这条用例不该调素材库联网搜索");
  },
  materialsFetch: async () => {
    throw new Error("这条用例不该调素材库取全文");
  },
  importTxtCommit: async () => {
    throw new Error("不该提交 TXT 导入");
  },
  // 全书替换（2026-10-15）：这条通道会把整本书翻一遍，谁真要用它在用例里显式铺好 mock。
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

export function push(outbound: AgentOutbound): void {
  // 真实链路里主进程**必先**推 turn-start 再推 event/delta（startTurn 的第一件事就是它），
  // 守卫正是靠这一点把「迟到」认出来。夹具此前直接灌 event，于是那些用例的线程「还没开轮」，
  // 守卫一收紧就全被当成迟到推送拒掉——那是夹具形状与真机不一致，不是产品回归。
  // 这里补齐这一步。**要验「迟到」的场景走 pushLate**（不补开轮），否则测的就不是迟到了。
  if (outbound.type === "event" || outbound.type === "delta") {
    const agent = useAgentStore();
    if (agent.threads[outbound.threadKey]?.turnId == null) {
      for (const listener of listeners) {
        listener({ type: "turn-start", turnId: outbound.turnId, threadKey: outbound.threadKey });
      }
    }
  }
  for (const listener of listeners) listener(outbound);
}

/** 原样推送，**不补 turn-start**：给「迟到的那一条」用（轮次已收束、或压根不是当前轮）。 */
export function pushLate(outbound: AgentOutbound): void {
  for (const listener of listeners) listener(outbound);
}

export function store() {
  return useAgentStore();
}

export async function openChapter(relPath = CH) {
  await useBookStore().openBook("/book");
  await useBookStore().openDocTab(relPath);
}

export function itemsOf(threadKey = CH): AgentEvent[] {
  return store().threads[threadKey]?.items ?? [];
}

/**
 * 每个测试套件在模块顶层调用一次：装 pinia、stub window.mochen、清桩、管假时钟。
 * 放在函数里而非文件顶层，是为了让两个测试文件共用同一套夹具而互不泄漏状态。
 */
export function setupAgentFixture(): void {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("window", { mochen: api });
    listeners.clear();
    started.length = 0;
    decided.length = 0;
    setNextDecision(DEFAULT_DECISION);
    setSessionResult(DEFAULT_SESSION_RESULT);
    // 每个用例都从桩的默认实现起步：`mockImplementation` / `mockResolvedValue` 会跨用例留着（本夹具不 clearMocks），
    // 不在这里复位，上一个用例塞的实现就决定了这一个用例读回什么——顺序一改结果就变，红得毫无道理。
    loadSession.mockImplementation(async () => sessionResult);
    pickDraft.mockImplementation(async () => ({ ok: true }));
    discardDrafts.mockImplementation(async () => ({ ok: true }));
    pickDraft.mockClear();
    discardDrafts.mockClear();
    listSessions.mockImplementation(async () => []);
    listSkills.mockImplementation(async () => []);
    readSkill.mockImplementation(async (_source: string, relPath: string) => ({
      relPath,
      content: `技能正文：${relPath}\n`,
      truncated: false
    }));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });
}
