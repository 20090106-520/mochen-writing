import {
  IPC_CHANNELS,
  type AgentOutbound,
  type DecideInput,
  type ProviderDraft,
  type RendererApi,
  type StartTurnInput
} from "@mochen/contracts";

type Invoke = (channel: string, ...args: unknown[]) => Promise<never>;
type On = (channel: string, listener: (payload: unknown) => void) => () => void;

/** ipcRenderer 的订阅面：只用到 on / removeListener，测试处传自记 listeners 的假对象。 */
interface IpcLike {
  on(channel: string, listener: (...args: unknown[]) => void): void;
  removeListener(channel: string, listener: (...args: unknown[]) => void): void;
}

/**
 * 造一个 On：包装后的「同一个引用」既交给 on 注册、也交给 removeListener 撤除。
 * electron 按引用移除——若把原始 listener 交给 removeListener，包装后的箭头撤不掉，
 * 监听器会永久泄漏。这条性质必须由本工厂（不 import electron）承载才能单测。
 */
export function createIpcOn(ipc: IpcLike): On {
  return (channel, listener) => {
    const wrapped = (...args: unknown[]) => listener(args[1]);
    ipc.on(channel, wrapped);
    return () => ipc.removeListener(channel, wrapped);
  };
}

export function createRendererApi(invoke: Invoke, on: On): RendererApi {
  return {
    pickBookDirectory: () => invoke(IPC_CHANNELS.bookPick),
    openBook: (rootPath) => invoke(IPC_CHANNELS.bookOpen, rootPath),
    saveMeta: (meta) => invoke(IPC_CHANNELS.bookSaveMeta, meta),
    readDoc: (relPath) => invoke(IPC_CHANNELS.docRead, relPath),
    writeDoc: (relPath, content, expectedFingerprint) =>
      invoke(IPC_CHANNELS.docWrite, relPath, content, expectedFingerprint),
    startTurn: (input: StartTurnInput) => invoke(IPC_CHANNELS.agentStartTurn, input),
    interruptTurn: (turnId) => invoke(IPC_CHANNELS.agentInterrupt, turnId),
    decideProposal: (input: DecideInput) => invoke(IPC_CHANNELS.agentDecide, input),
    proposalDiff: (proposalId) => invoke(IPC_CHANNELS.agentDiff, proposalId),
    providerView: () => invoke(IPC_CHANNELS.providerGet),
    providerSave: (draft: ProviderDraft) => invoke(IPC_CHANNELS.providerSave, draft),
    onAgentEvent: (listener) =>
      on(IPC_CHANNELS.agentEvent, (payload) => listener(payload as AgentOutbound))
  };
}
