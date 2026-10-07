import { describe, expect, it } from "vitest";
import {
  CUSTOM_PROVIDER_ID,
  LEGACY_CONNECTION_ID,
  PROVIDER_DIALOG_GROUPS,
  PROVIDER_PRESETS,
  customConnectionLabel,
  defaultAuthHeaderOf,
  detectProviderByBaseURL,
  guessProviderIdOf,
  migrateProviderStore,
  presetOf,
  providerLabelOf,
  type ProviderGroup
} from "../src/provider.js";

const httpUrl = /^https?:\/\//;

describe("内置供应商清单", () => {
  it("id 唯一、地址与密钥页都是合法 URL、常用模型非空", () => {
    const ids = PROVIDER_PRESETS.map((p) => p.id);
    expect(new Set(ids).size, "有重复的 id").toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(9);
    for (const preset of PROVIDER_PRESETS) {
      expect(preset.baseURL, `${preset.id} 的 baseURL 不合法`).toMatch(httpUrl);
      expect(preset.keyUrl, `${preset.id} 的密钥页不合法`).toMatch(httpUrl);
      expect(preset.models.length, `${preset.id} 没有常用模型`).toBeGreaterThan(0);
      expect(preset.label.trim(), `${preset.id} 没有显示名`).not.toBe("");
    }
  });

  it("国内与国外都有，**且不含本机端点**（2026-10-06 用户裁定：不要本地的）", () => {
    const groups = new Set(PROVIDER_PRESETS.map((p) => p.group));
    expect([...groups].sort()).toEqual(["cn", "global"]);
    // 本机 Ollama 只作为「自定义」里的一颗快捷按钮存在，不占预设位。
    for (const preset of PROVIDER_PRESETS) {
      expect(preset.baseURL, `${preset.id} 不该指向本机`).not.toMatch(
        /^http:\/\/(127\.0\.0\.1|localhost)/
      );
    }
  });

  it("分组表覆盖每一枚预置 + 自定义，一枚不多一枚不少（加一家就要落进某个分组）", () => {
    const listed = PROVIDER_DIALOG_GROUPS.flatMap((g) => g.ids);
    const expected = [...PROVIDER_PRESETS.map((p) => p.id), CUSTOM_PROVIDER_ID].sort();
    expect([...listed].sort()).toEqual(expected);
    // 分组里的每个 id 都得是真预置或自定义那一个。
    for (const id of listed) {
      expect(
        id === CUSTOM_PROVIDER_ID || presetOf(id) !== null,
        `${id} 既不是预置也不是自定义`
      ).toBe(true);
    }
  });

  it("每家都能查到：id → 预设 → 显示名 → 默认请求头", () => {
    for (const preset of PROVIDER_PRESETS) {
      expect(presetOf(preset.id)).toEqual(preset);
      expect(providerLabelOf(preset.id)).toBe(preset.label);
      expect(defaultAuthHeaderOf(preset.id)).toBe(preset.authHeader);
    }
  });

  it("**小米 MiMo 走 api-key 头**，其余是 Bearer —— MiMo 官方只认 api-key", () => {
    // 这条错了的后果很具体：选了 MiMo 永远 401，而用户查不出原因。
    expect(presetOf("mimo")?.authHeader).toBe("api-key");
    for (const preset of PROVIDER_PRESETS.filter((p) => p.id !== "mimo")) {
      expect(preset.authHeader, `${preset.id} 不该是 api-key`).toBe("bearer");
    }
  });

  it("自定义不是预设：查不到、名字是那句中文、默认头是 Bearer（界面上可改）", () => {
    expect(presetOf(CUSTOM_PROVIDER_ID)).toBeNull();
    expect(providerLabelOf(CUSTOM_PROVIDER_ID)).toBe("自定义（自己填地址）");
    expect(defaultAuthHeaderOf(CUSTOM_PROVIDER_ID)).toBe("bearer");
  });

  it("认不出的 id 原样回显，不假装认识（宁可难看也不编一个名字）", () => {
    expect(providerLabelOf("no-such-provider")).toBe("no-such-provider");
    expect(presetOf("no-such-provider")).toBeNull();
  });

  it("分组名穷尽：每一组都有中文标题，没有裸枚举露给用户", () => {
    const labels: Record<ProviderGroup, string> = {
      cn: "国内",
      global: "国外",
      custom: "自定义"
    };
    for (const group of PROVIDER_DIALOG_GROUPS) {
      expect(group.label).toBe(labels[group.group]);
      expect(group.label.trim()).not.toBe("");
    }
  });
});

describe("按地址反查是哪家（老配置迁移用）", () => {
  it("地址对上了就认出来，并带上那家的默认请求头", () => {
    expect(guessProviderIdOf("https://api.deepseek.com/v1")).toBe("deepseek");
    expect(guessProviderIdOf("https://openrouter.ai/api/v1")).toBe("openrouter");
  });

  it("尾部多个斜杠、或者大小写不同，都还认得出", () => {
    expect(guessProviderIdOf("https://api.deepseek.com/v1///")).toBe("deepseek");
    expect(guessProviderIdOf("https://API.DeepSeek.com/v1")).toBe("deepseek");
  });

  it("认不出的地址老实归自定义，**不猜**（猜错＝密钥发去了另一家的地址）", () => {
    expect(guessProviderIdOf("http://127.0.0.1:8899/v1")).toBe(CUSTOM_PROVIDER_ID);
    expect(guessProviderIdOf("https://api.some-proxy.example.com/v1")).toBe(CUSTOM_PROVIDER_ID);
    expect(guessProviderIdOf("")).toBe(CUSTOM_PROVIDER_ID);
  });
});

describe("配置文件迁移：v1 / v2 / v3 三代都要接住", () => {
  it("已经是 v3：原样返回，并明说「没迁过」", () => {
    const v3 = {
      connections: [
        {
          id: "c1",
          providerId: "deepseek",
          baseURL: "https://api.deepseek.com/v1",
          authHeader: "bearer"
        }
      ],
      profiles: [{ id: "p1", connectionId: "c1", model: "deepseek-chat", enabled: true }]
    };
    const out = migrateProviderStore(v3);
    expect(out.migrated).toBe(false);
    expect(out.store).toEqual(v3);
  });

  it("v2（地址全局一份）：造一条连接，档案全部挂上去，**档案 id 一个都不变**", () => {
    const v2 = {
      baseURL: "https://api.deepseek.com/v1",
      profiles: [
        { id: "keep-me-1", model: "deepseek-chat", enabled: true },
        { id: "keep-me-2", model: "deepseek-reasoner", enabled: false }
      ]
    };
    const out = migrateProviderStore(v2);
    expect(out.migrated).toBe(true);
    expect(out.store.connections).toHaveLength(1);
    // 地址认得出是哪家，就挂到那家名下（连默认请求头一起带过来）。
    expect(out.store.connections[0]?.providerId).toBe("deepseek");
    expect(out.store.connections[0]?.baseURL).toBe("https://api.deepseek.com/v1");
    expect(out.store.connections[0]?.authHeader).toBe("bearer");
    // 启停状态原样保留：用户停用过的那条不能被迁移成启用。
    expect(out.store.profiles).toEqual([
      {
        id: "keep-me-1",
        connectionId: LEGACY_CONNECTION_ID,
        model: "deepseek-chat",
        enabled: true
      },
      {
        id: "keep-me-2",
        connectionId: LEGACY_CONNECTION_ID,
        model: "deepseek-reasoner",
        enabled: false
      }
    ]);
  });

  it("v1（{baseURL, model}）：造一条连接 + 一条启用档案", () => {
    const out = migrateProviderStore({
      baseURL: "https://api.moonshot.cn/v1",
      model: "moonshot-v1-8k"
    });
    expect(out.migrated).toBe(true);
    expect(out.store.connections[0]?.providerId).toBe("kimi");
    expect(out.store.profiles).toEqual([
      {
        id: LEGACY_CONNECTION_ID,
        connectionId: LEGACY_CONNECTION_ID,
        model: "moonshot-v1-8k",
        enabled: true
      }
    ]);
  });

  it("迁出来的连接 id 是**固定的 legacy**，不是随机数", () => {
    // 随机 id 会让「第一次迁移之后改的密钥」在下次迁移后读不到——密钥桶名变了。
    const v2 = {
      baseURL: "https://api.deepseek.com/v1",
      profiles: [{ id: "p", model: "m", enabled: true }]
    };
    const a = migrateProviderStore(v2);
    const b = migrateProviderStore(v2);
    expect(a.store.connections[0]?.id).toBe(LEGACY_CONNECTION_ID);
    expect(a.store.connections[0]?.id).toBe(b.store.connections[0]?.id);
    // 反复喂同一份老配置，结果稳定（纯函数，无随机、无时钟）。
    expect(a).toEqual(b);
  });

  it("认不出的地址迁移后是自定义连接，请求头按 Bearer 起步", () => {
    const out = migrateProviderStore({
      baseURL: "http://127.0.0.1:8899/v1",
      profiles: [{ id: "p", model: "mochen-mock", enabled: true }]
    });
    expect(out.store.connections[0]?.providerId).toBe(CUSTOM_PROVIDER_ID);
    expect(out.store.connections[0]?.authHeader).toBe("bearer");
  });

  it("三代都认不出：抛一句中文（跨 IPC 直接给用户看），不留半套结构", () => {
    expect(() => migrateProviderStore({ nope: true })).toThrow(/模型配置文件缺字段/);
    expect(() => migrateProviderStore(null)).toThrow(/重新保存一次即可修复/);
    expect(() => migrateProviderStore("")).toThrow(/模型配置文件缺字段/);
  });

  it("v3 形状不合法时不会静默降级去读成 v2（半份 connections 会被当成老配置）", () => {
    // profiles 挂在不存在的连接上——这在 v3 里是非法的，迁移必须报错而不是放行。
    const broken = {
      connections: [],
      profiles: [{ id: "p", connectionId: "nope", model: "m", enabled: true }]
    };
    expect(() => migrateProviderStore(broken)).toThrow(/模型配置文件缺字段/);
  });
});

describe("自定义连接的卡片名（2026-10-06）", () => {
  it("带主机名：两条自定义并排时，用户得分得出哪张是哪张", () => {
    expect(customConnectionLabel("https://apihub.agnes-ai.com/v1")).toBe(
      "自定义 · apihub.agnes-ai.com"
    );
    expect(customConnectionLabel("http://127.0.0.1:8899/v1")).toBe("自定义 · 127.0.0.1");
  });

  it("只取主机名，端口与路径都不进名字（那是下一行地址那一栏在显示）", () => {
    expect(customConnectionLabel("https://api.example.com:8443/some/deep/path/v1")).toBe(
      "自定义 · api.example.com"
    );
  });

  // 这个名字只用来显示。为它把整张视图搞挂不划算，所以任何认不出来的输入都退回通用名。
  it("认不出来就退回通用名：不抛、也不给空串", () => {
    expect(customConnectionLabel("")).toBe("自定义（自己填地址）");
    expect(customConnectionLabel("   ")).toBe("自定义（自己填地址）");
    expect(customConnectionLabel("不是网址")).toBe("自定义（自己填地址）");
    expect(customConnectionLabel("https://")).toBe("自定义（自己填地址）");
  });

  it("预置供应商不受影响：它们有自己的名字，不该被主机名改掉", () => {
    expect(providerLabelOf("deepseek")).toBe("DeepSeek");
    // providerLabelOf 对 custom 仍返回通用名——卡片那次是拿 baseURL 另算的。
    expect(providerLabelOf(CUSTOM_PROVIDER_ID)).toBe("自定义（自己填地址）");
  });
});

/**
 * 地址 → 服务商识别（2026-10-06 批次 5-⑧）。
 *
 * 用户要的是：填好地址和密钥之后，**自动认出这是哪家**，而不是永远叫「自定义 · 主机名」。
 *
 * 钉的是三件事，缺一件这个功能就只是「换了个说法」：
 * ① 认得出来的**不止名字**——连密钥头（MiMo 走 `api-key`）与密钥页一起给，
 *    否则用户在自定义里手填 MiMo 的地址会永远 401，界面还不告诉他原因；
 * ② 认不出来时**不许猜模型名**——猜出来的模型名会让保存按钮看着有值，实际发出去多半 404；
 * ③ 认不出来时**不许抛、不许返回空串**——退回 5-⑥ 那一档，识别是加分项不是前置条件。
 */
describe("detectProviderByBaseURL · 拿地址认服务商", () => {
  it("官方地址认得出真名、密钥头、密钥页与常用模型", () => {
    const deepseek = detectProviderByBaseURL("https://api.deepseek.com/v1");
    expect(deepseek.known).toBe(true);
    expect(deepseek.label).toBe("DeepSeek");
    expect(deepseek.presetId).toBe("deepseek");
    expect(deepseek.authHeader).toBe("bearer");
    expect(deepseek.keyUrl).toContain("deepseek");
    expect(deepseek.suggestedModels.length).toBeGreaterThan(0);
  });

  it("**小米 MiMo 的密钥头是 api-key 而不是 bearer**——认出来就必须把它带出来", () => {
    const mimo = detectProviderByBaseURL("https://api.xiaomimimo.com/v1");
    expect(mimo.label).toBe("小米 MiMo");
    // 这是「认出家却没给出关键信息 = 白认」的典型：手填地址不改头就是永远 401
    expect(mimo.authHeader).toBe("api-key");
    // Token Plan 订阅是另一个域名，同样要能认出来
    expect(detectProviderByBaseURL("https://token-plan-cn.xiaomimimo.com/v1").known).toBe(true);
  });

  it("同一家的多个域名都认得（国际版 / 区域站 / 兼容层）", () => {
    expect(detectProviderByBaseURL("https://api.minimax.io/v1").label).toBe("MiniMax");
    expect(detectProviderByBaseURL("https://api.moonshot.ai/v1").label).toBe("Kimi 月之暗面");
    expect(
      detectProviderByBaseURL("https://generativelanguage.googleapis.com/v1beta/openai/").label
    ).toBe("Google Gemini");
  });

  it("子域名也算命中（cdn. 或区域前缀不该让人工去对）", () => {
    expect(detectProviderByBaseURL("https://cn.api.deepseek.com/v1").known).toBe(true);
  });

  it("清单外的中转站：给一个像样的名字，但**不给**密钥页与模型名（那些我们没出处）", () => {
    const hub = detectProviderByBaseURL("https://apihub.agnes-ai.com/v1");
    expect(hub.known).toBe(true);
    expect(hub.label).toContain("Agnes");
    // 认出来的是「名字」，不是「官方预设」：这两件事不许混
    expect(hub.presetId).toBe("");
    expect(hub.keyUrl).toBe("");
    expect(hub.suggestedModels).toEqual([]);
  });

  it("认不出来 ⇒ known:false，退回「自定义 · 主机名」，一个字都不许猜", () => {
    const unknown = detectProviderByBaseURL("https://my-proxy.example.com/v1");
    expect(unknown.known).toBe(false);
    expect(unknown.presetId).toBe("");
    expect(unknown.keyUrl).toBe("");
    expect(unknown.suggestedModels).toEqual([]); // 猜模型名会让保存看着有值、发出去多半 404
    expect(unknown.label).toContain("my-proxy.example.com");
  });

  it("坏输入不抛、不返回空串（地址还没填完时它会被反复调用）", () => {
    for (const bad of ["", "   ", "不是网址", "https://", "://x", "ftp://a.b", "   \n  "]) {
      const r = detectProviderByBaseURL(bad);
      expect(r.label.length).toBeGreaterThan(0);
      expect(typeof r.known).toBe("boolean");
    }
  });

  it("大小写与末尾斜杠都不影响识别（用户是从浏览器地址栏粘的）", () => {
    expect(detectProviderByBaseURL("https://API.DeepSeek.COM/v1/").label).toBe("DeepSeek");
  });

  it("认出来的那一家，其密钥头与预设表里写的一致（两处不许各写一份）", () => {
    for (const preset of PROVIDER_PRESETS) {
      const r = detectProviderByBaseURL(preset.baseURL);
      if (!r.known) continue;
      expect(r.label).toBe(preset.label);
      expect(r.authHeader).toBe(preset.authHeader);
    }
  });
});
