import {
  IPC_CHANNELS,
  type DecideInput,
  type ProviderDraft,
  type StartTurnInput
} from "@mochen/contracts";
import type { ProviderSettings } from "./provider-settings.js";
import type { AgentService } from "./agent-service.js";

/** electron 的 ipcMain.handle 的窄形状：装配处传进来，测试处传注册表。 */
type Handler = (channel: string, fn: (...args: unknown[]) => unknown) => void;

/** 只注册 IPC_CHANNELS 白名单里那五条 agent 通道，一条不多一条不少。 */
export function registerAgentIpc(handle: Handler, service: AgentService): void {
  handle(IPC_CHANNELS.agentStartTurn, (_event, input) =>
    service.startTurn(input as StartTurnInput)
  );
  handle(IPC_CHANNELS.agentInterrupt, (_event, turnId) => service.interrupt(turnId as string));
  handle(IPC_CHANNELS.agentDecide, (_event, input) => service.decide(input as DecideInput));
  handle(IPC_CHANNELS.agentDiff, (_event, proposalId) => service.diffOf(proposalId as string));
  handle(IPC_CHANNELS.agentLoadSession, (_event, threadKey) =>
    service.loadSession(threadKey as string)
  );
}

/** 视图与保存都只回掩码：明文密钥在这条线上是单向的（spec §8）。 */
export function registerProviderIpc(handle: Handler, settings: ProviderSettings): void {
  handle(IPC_CHANNELS.providerGet, () => settings.view());
  handle(IPC_CHANNELS.providerSave, (_event, draft) => settings.save(draft as ProviderDraft));
}
