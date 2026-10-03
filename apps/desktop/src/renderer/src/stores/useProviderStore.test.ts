import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { ModelListResult, ProviderDraft, ProviderView, RendererApi } from "@mochen/contracts";
import { useProviderStore } from "./useProviderStore";

const VIEW: ProviderView = {
  hasKey: true,
  baseURL: "http://127.0.0.1:8788/v1",
  model: "mochen-mock",
  keyMask: "••••2c9f"
};

const providerView = vi.fn(async (): Promise<ProviderView> => VIEW);
const providerSave = vi.fn(async (draft: ProviderDraft): Promise<ProviderView> => ({
  ...VIEW,
  model: draft.model
}));
const listModels = vi.fn(async (): Promise<ModelListResult> => ({
  ok: true,
  models: ["mochen-8B", "mochen-mock"]
}));
/** 这条 store 只管模型侧：书与 agent 的通道一旦被打到就是越界。 */
function offLimits(name: string) {
  return vi.fn(async () => {
    throw new Error(`useProviderStore 不该调用 ${name}`);
  });
}

const api = {
  pickBookDirectory: offLimits("pickBookDirectory"),
  openBook: offLimits("openBook"),
  saveMeta: offLimits("saveMeta"),
  readDoc: offLimits("readDoc"),
  writeDoc: offLimits("writeDoc"),
  startTurn: offLimits("startTurn"),
  interruptTurn: offLimits("interruptTurn"),
  decideProposal: offLimits("decideProposal"),
  proposalDiff: offLimits("proposalDiff"),
  loadSession: offLimits("loadSession"),
  providerView,
  providerSave,
  listModels,
  onAgentEvent: vi.fn(() => {
    throw new Error("useProviderStore 不该订阅 agent");
  })
} satisfies RendererApi;

function store() {
  return useProviderStore();
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal("window", { mochen: api });
  providerView.mockClear();
  providerView.mockResolvedValue(VIEW);
  providerSave.mockClear();
  providerSave.mockImplementation(async (draft: ProviderDraft) => ({
    ...VIEW,
    model: draft.model
  }));
  listModels.mockClear();
  listModels.mockResolvedValue({ ok: true, models: ["mochen-8B", "mochen-mock"] });
});

describe("useProviderStore · 视图", () => {
  it("refresh 成功 ⇒ view 就位、error 清空、chip 报得出当前模型名", async () => {
    await store().refresh();
    const s = store();
    expect(s.view).toEqual(VIEW);
    expect(s.error).toBe("");
    expect(s.modelLabel).toBe("mochen-mock");
    expect(s.configured).toBe(true);
  });

  it("refresh 失败 ⇒ 收成剥壳后的中文单句，且不清掉已知的视图（读失败不等于配置变了）", async () => {
    const s = store();
    await s.refresh();
    providerView.mockRejectedValueOnce(
      new Error(
        "Error invoking remote method 'provider:get': Error: 模型配置文件读取失败（EBUSY: resource busy or locked）；请检查该文件是否被占用或有访问权限。"
      )
    );
    await s.refresh();
    expect(s.error).toBe("模型配置文件读取失败；请检查该文件是否被占用或有访问权限。");
    expect(s.view).toEqual(VIEW);
    await s.refresh();
    expect(s.error).toBe("");
  });

  it("还没配置模型 ⇒ configured 为假、chip 不摆空模型名（configured 判的是 model 非空，不是 view 非空）", async () => {
    providerView.mockResolvedValueOnce({ ...VIEW, model: "" });
    const s = store();
    await s.refresh();
    expect(s.view).not.toBeNull();
    expect(s.configured).toBe(false);
    expect(s.modelLabel).toBe("");
  });
});

describe("useProviderStore · 拉列表", () => {
  it("只拉一次：第二次 open 用缓存，force 才再出网", async () => {
    const s = store();
    await s.loadModels();
    await s.loadModels();
    expect(listModels).toHaveBeenCalledTimes(1);
    await s.loadModels(true);
    expect(listModels).toHaveBeenCalledTimes(2);
  });

  it("拉取中 modelsLoading 为真，成功后复位并带出列表", async () => {
    const s = store();
    const pending = s.loadModels();
    expect(s.modelsLoading).toBe(true);
    await pending;
    expect(s.modelsLoading).toBe(false);
    expect(s.models).toEqual({ ok: true, models: ["mochen-8B", "mochen-mock"] });
  });

  it("通道本身被拒（主进程抛）⇒ 收成 ok:false 的中文理由，不把 rejection 留给浮层", async () => {
    listModels.mockRejectedValueOnce(
      new Error("Error invoking remote method 'x': Error: 内部炸了")
    );
    const s = store();
    await s.loadModels();
    expect(s.models).toEqual({ ok: false, reason: "内部炸了" });
    expect(s.modelsLoading).toBe(false);
  });
});

describe("useProviderStore · 切模型", () => {
  it("选一条 ⇒ 走 provider:save，draft 里 apiKey 恒为 null（保留现有密钥），baseURL 原样带上", async () => {
    const s = store();
    await s.refresh();
    const ok = await s.select("mochen-8B");
    expect(ok).toBe(true);
    expect(providerSave).toHaveBeenCalledTimes(1);
    expect(providerSave.mock.calls[0]?.[0]).toEqual({
      baseURL: "http://127.0.0.1:8788/v1",
      model: "mochen-8B",
      apiKey: null
    });
    expect(s.view?.model).toBe("mochen-8B");
  });

  it("还没读到配置 ⇒ 不凭空发一次保存，理由可见", async () => {
    const s = store();
    const ok = await s.select("mochen-8B");
    expect(ok).toBe(false);
    expect(providerSave).not.toHaveBeenCalled();
    expect(s.error).toContain("模型设置");
  });

  it("保存被拒 ⇒ error 可见、视图停在原值、switching 复位", async () => {
    providerSave.mockRejectedValueOnce(
      new Error("Error invoking remote method 'provider:save': Error: 密钥保管不可用")
    );
    const s = store();
    await s.refresh();
    const ok = await s.select("mochen-8B");
    expect(ok).toBe(false);
    expect(s.error).toBe("密钥保管不可用");
    expect(s.view?.model).toBe("mochen-mock");
    expect(s.switching).toBe(false);
  });

  it("保存进行中 switching 为真：弹层不许让你连点第二次", async () => {
    let release: () => void = () => {};
    providerSave.mockImplementationOnce(
      () => new Promise<ProviderView>((resolve) => (release = () => resolve(VIEW)))
    );
    const s = store();
    await s.refresh();
    const pending = s.select("mochen-8B");
    expect(s.switching).toBe(true);
    release();
    await pending;
    expect(s.switching).toBe(false);
  });
});

describe("useProviderStore · 设置浮层保存", () => {
  it("save 成功 ⇒ 用主进程回的视图覆盖本地（渲染层永远拿不回明文密钥）", async () => {
    const s = store();
    const draft: ProviderDraft = { baseURL: "http://a/v1", model: "b", apiKey: "sk-x" };
    const ok = await s.save(draft);
    expect(ok).toBe(true);
    expect(s.view).toEqual({ ...VIEW, model: "b" });
    expect(s.error).toBe("");
  });

  it("save 失败 ⇒ 视图不动、error 是那句可执行中文、返回假", async () => {
    providerView.mockResolvedValueOnce(VIEW);
    providerSave.mockRejectedValueOnce(
      new Error(
        "Error invoking remote method 'provider:save': Error: baseURL 必须以 http:// 或 https:// 开头"
      )
    );
    const s = store();
    await s.refresh();
    const ok = await s.save({ baseURL: "ftp://a", model: "b", apiKey: null });
    expect(ok).toBe(false);
    expect(s.error).toBe("baseURL 必须以 http:// 或 https:// 开头");
    expect(s.view).toEqual(VIEW);
  });

  it("换配置后列表作废：下次 open 必须重新拉，不把旧地址的模型摆给新地址", async () => {
    const s = store();
    await s.loadModels();
    await s.save({ baseURL: "http://other.test/v1", model: "新", apiKey: null });
    expect(s.models).toBeNull();
    await s.loadModels();
    expect(listModels).toHaveBeenCalledTimes(2);
  });
});
