import { afterEach, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type {
  AgentEvent,
  AgentOutbound,
  BookOpenResult,
  DecideInput,
  DecisionResult,
  DocWriteResult,
  EditProposal,
  ProviderView,
  RendererApi,
  SessionLoadResult,
  StartTurnInput
} from "@mochen/contracts";
import { useAgentStore } from "./useAgentStore";
import { useBookStore } from "./useBookStore";

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
  hasKey: true,
  baseURL: "http://127.0.0.1:8787/v1",
  model: "mochen-mock",
  keyMask: "••••"
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
export const loadSession = vi.fn(async (): Promise<SessionLoadResult> => sessionResult);

export const api = {
  pickBookDirectory: vi.fn(async () => CH),
  openBook: vi.fn(async (): Promise<BookOpenResult> => opened),
  saveMeta: vi.fn(async (): Promise<void> => undefined),
  readDoc,
  writeDoc,
  startTurn,
  interruptTurn,
  decideProposal,
  proposalDiff,
  loadSession,
  providerView: vi.fn(async (): Promise<ProviderView> => view),
  providerSave: vi.fn(async (): Promise<ProviderView> => view),
  onAgentEvent: vi.fn((listener: (payload: AgentOutbound) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  })
} satisfies RendererApi;

export function push(outbound: AgentOutbound): void {
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });
}
