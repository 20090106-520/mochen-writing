import { shell } from "electron";
import {
  IPC_CHANNELS,
  presetOf,
  type ConnectionDraft,
  type ContextPreviewQuery,
  type DecideInput,
  type ModelListQuery,
  type ProfileDraft,
  type StartTurnInput,
  type VerifyResult
} from "@mochen/contracts";
import type { ProviderSettings } from "./provider-settings.js";
import type { ModelLister } from "./provider-models.js";
import type { AgentService } from "./agent-service.js";

/** electron 的 ipcMain.handle 的窄形状：装配处传进来，测试处传注册表。 */
type Handler = (channel: string, fn: (...args: unknown[]) => unknown) => void;

/** 只注册 IPC_CHANNELS 白名单里那七条 agent 通道，一条不多一条不少。 */
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
  // 上下文占用条：渲染层只问「会装多少」，正文由 service 自己在 startTurn 时装配。
  handle(IPC_CHANNELS.agentContextPreview, (_event, query) =>
    service.contextPreview(query as ContextPreviewQuery)
  );
}

/**
 * 视图与保存只回掩码，明文密钥在这些线上都是单向的（spec §8）。
 * list-models 的草稿参数只放宽到「草稿密钥配草稿地址」：已存密钥仍只发往它自己那条连接的地址
 * （守卫在 provider-models 的 resolveModelListTarget），渲染层递任意 URL 骗不出存好的密钥。
 */
export function registerProviderIpc(
  handle: Handler,
  settings: ProviderSettings,
  models: ModelLister
): void {
  handle(IPC_CHANNELS.providerGet, () => settings.view());
  handle(IPC_CHANNELS.providerSave, (_event, draft) =>
    settings.saveConnection(draft as ConnectionDraft)
  );
  // 删连接会连它下面的档案一起删（主进程保证外键不留悬空）。
  handle(IPC_CHANNELS.providerConnectionRemove, (_event, id) =>
    settings.removeConnection(id as string)
  );
  handle(IPC_CHANNELS.providerListModels, (_event, query) =>
    models.list(query as ModelListQuery | undefined)
  );
  // 软校验：回答「现在连不连得上」，**不**决定能不能存（硬校验会把「服务没起」变成死路）。
  handle(IPC_CHANNELS.providerVerify, async (_event, connectionId) => {
    const checkedAt = new Date().toISOString();
    try {
      const target = await settings.connectionTarget(connectionId as string);
      if (target === null) {
        return {
          state: "unverified",
          reason: "没有找到这条连接。",
          checkedAt
        } satisfies VerifyResult;
      }
      const result = await models.list({ connectionId: connectionId as string });
      return result.ok
        ? ({ state: "ok", modelCount: result.models.length, checkedAt } satisfies VerifyResult)
        : ({ state: "unreachable", reason: result.reason, checkedAt } satisfies VerifyResult);
    } catch (error) {
      return {
        state: "unreachable",
        reason: error instanceof Error ? error.message : "体检没跑成，稍后再试。",
        checkedAt
      } satisfies VerifyResult;
    }
  });
  handle(IPC_CHANNELS.providerProfileUpsert, (_event, draft) =>
    settings.upsertProfile(draft as ProfileDraft)
  );
  handle(IPC_CHANNELS.providerProfileRemove, (_event, id) => settings.removeProfile(id as string));
  handle(IPC_CHANNELS.providerProfileEnable, (_event, id, enabled) =>
    settings.enableProfile(id as string, enabled as boolean)
  );
  // 「获取 API 密钥」：只收 providerId，地址由主进程从预设表查出来。
  // 渲染层递不了任意 URL 出去——那条路会把 file:// 与内网地址一并放行。
  handle(IPC_CHANNELS.appOpenExternal, async (_event, providerId) => {
    const preset = presetOf(providerId as string);
    if (preset === null) {
      throw new Error("这家没有可跳转的密钥页面，请自己到服务商官网取。");
    }
    await shell.openExternal(preset.keyUrl);
    return true;
  });
}
