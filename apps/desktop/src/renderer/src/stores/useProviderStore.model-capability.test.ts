import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { ProfileDraft, ProviderView, RendererApi } from "@mochen/contracts";
import { useAgentStore } from "./useAgentStore";
import { useProviderStore } from "./useProviderStore";

/**
 * 模型级能力在渲染层的读数与写回（2026-11-21）。
 *
 * 这一族测的是「**模型**的窗口与档位」这一层：
 * - 读：启用中那条档案带出来的那一格（窗口 / 思考档）与能力表那份合起来是什么；
 * - 写：模型下拉里改一格 ⇒ 走 `profileUpsert` 落回**档案**（不是连接、不是全局）。
 *
 * 独立成文件而不是塞进 `useProviderStore.test.ts`：那份已经 700 多行，
 * 贴着 800 行硬门禁（`tools/check-source-line-budget.mjs`）。
 */

/** 一个认得能力的模型（MiniMax-M3.1-Flash：1M 窗口 + 五档）与一个不认的（gpt-4o）。 */
const VIEW: ProviderView = {
  connections: [
    {
      id: "c-one",
      providerId: "minimax",
      label: "MiniMax",
      baseURL: "https://api.minimax.cn/v1",
      authHeader: "bearer",
      thinkingWire: "standard",
      hasKey: true,
      keyMask: "••••2c9f"
    }
  ],
  profiles: [
    { id: "p-flash", connectionId: "c-one", model: "MiniMax-M3.1-Flash", enabled: true },
    { id: "p-gpt", connectionId: "c-one", model: "gpt-4o", enabled: false }
  ]
};

const providerView = vi.fn(async (): Promise<ProviderView> => VIEW);
const profileUpsert = vi.fn(async (draft: ProfileDraft): Promise<ProviderView> => ({
  ...VIEW,
  profiles: VIEW.profiles.map((profile) => ({
    ...profile,
    enabled: profile.model === draft.model,
    // `null` = 明确清空 ⇒ 那一格从视图里消失（exactOptionalPropertyTypes 下不能写成 undefined）。
    ...(draft.contextWindow === undefined || draft.contextWindow === null
      ? {}
      : { contextWindow: draft.contextWindow }),
    ...(draft.thinkingLevel === undefined || draft.thinkingLevel === null
      ? {}
      : { thinkingLevel: draft.thinkingLevel })
  }))
}));

const api = {
  providerView,
  profileUpsert
} as unknown as RendererApi;

function store() {
  return useProviderStore();
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal("window", { mochen: api });
  providerView.mockClear();
  providerView.mockResolvedValue(VIEW);
  profileUpsert.mockClear();
});

describe("useProviderStore · 模型级能力的读数", () => {
  it("窗口 = 档案填过的那一格，没有就回落能力表那份（1M）", async () => {
    await store().refresh();
    expect(store().activeContextWindow).toBe(1_000_000);
  });

  it("档位集合 = 这个模型认的那几档（不是通用四档）", async () => {
    await store().refresh();
    expect(store().activeThinkingLevels).toEqual(["low", "medium", "high", "xhigh", "max"]);
    // 默认档取该模型的官方默认（MiniMax-M3.1-Flash 省略时默认 max）。
    expect(store().activeThinkingLevel).toBe("max");
  });

  it("不认 `reasoning_effort` 的模型：档位集合是空的（界面上那一枚据此置灰）", async () => {
    providerView.mockResolvedValue({
      ...VIEW,
      profiles: [
        { id: "p-gpt", connectionId: "c-one", model: "gpt-4o", enabled: true },
        { id: "p-flash", connectionId: "c-one", model: "MiniMax-M3.1-Flash", enabled: false }
      ]
    });
    await store().refresh();
    expect(store().activeThinkingLevels).toEqual([]);
    // gpt-4o 的窗口仍从能力表来（128K）——窗口与档位是两回事。
    expect(store().activeContextWindow).toBe(128000);
  });

  it("读配置之后，运行态的思考档换成**当前模型自己那一档**", async () => {
    await store().refresh();
    expect(useAgentStore().thinkingLevel).toBe("max");
  });
});

describe("useProviderStore · 模型级能力的写回", () => {
  it("改窗口 ⇒ 走 profileUpsert 落回档案（带模型名与连接，不是裸模型名）", async () => {
    await store().refresh();
    const ok = await store().setModelCapability({ contextWindow: 65536 });
    expect(ok).toBe(true);
    expect(profileUpsert).toHaveBeenCalledWith({
      model: "MiniMax-M3.1-Flash",
      connectionId: "c-one",
      contextWindow: 65536
    });
  });

  it("改档位 ⇒ 落回档案，且运行态跟着换（chip 与实际发出去的值要对得上）", async () => {
    await store().refresh();
    await store().setModelCapability({ thinkingLevel: "xhigh" });
    expect(profileUpsert).toHaveBeenCalledWith({
      model: "MiniMax-M3.1-Flash",
      connectionId: "c-one",
      thinkingLevel: "xhigh"
    });
    expect(useAgentStore().thinkingLevel).toBe("xhigh");
  });

  it("换模型 ⇒ 运行态的档位跟着换成**新模型自己那一档**", async () => {
    await store().refresh();
    expect(useAgentStore().thinkingLevel).toBe("max");
    // 切到 gpt-4o：它不认这一档控制 ⇒ 那一档回到「关闭」（不发字段）。
    await store().switchModel("gpt-4o");
    expect(useAgentStore().thinkingLevel).toBe("off");
  });
});

describe("useProviderStore · 写能力时的两件独立的事", () => {
  it("写能力**不动** `switching`（那是「正在写回模型名」的标记，写窗口时闪它就是一句假话）", async () => {
    await store().refresh();
    expect(store().switching).toBe(false);
    await store().setModelCapability({ contextWindow: 65536 });
    expect(store().switching).toBe(false);
    // 写能力有它自己的标记。
    expect(store().capabilityWriting).toBe(false);
  });

  it("写能力失败 ⇒ 浮层看得到的那个通道上也有理由（失败必须看得见）", async () => {
    await store().refresh();
    profileUpsert.mockRejectedValueOnce(
      new Error("Error invoking remote method 'provider:profile-upsert': Error: 档案写不进去")
    );
    const ok = await store().setModelCapability({ thinkingLevel: "low" });
    expect(ok).toBe(false);
    // `error` 给设置页，`switchError` 给模型下拉那个浮层——两个消费方各看各的通道。
    expect(store().error).toBe("档案写不进去");
    expect(store().switchError).toBe("档案写不进去");
    // 写失败了运行态不能跟着换（否则界面显示的档与实际发出去的不一致）。
    expect(useAgentStore().thinkingLevel).toBe("max");
  });

  it("写成功 ⇒ 旧的那句失败理由被清掉（浮层上不留上一次的旧账）", async () => {
    await store().refresh();
    profileUpsert.mockRejectedValueOnce(
      new Error("Error invoking remote method 'provider:profile-upsert': Error: 档案写不进去")
    );
    await store().setModelCapability({ thinkingLevel: "low" });
    expect(store().switchError).toBe("档案写不进去");
    await store().setModelCapability({ thinkingLevel: "high" });
    expect(store().switchError).toBe("");
  });
});
