import { describe, expect, it } from "vitest";
import {
  modelListResultSchema,
  type ModelListResult,
  type ProviderConfig
} from "@mochen/contracts";
import {
  createModelLister,
  modelIdsOf,
  modelsUrlOf,
  type ModelListFetcher
} from "./provider-models.js";
import type { ProviderSettings } from "./provider-settings.js";

const KEY = "sk-NEVER-in-url-NEVER-in-reason-0000000000";

function settingsStub(config: ProviderConfig | null, key: string | null): ProviderSettings {
  return {
    // view/save 走 IPC 时由 registerProviderIpc 直接转交，本模块只用读侧的两条。
    view: async () => {
      throw new Error("枚举模型不许读视图：它带 keyMask，而这里只需要 baseURL 与密钥");
    },
    config: async () => config,
    apiKey: async () => key,
    save: async () => {
      throw new Error("枚举模型永不写配置");
    }
  };
}

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

/** 记调用、按序吐出响应（或抛错）的 fetch 桩；返回值只用到 ok / status / json。 */
function fetchStub(
  outcomes: (
    | { ok: true; status?: number; payload?: unknown }
    | { ok: false; status: number }
    | { error: unknown }
  )[] = []
): { fetchImpl: ModelListFetcher; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let index = 0;
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init.method, headers: init.headers });
      const outcome = outcomes[index] ?? outcomes[0];
      index += 1;
      if (outcome === undefined) throw new Error("夹具没备好这一发的响应");
      if ("error" in outcome) throw outcome.error;
      if (!outcome.ok)
        return { ok: false, status: outcome.status, json: async () => ({}) } as never;
      return {
        ok: true,
        status: outcome.status ?? 200,
        json: async () => outcome.payload
      } as never;
    }
  };
}

const CONFIG: ProviderConfig = { baseURL: "http://127.0.0.1:8788/v1", model: "旧模型" };

describe("modelsUrlOf", () => {
  it("接在 baseURL 后面，尾部斜杠吃掉：和 chat/completions 同一个拼接口径", () => {
    expect(modelsUrlOf("http://127.0.0.1:8788/v1")).toBe("http://127.0.0.1:8788/v1/models");
    expect(modelsUrlOf("https://api.example.test/v1///")).toBe(
      "https://api.example.test/v1/models"
    );
  });
});

describe("modelIdsOf", () => {
  it("三种外壳都吃：{data:[{id}]}、{models:[…]}、裸数组", () => {
    expect(modelIdsOf({ data: [{ id: "gpt-x" }, { id: "gpt-a" }] })).toEqual(["gpt-a", "gpt-x"]);
    expect(modelIdsOf({ models: ["b", "a"] })).toEqual(["a", "b"]);
    expect(modelIdsOf([{ id: "z" }, "y"])).toEqual(["y", "z"]);
  });

  it("去空白、去重、按码元排序；非字符串 id 与脏项直接丢，不抛", () => {
    expect(
      modelIdsOf({
        data: [
          { id: "  同一条  " },
          { id: "同一条" },
          { id: 42 },
          { name: "没有 id" },
          null,
          "尾项",
          { id: "" }
        ]
      })
    ).toEqual(["同一条", "尾项"]);
  });

  it("payload 根本不是列表 ⇒ 空数组（空列表由调用处变成一句可见的理由）", () => {
    for (const junk of [null, undefined, {}, "字符串", { data: "不是数组" }, 42]) {
      expect(modelIdsOf(junk)).toEqual([]);
    }
  });
});

describe("createModelLister().list", () => {
  it("配置齐全 ⇒ ok:true，且结果过 modelListResultSchema（跨 IPC 的形状在此当场验）", async () => {
    const { fetchImpl, calls } = fetchStub([
      { ok: true, payload: { data: [{ id: "mochen-8B" }] } }
    ]);
    const result = await createModelLister({
      settings: settingsStub(CONFIG, KEY),
      fetchImpl
    }).list();
    expect(result).toEqual({ ok: true, models: ["mochen-8B"] });
    expect(modelListResultSchema.safeParse(result).success).toBe(true);
    expect(calls.length).toBe(1);
  });

  it("密钥只进 Authorization 头：URL 里没有它，头名与形状逐字钉死", async () => {
    const { fetchImpl, calls } = fetchStub([{ ok: true, payload: { data: [{ id: "m" }] } }]);
    await createModelLister({ settings: settingsStub(CONFIG, KEY), fetchImpl }).list();
    const call = calls[0];
    expect(call?.url).toBe("http://127.0.0.1:8788/v1/models");
    expect(call?.url).not.toContain(KEY);
    expect(call?.method).toBe("GET");
    expect(call?.headers["Authorization"]).toBe(`Bearer ${KEY}`);
  });

  it("没有密钥 ⇒ 压根不发 Authorization 头，而不是发 `Bearer undefined`", async () => {
    const { fetchImpl, calls } = fetchStub([{ ok: true, payload: { data: [{ id: "m" }] } }]);
    await createModelLister({ settings: settingsStub(CONFIG, null), fetchImpl }).list();
    expect(calls[0]?.headers).not.toHaveProperty("Authorization");
  });

  it("还没配置 baseURL ⇒ 不出网，理由是 executable 的中文一句", async () => {
    const { fetchImpl, calls } = fetchStub([]);
    const result = await createModelLister({
      settings: settingsStub(null, KEY),
      fetchImpl
    }).list();
    expect(calls.length).toBe(0);
    expect(result.ok).toBe(false);
    expect((result as Extract<ModelListResult, { ok: false }>).reason).toContain("模型设置");
  });

  it("配置文件读不出来（主进程抛中文）⇒ 收成 ok:false，不把异常抛过 IPC", async () => {
    const settings: ProviderSettings = {
      ...settingsStub(CONFIG, KEY),
      config: async () => {
        throw new Error("模型配置文件读取失败；请检查该文件是否被占用或有访问权限。");
      }
    };
    const result = await createModelLister({ settings, fetchImpl: fetchStub([]).fetchImpl }).list();
    expect(result.ok).toBe(false);
    expect((result as Extract<ModelListResult, { ok: false }>).reason).toContain("占用");
  });

  it("401 与 403 ⇒ 说密钥那一层；404 ⇒ 说这个地址没有列表接口、去手填", async () => {
    for (const [status, needle] of [
      [401, "密钥"],
      [403, "密钥"],
      [404, "手填"]
    ] as const) {
      const result = await createModelLister({
        settings: settingsStub(CONFIG, KEY),
        fetchImpl: fetchStub([{ ok: false, status }]).fetchImpl
      }).list();
      expect(
        (result as Extract<ModelListResult, { ok: false }>).reason,
        `HTTP ${status}`
      ).toContain(needle);
    }
    const other = await createModelLister({
      settings: settingsStub(CONFIG, KEY),
      fetchImpl: fetchStub([{ ok: false, status: 500 }]).fetchImpl
    }).list();
    expect((other as Extract<ModelListResult, { ok: false }>).reason).toContain("HTTP 500");
  });

  it("连不上与超时是两句不同的话：不能把「等久了」报成「地址不对」", async () => {
    const refused = await createModelLister({
      settings: settingsStub(CONFIG, KEY),
      fetchImpl: fetchStub([
        { error: Object.assign(new Error("fetch failed"), { name: "TypeError" }) }
      ]).fetchImpl
    }).list();
    expect((refused as Extract<ModelListResult, { ok: false }>).reason).toContain("连不上");

    const timedOut = await createModelLister({
      settings: settingsStub(CONFIG, KEY),
      fetchImpl: fetchStub([
        { error: Object.assign(new Error("The operation timed out"), { name: "TimeoutError" }) }
      ]).fetchImpl
    }).list();
    expect((timedOut as Extract<ModelListResult, { ok: false }>).reason).toContain("超时");
    expect((timedOut as Extract<ModelListResult, { ok: false }>).reason).not.toContain("连不上");
  });

  it("200 但回来的不是 JSON ⇒ 说这个地址多半不兼容，而不是甩一句裸解析错误", async () => {
    const result = await createModelLister({
      settings: settingsStub(CONFIG, KEY),
      fetchImpl: async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error("<!DOCTYPE html> is not valid JSON");
          }
        }) as never
    }).list();
    expect((result as Extract<ModelListResult, { ok: false }>).reason).toContain("不是 JSON");
  });

  it("列表为空 ⇒ 也是一句看得懂的理由，不是弹层上一片空白", async () => {
    const result = await createModelLister({
      settings: settingsStub(CONFIG, KEY),
      fetchImpl: fetchStub([{ ok: true, payload: { data: [] } }]).fetchImpl
    }).list();
    expect(result.ok).toBe(false);
    expect((result as Extract<ModelListResult, { ok: false }>).reason).toContain(
      "没有返回任何模型"
    );
  });

  it("任何失败理由里都不许出现密钥：上游错误体可能被塞进原因", async () => {
    const leaky = Object.assign(new Error(`连接被拒绝：${KEY}`), { name: "TypeError" });
    for (const fetchImpl of [
      fetchStub([{ error: leaky }]).fetchImpl,
      fetchStub([{ ok: false, status: 401 }]).fetchImpl
    ]) {
      const result = await createModelLister({
        settings: settingsStub(CONFIG, KEY),
        fetchImpl
      }).list();
      expect(JSON.stringify(result)).not.toContain(KEY);
    }
  });
});
