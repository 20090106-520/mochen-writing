import { describe, expect, it } from "vitest";
import { IPC_CHANNELS, type AgentOutbound, type RendererApi } from "@mochen/contracts";
import { createIpcOn, createRendererApi } from "./renderer-api.js";

function harness() {
  const calls: { channel: string; args: unknown[] }[] = [];
  const listeners = new Set<(payload: unknown) => void>();
  const api: RendererApi = createRendererApi(
    (channel, ...args) => {
      calls.push({ channel, args });
      // Invoke 的返回类型是 Promise<never>（工厂要它赋给任何 RendererApi 方法）；
      // 夹具桩返回真实对象，在此边界显式收口，不改任何断言。
      return Promise.resolve({ ok: true, turnId: "t1" }) as Promise<never>;
    },
    (channel, listener) => {
      listeners.add(listener);
      calls.push({ channel, args: ["subscribe"] });
      return () => listeners.delete(listener);
    }
  );
  return { api, calls, listeners };
}

describe("createRendererApi", () => {
  it("每个方法只走自己的通道", async () => {
    const { api, calls } = harness();
    await api.startTurn({ threadKey: "a", docRelPath: "a", stageId: "draft", userText: "改" });
    await api.interruptTurn("t1");
    await api.decideProposal({ proposalId: "p1", decision: "cancel", guidance: "" });
    await api.proposalDiff("p1");
    await api.providerView();
    await api.providerSave({ baseURL: "http://a/v1", model: "m", apiKey: null });
    expect(calls.map((call) => call.channel)).toEqual([
      IPC_CHANNELS.agentStartTurn,
      IPC_CHANNELS.agentInterrupt,
      IPC_CHANNELS.agentDecide,
      IPC_CHANNELS.agentDiff,
      IPC_CHANNELS.providerGet,
      IPC_CHANNELS.providerSave
    ]);
    expect(calls[3]?.args).toEqual(["p1"]);
  });

  it("订阅 agentEvent 后能收到推送，取消订阅后不再收到", () => {
    const { api, listeners, calls } = harness();
    const got: AgentOutbound[] = [];
    const off = api.onAgentEvent((payload) => got.push(payload));
    expect(calls.at(-1)?.channel).toBe(IPC_CHANNELS.agentEvent);
    const listener = [...listeners][0];
    listener?.({ type: "turn-end", turnId: "t1", threadKey: "a", status: "done", message: "" });
    expect(got.length).toBe(1);
    off();
    expect(listeners.size).toBe(0);
  });

  it("不暴露任何白名单外的通道", async () => {
    const { api, calls } = harness();
    await api.openBook("/book");
    await api.writeDoc("chapters/01.md", "x", "fp");
    const allowed = new Set<string>(Object.values(IPC_CHANNELS));
    expect(calls.every((call) => allowed.has(call.channel))).toBe(true);
  });
});

describe("createIpcOn", () => {
  it("退订撤的是 on 注册的同一个引用：退订后推送不再送达", () => {
    // 假 ipc：自记 listeners，按引用注册/移除，并按 electron 语义以 (event, payload) 派发。
    const registered = new Map<string, (...args: unknown[]) => void>();
    let removedListener: ((...args: unknown[]) => void) | null = null;
    const ipc = {
      on: (channel: string, listener: (...args: unknown[]) => void) => {
        registered.set(channel, listener);
      },
      removeListener: (channel: string, listener: (...args: unknown[]) => void) => {
        removedListener = listener;
        // 只有引用完全一致才真正撤除——照搬 electron 的按引用移除。
        if (registered.get(channel) === listener) registered.delete(channel);
      }
    };
    const emit = (payload: unknown) => {
      const listener = registered.get(IPC_CHANNELS.agentEvent);
      listener?.({}, payload);
    };

    const on = createIpcOn(ipc);
    const got: unknown[] = [];
    const off = on(IPC_CHANNELS.agentEvent, (payload) => got.push(payload));
    const wrapped = registered.get(IPC_CHANNELS.agentEvent);
    if (wrapped === undefined) throw new Error("on 必须把包装后的监听注册进去");

    emit({ type: "turn-start", turnId: "t1", threadKey: "a" });
    expect(got.length).toBe(1);

    off();
    // 核心断言：removeListener 收到的引用与 on 注册的必须是同一个。
    expect(removedListener).toBe(wrapped);

    emit({ type: "turn-start", turnId: "t2", threadKey: "a" });
    expect(got.length).toBe(1);
  });
});
