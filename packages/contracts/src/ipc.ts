import type { BookMeta, DocRef } from "./book.js";
import type {
  AgentOutbound,
  DecideInput,
  DecisionResult,
  SessionLoadResult,
  StartTurnInput
} from "./agent-event.js";
import type { ProviderDraft, ProviderView } from "./provider.js";

export const IPC_CHANNELS = {
  bookOpen: "book:open",
  bookSaveMeta: "book:save-meta",
  docRead: "doc:read",
  docWrite: "doc:write",
  bookPick: "book:pick",
  agentStartTurn: "agent:start-turn",
  agentInterrupt: "agent:interrupt",
  agentDecide: "agent:decide",
  agentEvent: "agent:event",
  agentDiff: "agent:diff",
  providerGet: "provider:get",
  providerSave: "provider:save",
  agentLoadSession: "agent:load-session"
} as const;

export interface BookOpenResult {
  rootPath: string;
  meta: BookMeta;
  docs: DocRef[];
}

export interface DocContent {
  relPath: string;
  content: string;
  fingerprint: string;
}

export type DocWriteResult =
  | { ok: true; fingerprint: string; backupRelPath: string | null }
  | { ok: false; reason: "stale"; currentFingerprint: string }
  | { ok: false; reason: "invalid-path" | "outside-book" | "io-error"; message: string };

export interface RendererApi {
  pickBookDirectory(): Promise<string | null>;
  openBook(rootPath: string): Promise<BookOpenResult>;
  saveMeta(meta: BookMeta): Promise<void>;
  readDoc(relPath: string): Promise<DocContent>;
  writeDoc(relPath: string, content: string, expectedFingerprint: string): Promise<DocWriteResult>;
  startTurn(input: StartTurnInput): Promise<{ turnId: string }>;
  interruptTurn(turnId: string): Promise<boolean>;
  decideProposal(input: DecideInput): Promise<DecisionResult>;
  /** 提案的统一 diff 文本；主进程算好，渲染层不 import agent-runtime（见 Task 1 的 agentDiff 说明）。 */
  proposalDiff(proposalId: string): Promise<string>;
  /** 只读回放：把这条线程落盘的 JSONL 读回来，永不动盘、永不重建可批准的待审队列（D1）。 */
  loadSession(threadKey: string): Promise<SessionLoadResult>;
  providerView(): Promise<ProviderView>;
  providerSave(draft: ProviderDraft): Promise<ProviderView>;
  /** 返回取消订阅的函数；渲染层拿不到 ipcRenderer。 */
  onAgentEvent(listener: (payload: AgentOutbound) => void): () => void;
}
