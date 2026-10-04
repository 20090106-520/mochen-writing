import {
  IPC_CHANNELS,
  type DecideInput,
  type ProviderDraft,
  type StartTurnInput
} from "@mochen/contracts";
import type { ProviderSettings } from "./provider-settings.js";
import type { ModelLister } from "./provider-models.js";
import type { AgentService } from "./agent-service.js";

/** electron 的 ipcMain.handle 的窄形状：装配处传进来，测试处传注册表。 */
type Handler = (channel: string, fn: (...args: unknown[]) => unknown) => void;

/** 只注册 IPC_CHANNELS 白名单里那六条 agent 通道，一条不多一条不少。 */
export function registerAgentIpc(handle: Handler, service: AgentService): void {
  handle(IPC_CHANNELS.agentStartTurn, (_event, input) =>
    service.startTurn(input as StartTurnInput)
  );
  handle(IPC_CHANNELS.agentInterrupt, (_event, turnId) => service.interrupt(turnId as string));
  handle(IPC_CHANNELS.agentDecide, (_event, input) => service.decide(input as DecideInput));
  handle(IPC_CHANNELS.agentDiff, (_event, proposalId) => service.diffOf(proposalId as string));
  // sessionId 可能是 undefined（没指名 = 读最近那条）：原样转交，由 service 归一，不在这里替它决定。
  handle(IPC_CHANNELS.agentLoadSession, (_event, threadKey, sessionId) =>
    service.loadSession(threadKey as string, sessionId as string | undefined)
  );
  handle(IPC_CHANNELS.agentListSessions, () => service.listSessions());
}

/** 视图与保存只回掩码，枚举只按主进程自己的配置出网：明文密钥在这三条线上都是单向的（spec §8）。 */
export function registerProviderIpc(
  handle: Handler,
  settings: ProviderSettings,
  models: ModelLister
): void {
  handle(IPC_CHANNELS.providerGet, () => settings.view());
  handle(IPC_CHANNELS.providerSave, (_event, draft) => settings.save(draft as ProviderDraft));
  // 这条通道零参数：地址与密钥都由主进程从配置里自己取，渲染层递不进来，也就骗不出去。
  handle(IPC_CHANNELS.providerListModels, () => models.list());
}
