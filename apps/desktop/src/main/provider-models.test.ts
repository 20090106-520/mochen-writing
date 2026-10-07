import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { modelListResultSchema, type ModelListResult } from "@mochen/contracts";
import {
  authHeadersOf,
  createModelLister,
  modelIdsOf,
  modelsUrlOf,
  networkFailureOf,
  networkReason,
  resolveModelListTarget,
  type ModelListFetcher
} from "./provider-models.js";
import type { ProviderSettings } from "./provider-settings.js";

const KEY = "sk-NEVER-in-url-NEVER-in-reason-0000000000";
const DRAFT_KEY = "sk-draft-key-typed-in-dialog-000000000";

const CONN = "conn-1";

function settingsStub(
  baseURL: string,
  key: string | null,
  authHeader: "bearer" | "api-key" = "bearer"
): ProviderSettings {
  return {
    // list 只用读侧两条（view 找启用中那条、connectionTarget 取它那条连接的地址与密钥）；
    // 其余通路到了这里都算越权。
    view: async () => ({
      connections:
        baseURL === ""
          ? []
          : [
              {
                id: CONN,
                providerId: "custom",
                label: "自定义（自己填地址）",
                baseURL,
                authHeader,
                hasKey: key !== null,
                keyMask: ""
              }
            ],
      // 配了地址就算「有模型可选」，这样「连不上」与「没配置」仍是两件事。
      profiles: baseURL === "" ? [] : [{ id: "p-1", connectionId: CONN, model: "m", enabled: true }]
    }),
    connectionTarget: async (id: string) =>
      id === CONN && baseURL !== "" ? { baseURL, authHeader, key } : null,
    config: async () => {
      throw new Error("枚举模型不许走 config()：那个取数形状归 agent-service");
    },
    apiKey: async () => key,
    saveConnection: async () => {
      throw new Error("枚举模型永不写配置");
    },
    removeConnection: async () => {
      throw new Error("枚举模型永不写配置");
    },
    upsertProfile: async () => {
      throw new Error("枚举模型永不写档案");
    },
    removeProfile: async () => {
      throw new Error("枚举模型永不写档案");
    },
    enableProfile: async () => {
      throw new Error("枚举模型永不写档案");
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

const CONFIG_URL = "http://127.0.0.1:8788/v1";

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

/**
 * 密钥进哪个头（2026-10-06 批次 5-⑤ 新增行为）。
 *
 * **为什么这条要单独钉**：小米 MiMo 官方只认 `api-key` 头，发 Bearer 会**永远 401**，
 * 而界面上一切正常、地址也对、密钥也对——用户查不出原因。这正是「能切供应商」带出来的新坑。
 */
describe("authHeadersOf · 头名跟着连接走", () => {
  it("默认发 Authorization: Bearer", () => {
    expect(authHeadersOf({ baseURL: "http://a/v1", key: "sk-1", authHeader: "bearer" })).toEqual({
      Accept: "application/json",
      Authorization: "Bearer sk-1"
    });
  });

  it("api-key 形态发 api-key，**不发 Authorization**（MiMo 那样）", () => {
    const headers = authHeadersOf({ baseURL: "http://a/v1", key: "sk-1", authHeader: "api-key" });
    expect(headers["api-key"]).toBe("sk-1");
    expect(headers).not.toHaveProperty("Authorization");
  });

  it("没有密钥 ⇒ **两个头都不发**，而不是发 `Bearer undefined`（本机端点常不需要）", () => {
    for (const authHeader of ["bearer", "api-key"] as const) {
      const headers = authHeadersOf({ baseURL: "http://a/v1", key: null, authHeader });
      expect(headers).toEqual({ Accept: "application/json" });
      expect(headers).not.toHaveProperty("Authorization");
      expect(headers).not.toHaveProperty("api-key");
    }
  });

  it("纯空白的密钥等同于没给（不发 `Bearer   `）", () => {
    expect(authHeadersOf({ baseURL: "http://a/v1", key: "   ", authHeader: "bearer" })).toEqual({
      Accept: "application/json"
    });
  });
});

describe("resolveModelListTarget · 已存密钥只发往已存地址", () => {
  const stored = { baseURL: "http://stored/v1", key: KEY, authHeader: "bearer" as const };

  it("没传草稿 ⇒ 用已存的一对", () => {
    expect(resolveModelListTarget(stored)).toEqual({
      baseURL: "http://stored/v1",
      key: KEY,
      authHeader: "bearer"
    });
    expect(resolveModelListTarget(stored, {})).toEqual({
      baseURL: "http://stored/v1",
      key: KEY,
      authHeader: "bearer"
    });
  });

  it("草稿给了密钥就跟草稿地址配对（对话框里现填的那一对）", () => {
    expect(
      resolveModelListTarget(stored, { baseURL: "http://draft/v1", apiKey: DRAFT_KEY })
    ).toEqual({ baseURL: "http://draft/v1", key: DRAFT_KEY, authHeader: "bearer" });
    // 只有草稿密钥、没改地址：密钥是新的，地址用已存的。
    expect(resolveModelListTarget(stored, { apiKey: DRAFT_KEY })).toEqual({
      baseURL: "http://stored/v1",
      key: DRAFT_KEY,
      authHeader: "bearer"
    });
  });

  it("地址换过又没给新密钥 ⇒ 裸连：绝不把已存密钥发往另一个地址", () => {
    expect(resolveModelListTarget(stored, { baseURL: "http://elsewhere/v1" })).toEqual({
      baseURL: "http://elsewhere/v1",
      key: null,
      authHeader: "bearer"
    });
  });

  it("草稿地址与已存地址相同 ⇒ 仍是已存配置，密钥照常带上", () => {
    expect(resolveModelListTarget(stored, { baseURL: " http://stored/v1 " })).toEqual({
      baseURL: "http://stored/v1",
      key: KEY,
      authHeader: "bearer"
    });
  });

  it("草稿密钥是纯空白 ⇒ 等于没给，走地址守卫而不是发 `Bearer   `", () => {
    expect(
      resolveModelListTarget(stored, { baseURL: "http://elsewhere/v1", apiKey: "   " })
    ).toEqual({ baseURL: "http://elsewhere/v1", key: null, authHeader: "bearer" });
  });
});

describe("createModelLister().list", () => {
  it("配置齐全 ⇒ ok:true，且结果过 modelListResultSchema（跨 IPC 的形状在此当场验）", async () => {
    const { fetchImpl, calls } = fetchStub([
      { ok: true, payload: { data: [{ id: "mochen-8B" }] } }
    ]);
    const result = await createModelLister({
      settings: settingsStub(CONFIG_URL, KEY),
      fetchImpl
    }).list();
    expect(result).toEqual({ ok: true, models: ["mochen-8B"] });
    expect(modelListResultSchema.safeParse(result).success).toBe(true);
    expect(calls.length).toBe(1);
  });

  it("密钥只进 Authorization 头：URL 里没有它，头名与形状逐字钉死", async () => {
    const { fetchImpl, calls } = fetchStub([{ ok: true, payload: { data: [{ id: "m" }] } }]);
    await createModelLister({ settings: settingsStub(CONFIG_URL, KEY), fetchImpl }).list();
    const call = calls[0];
    expect(call?.url).toBe("http://127.0.0.1:8788/v1/models");
    expect(call?.url).not.toContain(KEY);
    expect(call?.method).toBe("GET");
    expect(call?.headers["Authorization"]).toBe(`Bearer ${KEY}`);
  });

  it("没有密钥 ⇒ 压根不发 Authorization 头，而不是发 `Bearer undefined`", async () => {
    const { fetchImpl, calls } = fetchStub([{ ok: true, payload: { data: [{ id: "m" }] } }]);
    await createModelLister({ settings: settingsStub(CONFIG_URL, null), fetchImpl }).list();
    expect(calls[0]?.headers).not.toHaveProperty("Authorization");
  });

  it("一条模型都没有 ⇒ 不出网，理由告诉用户先去添加（不是「没配置地址」了）", async () => {
    const { fetchImpl, calls } = fetchStub([]);
    const result = await createModelLister({
      settings: settingsStub("", KEY),
      fetchImpl
    }).list();
    expect(calls.length).toBe(0);
    expect(result.ok).toBe(false);
    expect((result as Extract<ModelListResult, { ok: false }>).reason).toContain("添加模型");
  });

  it("有连接但一条模型都没启用 ⇒ 说清是「没启用」，不是「没添加」", async () => {
    const { fetchImpl, calls } = fetchStub([]);
    const base = settingsStub(CONFIG_URL, KEY);
    const settings: ProviderSettings = {
      ...base,
      view: async () => ({ connections: [], profiles: [] })
    };
    // 一条都没有 ⇒ 走「先添加」那一支。
    expect((await createModelLister({ settings, fetchImpl }).list()).ok).toBe(false);
    const withProfiles: ProviderSettings = {
      ...base,
      view: async () => ({
        connections: [],
        profiles: [{ id: "p", connectionId: CONN, model: "m", enabled: false }]
      })
    };
    const result = await createModelLister({ settings: withProfiles, fetchImpl }).list();
    expect((result as Extract<ModelListResult, { ok: false }>).reason).toContain("启用");
    expect(calls.length).toBe(0);
  });

  it("**点名一条连接去体检**：走那一条自己的地址与密钥，不碰启用中那条", async () => {
    const { fetchImpl, calls } = fetchStub([{ ok: true, payload: { data: [{ id: "mimo" }] } }]);
    const settings: ProviderSettings = {
      ...settingsStub(CONFIG_URL, KEY),
      view: async () => ({ connections: [], profiles: [] }),
      connectionTarget: async (id: string) =>
        id === "mimo-conn"
          ? { baseURL: "https://api.xiaomimimo.com/v1", authHeader: "api-key", key: "sk-mimo" }
          : null
    };
    const result = await createModelLister({ settings, fetchImpl }).list({
      connectionId: "mimo-conn"
    });
    expect(result).toEqual({ ok: true, models: ["mimo"] });
    expect(calls[0]?.url).toBe("https://api.xiaomimimo.com/v1/models");
    expect(calls[0]?.headers["api-key"]).toBe("sk-mimo");
  });

  it("体检一条不存在的连接 ⇒ 不出网，说人话", async () => {
    const { fetchImpl, calls } = fetchStub([]);
    const result = await createModelLister({
      settings: settingsStub(CONFIG_URL, KEY),
      fetchImpl
    }).list({
      connectionId: "ghost"
    });
    expect(calls.length).toBe(0);
    expect((result as Extract<ModelListResult, { ok: false }>).reason).toContain(
      "没有找到这条连接"
    );
  });

  it("还没配置但给了草稿地址与密钥 ⇒ 出网到草稿地址，密钥用草稿那把（对话框首配流程）", async () => {
    const { fetchImpl, calls } = fetchStub([{ ok: true, payload: { data: [{ id: "m" }] } }]);
    await createModelLister({ settings: settingsStub("", null), fetchImpl }).list({
      baseURL: "http://draft/v1",
      apiKey: DRAFT_KEY
    });
    const call = calls[0];
    expect(call?.url).toBe("http://draft/v1/models");
    expect(call?.headers["Authorization"]).toBe(`Bearer ${DRAFT_KEY}`);
  });

  it("草稿换地址没给密钥 ⇒ 出网到草稿地址且不带 Authorization（已存密钥不出门）", async () => {
    const { fetchImpl, calls } = fetchStub([{ ok: true, payload: { data: [{ id: "m" }] } }]);
    await createModelLister({ settings: settingsStub(CONFIG_URL, KEY), fetchImpl }).list({
      baseURL: "http://elsewhere/v1"
    });
    const call = calls[0];
    expect(call?.url).toBe("http://elsewhere/v1/models");
    expect(call?.headers).not.toHaveProperty("Authorization");
  });

  it("配置文件读不出来（主进程抛中文）⇒ 收成 ok:false，不把异常抛过 IPC", async () => {
    const settings: ProviderSettings = {
      ...settingsStub(CONFIG_URL, KEY),
      view: async () => {
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
        settings: settingsStub(CONFIG_URL, KEY),
        fetchImpl: fetchStub([{ ok: false, status }]).fetchImpl
      }).list();
      expect(
        (result as Extract<ModelListResult, { ok: false }>).reason,
        `HTTP ${status}`
      ).toContain(needle);
    }
    const other = await createModelLister({
      settings: settingsStub(CONFIG_URL, KEY),
      fetchImpl: fetchStub([{ ok: false, status: 500 }]).fetchImpl
    }).list();
    expect((other as Extract<ModelListResult, { ok: false }>).reason).toContain("HTTP 500");
  });

  it("连不上与超时是两句不同的话：不能把「等久了」报成「地址不对」", async () => {
    const refused = await createModelLister({
      settings: settingsStub(CONFIG_URL, KEY),
      fetchImpl: fetchStub([
        { error: Object.assign(new Error("fetch failed"), { name: "TypeError" }) }
      ]).fetchImpl
    }).list();
    expect((refused as Extract<ModelListResult, { ok: false }>).reason).toContain("连不上");

    const timedOut = await createModelLister({
      settings: settingsStub(CONFIG_URL, KEY),
      fetchImpl: fetchStub([
        { error: Object.assign(new Error("The operation timed out"), { name: "TimeoutError" }) }
      ]).fetchImpl
    }).list();
    expect((timedOut as Extract<ModelListResult, { ok: false }>).reason).toContain("超时");
    expect((timedOut as Extract<ModelListResult, { ok: false }>).reason).not.toContain("连不上");
  });

  it("200 但回来的不是 JSON ⇒ 说这个地址多半不兼容，而不是甩一句裸解析错误", async () => {
    const result = await createModelLister({
      settings: settingsStub(CONFIG_URL, KEY),
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
      settings: settingsStub(CONFIG_URL, KEY),
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
        settings: settingsStub(CONFIG_URL, KEY),
        fetchImpl
      }).list();
      expect(JSON.stringify(result)).not.toContain(KEY);
    }
  });
});

/**
 * #104：上面整段用的是自记调用的假 fetch，于是「去重与排序」只在纯函数那一层被验过。
 * 这里把 `tools/mock-provider.mjs` 当**真对手**跑一遍真实 socket：桩给的名单是乱序且带重复的
 * （见 MOCK_MODELS），所以这一发同时钉住「解析器真的在链路上做了它该做的事」与「拼接出来的
 * `{baseURL}/models` 能被一个活的服务认」。端口/进程口径与 turn-e2e.test.ts 同一套。
 */
describe("createModelLister 对 mock provider 真 socket", () => {
  const ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  let port = 0;
  let child: ReturnType<typeof spawn> | null = null;

  beforeAll(async () => {
    port = await new Promise<number>((resolve, reject) => {
      const probe = createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        const value = typeof address === "object" && address ? address.port : 0;
        probe.close(() => resolve(value));
      });
    });
    child = spawn(
      process.execPath,
      [join(ROOT, "tools", "mock-provider.mjs"), "--port", String(port)],
      {
        stdio: "ignore"
      }
    );
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/__health`)).ok) return;
      } catch {
        // 还没起来
      }
      await sleep(50);
    }
    throw new Error(`mock provider 没能在端口 ${port} 起来`);
  });

  afterAll(() => {
    child?.kill();
  });

  it("桩给乱序含重复的四条 ⇒ 通道回来的是去重升序的三条，密钥只在头里", async () => {
    const result = await createModelLister({
      settings: settingsStub(`http://127.0.0.1:${port}/v1`, KEY)
    }).list();
    expect(result).toEqual({
      ok: true,
      models: ["aether-7b-instruct", "mochen-mock", "mochen-mock-long"]
    });

    const log = (await (await fetch(`http://127.0.0.1:${port}/__requests`)).json()) as {
      url: string;
      method: string;
      hasAuth: boolean;
    }[];
    const got = log.find((item) => item.url.endsWith("/models"));
    expect(got?.method).toBe("GET");
    expect(got?.hasAuth).toBe(true);
    expect(got?.url).not.toContain(KEY);
    expect(JSON.stringify(log)).not.toContain(KEY);
  });
});

/**
 * 出网失败的归类（2026-10-06 真机实测带出来的）。
 *
 * 起因是那台只签了 IP 的边缘节点：地址完全正确、密钥也能用，
 * 旧文案却一律报「地址填错了」，把用户送去改一个没写错的地址。
 * 这一整段钉的是**每一类失败都要说自己的话**，以及最要紧的那条反向钉：
 * 证书这一支**不许**出现任何「关掉证书校验」式的旁路提示。
 */
describe("networkFailureOf · 出网失败归类", () => {
  /** 真机形状：fetch 抛 TypeError，真因在 cause.code 上（这一条就是那台边缘节点的原样）。 */
  function fetchFailedWith(cause: unknown): Error {
    return Object.assign(new TypeError("fetch failed"), { cause });
  }

  it("证书对不上域名 ⇒ tls-cert，而不是泛泛的「连不上」", () => {
    const error = fetchFailedWith(
      Object.assign(new Error("Hostname/IP does not match certificate's altnames"), {
        code: "ERR_TLS_CERT_ALTNAME_INVALID"
      })
    );
    expect(networkFailureOf(error)).toBe("tls-cert");
    // 真机那次的原话要能被认出来：这一版就是为了不再把它报成「地址填错了」
    expect(networkReason(error)).toContain("证书");
    expect(networkReason(error)).toContain("不是地址写错了");
  });

  it("还没列进来的 ERR_TLS_* 家族也归 tls-cert（OpenSSL 加新码不能退化成误导）", () => {
    for (const code of [
      "ERR_TLS_CERT_ALTNAME_INVALID",
      "ERR_TLS_SOMETHING_BRAND_NEW",
      "CERT_HAS_EXPIRED",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "DEPTH_ZERO_SELF_SIGNED_CERT"
    ]) {
      expect(networkFailureOf(fetchFailedWith(Object.assign(new Error("tls"), { code })))).toBe(
        "tls-cert"
      );
    }
  });

  it("域名解析不出来 ⇒ dns；这一类才该让用户去看地址", () => {
    for (const code of ["ENOTFOUND", "EAI_AGAIN"]) {
      const error = fetchFailedWith(Object.assign(new Error("dns"), { code }));
      expect(networkFailureOf(error)).toBe("dns");
      expect(networkReason(error)).toContain("域名");
    }
  });

  it("端口没人听 ⇒ refused；连不上 ≠ 地址拼错，可能只是服务没起", () => {
    const error = fetchFailedWith(Object.assign(new Error("refused"), { code: "ECONNREFUSED" }));
    expect(networkFailureOf(error)).toBe("refused");
    expect(networkReason(error)).toContain("端口");
  });

  it("连到一半断 / 路由不到 ⇒ unreachable", () => {
    for (const code of ["ECONNRESET", "EPIPE", "EHOSTUNREACH", "ENETUNREACH"]) {
      expect(networkFailureOf(fetchFailedWith(Object.assign(new Error("net"), { code })))).toBe(
        "unreachable"
      );
    }
  });

  it("超时仍然归超时，不与「连不上」混成一句（这一条是老守卫，别被改回去）", () => {
    const timedOut = Object.assign(new Error("The operation timed out"), { name: "TimeoutError" });
    expect(networkFailureOf(timedOut)).toBe("timeout");
    expect(networkReason(timedOut)).toContain("超时");
    expect(networkReason(timedOut)).not.toContain("连不上");
  });

  it("认不出来的形状 ⇒ generic，落在最后那句兜底上（不抛、不空串）", () => {
    for (const weird of [
      fetchFailedWith(undefined),
      new Error("boom"),
      "不是 Error",
      null,
      undefined
    ]) {
      expect(networkFailureOf(weird)).toBe("generic");
      expect(networkReason(weird).length).toBeGreaterThan(0);
    }
  });

  it("顶层就有 code 时同样认得出来（不假设真因一定挂在 cause 上）", () => {
    expect(networkFailureOf(Object.assign(new Error("x"), { code: "ENOTFOUND" }))).toBe("dns");
  });

  it("反向钉：证书这一支**绝不**提示关掉校验，也不带地址", () => {
    const reason = networkReason(
      fetchFailedWith(Object.assign(new Error("tls"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" }))
    );
    // 证书对不上就是不该连上。提示用户去关校验等于把一个安全后门交到手上。
    for (const forbidden of [
      "关闭证书",
      "关闭校验",
      "忽略证书",
      "NODE_TLS",
      "insecure",
      "不校验"
    ]) {
      expect(reason).not.toContain(forbidden);
    }
    expect(reason).not.toContain(KEY);
  });

  it("每一类的话都不带密钥与上游原文（上游那句可能含 URL、代理配置、贴错的密钥）", () => {
    const leaky = Object.assign(new Error(`failed to fetch ${KEY} via proxy`), {
      code: "ECONNRESET"
    });
    const reasons = [
      networkReason(leaky),
      networkReason(fetchFailedWith(Object.assign(new Error(KEY), { code: "ENOTFOUND" }))),
      networkReason(
        fetchFailedWith(Object.assign(new Error(KEY), { code: "ERR_TLS_CERT_ALTNAME_INVALID" }))
      )
    ];
    for (const reason of reasons) {
      expect(reason).not.toContain(KEY);
      expect(reason.length).toBeGreaterThan(0);
    }
  });
});

/** 归类不能只活在纯函数里：`list()` 抛出来的那句，用户就是直接看到的那句。 */
describe("createModelLister 把归类说给用户听", () => {
  async function reasonFor(error: unknown): Promise<string> {
    const result = await createModelLister({
      settings: settingsStub(CONFIG_URL, KEY),
      fetchImpl: fetchStub([{ error }]).fetchImpl
    }).list();
    if (result.ok) throw new Error("不该走到这里");
    return result.reason;
  }

  it("证书失败 ⇒ 弹层上那句话是「证书对不上域名」，不是「地址填错了」", async () => {
    const reason = await reasonFor(
      Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("Cert does not contain a DNS name"), {
          code: "ERR_TLS_CERT_ALTNAME_INVALID"
        })
      })
    );
    expect(reason).toContain("证书");
    expect(reason).toContain("不是地址写错了");
    expect(reason).not.toContain(KEY);
  });

  it("域名解析不出来 ⇒ 说域名；超时 ⇒ 说超时；三条各说各的", async () => {
    expect(
      await reasonFor(
        Object.assign(new TypeError("fetch failed"), {
          cause: Object.assign(new Error("d"), { code: "ENOTFOUND" })
        })
      )
    ).toContain("域名");
    expect(
      await reasonFor(Object.assign(new TypeError("fetch failed"), { name: "TimeoutError" }))
    ).toContain("超时");
    expect(await reasonFor(new TypeError("fetch failed"))).toContain("连不上");
  });
});
