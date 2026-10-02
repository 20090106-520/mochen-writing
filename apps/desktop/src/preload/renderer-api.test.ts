import { describe, expect, it } from "vitest";
import {
  IPC_CHANNELS,
  type AgentOutbound,
  type BookMeta,
  type DecideInput,
  type ProviderDraft,
  type RendererApi,
  type StartTurnInput
} from "@mochen/contracts";
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

  it("13 个方法各调一次：通道与参数逐条钉死（期望值全是字面量，不从 IPC_CHANNELS 派生）", async () => {
    const { api, calls } = harness();
    const meta: BookMeta = {
      id: "b1",
      title: "深渊之下",
      schemaVersion: 1,
      stages: [{ id: "draft", name: "正文" }],
      activeStage: "draft",
      permissionMode: "read-only",
      chapterOrder: []
    };
    const startInput: StartTurnInput = {
      threadKey: "chapters/01-开局.md",
      docRelPath: "chapters/01-开局.md",
      stageId: "draft",
      userText: "改紧一点"
    };
    const decideInput: DecideInput = { proposalId: "p-1", decision: "cancel", guidance: "" };
    const draft: ProviderDraft = {
      baseURL: "http://127.0.0.1:8787/v1",
      model: "深渊-8B",
      apiKey: null
    };

    await api.pickBookDirectory();
    await api.openBook("/book");
    await api.saveMeta(meta);
    await api.readDoc("chapters/01-开局.md");
    await api.writeDoc("chapters/01-开局.md", "正文", "fp-1");
    await api.startTurn(startInput);
    await api.interruptTurn("t-1");
    await api.decideProposal(decideInput);
    await api.proposalDiff("p-1");
    await api.loadSession("chapters/01-开局.md");
    await api.providerView();
    await api.providerSave(draft);
    api.onAgentEvent(() => {});

    expect(calls.length).toBe(13);
    // 通道名必须逐字面量列出来：拿 IPC_CHANNELS 当期望值等于用被测常量证明被测常量本身，
    // 那种断言永不失败——把 openBook 改打到 doc:read 它照样绿。
    expect(calls.map((call) => call.channel)).toEqual([
      "book:pick",
      "book:open",
      "book:save-meta",
      "doc:read",
      "doc:write",
      "agent:start-turn",
      "agent:interrupt",
      "agent:decide",
      "agent:diff",
      "agent:load-session",
      "provider:get",
      "provider:save",
      "agent:event"
    ]);
    expect(calls.map((call) => call.args)).toEqual([
      [],
      ["/book"],
      [meta],
      ["chapters/01-开局.md"],
      ["chapters/01-开局.md", "正文", "fp-1"],
      [startInput],
      ["t-1"],
      [decideInput],
      ["p-1"],
      ["chapters/01-开局.md"],
      [],
      [draft],
      ["subscribe"]
    ]);
    // 渲染层只拿到这 13 个方法：invoke/on/ipcRenderer 一个字都不许泄漏成键。
    expect(Object.keys(api).sort()).toEqual([
      "decideProposal",
      "interruptTurn",
      "loadSession",
      "onAgentEvent",
      "openBook",
      "pickBookDirectory",
      "proposalDiff",
      "providerSave",
      "providerView",
      "readDoc",
      "saveMeta",
      "startTurn",
      "writeDoc"
    ]);
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

describe("生产组合：createRendererApi + createIpcOn（真正进 contextBridge 的那一对接线）", () => {
  it("订阅→推送到达→退订→再推送不到达，且撤的就是注册的那个引用", () => {
    // 假 ipcRenderer：按引用注册/移除，并按 electron 语义以 (event, payload) 派发。
    const registered = new Map<string, (...args: unknown[]) => void>();
    const removed: { channel: string; listener: (...args: unknown[]) => void }[] = [];
    const fakeIpc = {
      on: (channel: string, listener: (...args: unknown[]) => void) => {
        registered.set(channel, listener);
      },
      removeListener: (channel: string, listener: (...args: unknown[]) => void) => {
        removed.push({ channel, listener });
        if (registered.get(channel) === listener) registered.delete(channel);
      }
    };
    const emit = (payload: unknown) => {
      registered.get(IPC_CHANNELS.agentEvent)?.({}, payload);
    };

    const api = createRendererApi(
      () => Promise.resolve({ ok: true }) as Promise<never>,
      createIpcOn(fakeIpc)
    );
    const got: AgentOutbound[] = [];
    const off = api.onAgentEvent((payload) => got.push(payload));
    const wrapped = registered.get(IPC_CHANNELS.agentEvent);
    if (wrapped === undefined) throw new Error("onAgentEvent 必须经 createIpcOn 注册出监听器");

    emit({ type: "turn-start", turnId: "t1", threadKey: "a" });
    expect(got.map((payload) => payload.turnId)).toEqual(["t1"]);

    off();
    expect(removed.length).toBe(1);
    // 同引用断言：removeListener 拿到的必须是 on 注册的那个包装器，否则监听器永久泄漏。
    expect(removed[0]?.listener).toBe(wrapped);
    expect(removed[0]?.channel).toBe(IPC_CHANNELS.agentEvent);

    emit({ type: "turn-start", turnId: "t2", threadKey: "a" });
    expect(got.map((payload) => payload.turnId)).toEqual(["t1"]);
  });
});
