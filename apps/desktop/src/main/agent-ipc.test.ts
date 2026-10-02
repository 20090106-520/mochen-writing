import { describe, expect, it } from "vitest";
import {
  IPC_CHANNELS,
  type DecideInput,
  type ProviderDraft,
  type ProviderView,
  type StartTurnInput
} from "@mochen/contracts";
import { registerAgentIpc, registerProviderIpc } from "./agent-ipc.js";
import type { AgentService } from "./agent-service.js";
import type { ProviderSettings } from "./provider-settings.js";

type Fn = (...args: unknown[]) => unknown;

const view: ProviderView = {
  hasKey: true,
  baseURL: "http://mock/v1",
  model: "test-model",
  keyMask: "••••2c9f"
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
    async loadSession(threadKey: string) {
      seen.push(threadKey);
      return {
        found: false as const,
        reason: "no-session",
        message: "这本书里没有这条线程的历史。"
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
      return { baseURL: view.baseURL, model: view.model };
    },
    async apiKey() {
      return "sk-never-crosses-ipc";
    },
    async save(draft: ProviderDraft) {
      seen.push(draft);
      return view;
    }
  };
}

describe("registerAgentIpc", () => {
  it("注册五条 agent 通道，一条都不漏也不多余", () => {
    const { order, handle } = registry();
    registerAgentIpc(handle, stubService([]));
    expect(order).toEqual([
      IPC_CHANNELS.agentStartTurn,
      IPC_CHANNELS.agentInterrupt,
      IPC_CHANNELS.agentDecide,
      IPC_CHANNELS.agentDiff,
      IPC_CHANNELS.agentLoadSession
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
      userText: "改紧"
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
    expect(seen).toEqual([startTurnInput, "t1", decideInput, "p1", "chapters/01.md"]);
  });
});

describe("registerProviderIpc", () => {
  it("注册两条 provider 通道并按白名单转交，返回的视图里没有密钥字段", async () => {
    const seen: unknown[] = [];
    const reg = registry();
    registerProviderIpc(reg.handle, stubSettings(seen));
    expect(reg.order).toEqual([IPC_CHANNELS.providerGet, IPC_CHANNELS.providerSave]);
    expect(await fire(reg.fns, IPC_CHANNELS.providerGet)).toEqual(view);
    const draft: ProviderDraft = { baseURL: "http://mock/v1", model: "test-model", apiKey: null };
    expect(await fire(reg.fns, IPC_CHANNELS.providerSave, draft)).toEqual(view);
    expect(Object.keys(view).sort()).toEqual(["baseURL", "hasKey", "keyMask", "model"]);
    expect(JSON.stringify(view)).not.toContain("sk-never-crosses-ipc");
    expect(seen).toEqual(["view", draft]);
  });
});
