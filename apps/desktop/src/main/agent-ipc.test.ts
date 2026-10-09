import { describe, expect, it } from "vitest";
import {
  IPC_CHANNELS,
  type ConnectionDraft,
  type ContextPreviewQuery,
  type DecideInput,
  type ProfileDraft,
  type ProviderView,
  type StartTurnInput
} from "@mochen/contracts";
import { registerAgentIpc, registerProviderIpc } from "./agent-ipc.js";
import type { ModelLister } from "./provider-models.js";
import type { AgentService } from "./agent-service.js";
import type { ProviderSettings } from "./provider-settings.js";

type Fn = (...args: unknown[]) => unknown;

const CONNECTION_ID = "c-1";

/** 一条连接 + 一条挂在它上面的档案：地址与密钥都按连接取（config.json v3）。 */
const view: ProviderView = {
  connections: [
    {
      id: CONNECTION_ID,
      providerId: "custom",
      label: "自定义（自己填地址）",
      baseURL: "http://mock/v1",
      authHeader: "bearer",
      thinkingWire: "standard",
      hasKey: true,
      keyMask: "••••2c9f"
    }
  ],
  profiles: [{ id: "p-1", connectionId: CONNECTION_ID, model: "test-model", enabled: true }]
};

function registry(): {
  order: string[];
  fns: Map<string, Fn>;
  handle: (channel: string, fn: Fn) => void;
} {
  const order: string[] = [];
  const fns = new Map<string, Fn>();
  return {
    order,
    fns,
    handle: (channel, fn) => {
      order.push(channel);
      fns.set(channel, fn);
    }
  };
}

/** 按 electron 的调用形状触发：第一个实参是 IpcMainInvokeEvent。 */
async function fire(fns: Map<string, Fn>, channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = fns.get(channel);
  if (fn === undefined) throw new Error(`通道 ${channel} 没有注册`);
  return fn({ senderId: 1 }, ...args);
}

function stubService(seen: unknown[]): AgentService {
  return {
    async startTurn(turnInput: StartTurnInput) {
      seen.push(turnInput);
      return { turnId: "t1" };
    },
    async interrupt(turnId: string) {
      seen.push(turnId);
      return true;
    },
    async decide(input: DecideInput) {
      seen.push(input);
      return { ok: false, reason: "not-pending", message: "" };
    },
    diffOf(proposalId: string) {
      seen.push(proposalId);
      return `diff:${proposalId}`;
    },
    async loadSession(threadKey: string, sessionId?: string) {
      // 两个实参一起记：只记 threadKey 的话，handler 把 sessionId 悄悄丢掉照样绿。
      seen.push([threadKey, sessionId ?? null]);
      return {
        found: false as const,
        reason: "no-session",
        message: "这本书里没有这条线程的历史。"
      };
    },
    async listSessions() {
      seen.push("list-sessions");
      return [];
    },
    async contextPreview(query: ContextPreviewQuery) {
      // 整个 query 一起记：只记 docRelPath 的话，handler 把 profileId 悄悄丢掉照样绿。
      seen.push(query);
      return {
        profileId: query.profileId ?? "",
        profileName: "",
        items: [],
        chars: 0,
        approxTokens: 0,
        empty: true
      };
    },
    dispose() {
      seen.push("dispose");
    }
  };
}

function stubSettings(seen: unknown[]): ProviderSettings {
  return {
    async view() {
      seen.push("view");
      return view;
    },
    async config() {
      const connection = view.connections[0];
      if (connection === undefined) throw new Error("夹具里少了一条连接");
      return {
        baseURL: connection.baseURL,
        model: view.profiles[0]?.model ?? "",
        authHeader: connection.authHeader,
        thinkingWire: "standard"
      };
    },
    async apiKey() {
      return "sk-never-crosses-ipc";
    },
    async connectionTarget(connectionId: string) {
      seen.push(["connectionTarget", connectionId]);
      const connection = view.connections.find((item) => item.id === connectionId);
      if (connection === undefined) return null;
      return {
        baseURL: connection.baseURL,
        authHeader: connection.authHeader,
        thinkingWire: "standard",
        key: "sk-never-crosses-ipc"
      };
    },
    async saveConnection(draft: ConnectionDraft) {
      seen.push(draft);
      return { ...view, connectionId: view.connections[0]?.id ?? "conn-new" };
    },
    async removeConnection(connectionId: string) {
      seen.push(["removeConnection", connectionId]);
      return view;
    },
    async upsertProfile(draft: ProfileDraft) {
      seen.push(draft);
      return view;
    },
    async removeProfile(id: string) {
      seen.push(id);
      return view;
    },
    async enableProfile(id: string, enabled: boolean) {
      seen.push([id, enabled]);
      return view;
    }
  };
}

function stubLister(seen: unknown[]): ModelLister {
  return {
    async list(query?: { baseURL?: string; apiKey?: string }) {
      seen.push(query === undefined ? "list" : ["list", query]);
      return { ok: true, models: ["mochen-8B"] };
    }
  };
}

describe("registerAgentIpc", () => {
  it("注册七条 agent 通道，一条都不漏也不多余", () => {
    const { order, handle } = registry();
    registerAgentIpc(handle, stubService([]));
    expect(order).toEqual([
      IPC_CHANNELS.agentStartTurn,
      IPC_CHANNELS.agentInterrupt,
      IPC_CHANNELS.agentDecide,
      IPC_CHANNELS.agentDiff,
      IPC_CHANNELS.agentLoadSession,
      IPC_CHANNELS.agentListSessions,
      IPC_CHANNELS.agentContextPreview
    ]);
  });

  it("每条 handler 都把参数原样转给 service，并把 service 的返回值带回渲染层", async () => {
    const seen: unknown[] = [];
    const { fns, handle } = registry();
    registerAgentIpc(handle, stubService(seen));
    const startTurnInput: StartTurnInput = {
      threadKey: "chapters/01.md",
      docRelPath: "chapters/01.md",
      stageId: "draft",
      userText: "改紧",
      thinkingLevel: "off",
      webSearchEnabled: false,
      skillPaths: []
    };
    expect(await fire(fns, IPC_CHANNELS.agentStartTurn, startTurnInput)).toEqual({ turnId: "t1" });
    expect(await fire(fns, IPC_CHANNELS.agentInterrupt, "t1")).toBe(true);
    const decideInput: DecideInput = { proposalId: "p1", decision: "cancel", guidance: "" };
    expect(await fire(fns, IPC_CHANNELS.agentDecide, decideInput)).toEqual({
      ok: false,
      reason: "not-pending",
      message: ""
    });
    expect(await fire(fns, IPC_CHANNELS.agentDiff, "p1")).toBe("diff:p1");
    expect(await fire(fns, IPC_CHANNELS.agentLoadSession, "chapters/01.md")).toEqual({
      found: false,
      reason: "no-session",
      message: "这本书里没有这条线程的历史。"
    });
    expect(await fire(fns, IPC_CHANNELS.agentListSessions)).toEqual([]);
    expect(seen).toEqual([
      startTurnInput,
      "t1",
      decideInput,
      "p1",
      ["chapters/01.md", null],
      "list-sessions"
    ]);
  });

  it("指名 sessionId 的那条通道参数原样带过去：面板点第几条就读第几条", async () => {
    const seen: unknown[] = [];
    const { fns, handle } = registry();
    registerAgentIpc(handle, stubService(seen));
    await fire(fns, IPC_CHANNELS.agentLoadSession, "chapters/02-潮信.md", "s-9");
    expect(seen).toEqual([["chapters/02-潮信.md", "s-9"]]);
  });
});

describe("registerProviderIpc", () => {
  it("注册九条 provider 通道并按白名单转交，返回的视图里没有密钥字段", async () => {
    const seen: unknown[] = [];
    const reg = registry();
    registerProviderIpc(reg.handle, stubSettings(seen), stubLister(seen));
    expect(reg.order).toEqual([
      IPC_CHANNELS.providerGet,
      IPC_CHANNELS.providerSave,
      IPC_CHANNELS.providerConnectionRemove,
      IPC_CHANNELS.providerListModels,
      IPC_CHANNELS.providerVerify,
      IPC_CHANNELS.providerProfileUpsert,
      IPC_CHANNELS.providerProfileRemove,
      IPC_CHANNELS.providerProfileEnable,
      // 密钥页那条也在这份白名单里：它走 electron 的 shell，不是转交 settings/lister，
      // 本仓没有 electron 桩，所以这里只钉「注册了这一条、位置没变」。
      IPC_CHANNELS.appOpenExternal
    ]);
    expect(await fire(reg.fns, IPC_CHANNELS.providerGet)).toEqual(view);
    const draft: ConnectionDraft = {
      providerId: "custom",
      baseURL: "http://mock/v1",
      authHeader: "bearer",
      thinkingWire: "standard",
      apiKey: null
    };
    // 存连接的回执比视图多一个 connectionId（刚存那条是谁）——别把它当成裸视图。
    expect(await fire(reg.fns, IPC_CHANNELS.providerSave, draft)).toEqual({
      ...view,
      connectionId: CONNECTION_ID
    });
    expect(await fire(reg.fns, IPC_CHANNELS.providerConnectionRemove, CONNECTION_ID)).toEqual(view);
    expect(await fire(reg.fns, IPC_CHANNELS.providerListModels)).toEqual({
      ok: true,
      models: ["mochen-8B"]
    });
    // 体检是软校验：走 connectionTarget + 名单那一趟，只回答「连不连得上」。
    expect(await fire(reg.fns, IPC_CHANNELS.providerVerify, CONNECTION_ID)).toMatchObject({
      state: "ok",
      modelCount: 1
    });
    const profileDraft: ProfileDraft = { model: "深渊-8B", connectionId: CONNECTION_ID };
    expect(await fire(reg.fns, IPC_CHANNELS.providerProfileUpsert, profileDraft)).toEqual(view);
    expect(await fire(reg.fns, IPC_CHANNELS.providerProfileRemove, "p-1")).toEqual(view);
    expect(await fire(reg.fns, IPC_CHANNELS.providerProfileEnable, "p-1", true)).toEqual(view);
    expect(Object.keys(view).sort()).toEqual(["connections", "profiles"]);
    expect(JSON.stringify(view)).not.toContain("sk-never-crosses-ipc");
    expect(seen).toEqual([
      "view",
      draft,
      ["removeConnection", CONNECTION_ID],
      "list",
      ["connectionTarget", CONNECTION_ID],
      ["list", { connectionId: CONNECTION_ID }],
      profileDraft,
      "p-1",
      ["p-1", true]
    ]);
  });

  it("list-models 的草稿参数原样转交：守卫在 resolveModelListTarget（存好的密钥只发往存好的地址）", async () => {
    const seen: unknown[] = [];
    const reg = registry();
    registerProviderIpc(reg.handle, stubSettings(seen), stubLister(seen));
    await fire(reg.fns, IPC_CHANNELS.providerListModels, {
      baseURL: "http://draft.test/v1",
      apiKey: "sk-draft"
    });
    expect(seen).toEqual([["list", { baseURL: "http://draft.test/v1", apiKey: "sk-draft" }]]);
    // 不传草稿 = undefined 原样到 lister（走已存配置那一条路）。
    await fire(reg.fns, IPC_CHANNELS.providerListModels);
    expect(seen[1]).toBe("list");
  });
});
