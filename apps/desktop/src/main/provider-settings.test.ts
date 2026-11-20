import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCredentialStore, type CredentialStore } from "./credential-store.js";
import { createProviderSettings } from "./provider-settings.js";
import { atomicFsBrokenAt } from "./atomic-write-fs-fixture.js";

let dir = "";
let credentials: CredentialStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mochen-provider-v3-"));
  credentials = createCredentialStore(dir, {
    available: true,
    // 假加密用 base64url：密文里不含明文，过得去 credential-store 的「不许明文落盘」门禁。
    encrypt: (plain) => `enc:${Buffer.from(plain, "utf8").toString("base64url")}`,
    decrypt: (text) => {
      if (!text.startsWith("enc:")) throw new Error("坏");
      return Buffer.from(text.slice(4), "base64url").toString("utf8");
    }
  });
});
afterEach(async () => {
  for (const entry of await readdir(dir)) {
    await rm(path.join(dir, entry), { recursive: true, force: true });
  }
});

const DEEPSEEK = {
  providerId: "deepseek",
  baseURL: "https://api.deepseek.com/v1",
  authHeader: "bearer",
  thinkingWire: "standard"
} as const;
const MIMO = {
  providerId: "mimo",
  baseURL: "https://api.xiaomimimo.com/v1",
  authHeader: "api-key",
  thinkingWire: "standard"
} as const;

/** 读盘上那份 config.json（v3 形状）。 */
async function storeOnDisk(): Promise<unknown> {
  return JSON.parse(await readFile(path.join(dir, "config.json"), "utf8"));
}

/**
 * 跨 IPC 的拒绝必须是**单句中文**（裁定 n）：先把 message 取出来，
 * 再当场钉掉裸 ZodError 的骨架特征——把 safeParse 换回 parse 时 message 就是 issue 数组原文。
 */
async function rejectMessage(promise: Promise<unknown>): Promise<string> {
  const message = await promise.then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error))
  );
  if (message === null) throw new Error("期待拒绝，结果却 resolve 了");
  expect(message).not.toMatch(/ZodError|origin|too_big|too_small|\[|\{/);
  return message;
}

describe("providerSettings · 多模型分工（2026-11-20）", () => {
  /** 造两条连接各挂一条模型：后加的 B 是主模型，A 留给后台杂活。 */
  async function twoModels() {
    const settings = createProviderSettings({ dir, credentials });
    const one = await settings.saveConnection({ ...DEEPSEEK, apiKey: "sk-deepseek" });
    const a = one.connections[0]!.id;
    await settings.upsertProfile({ model: "deepseek-chat", connectionId: a });
    const two = await settings.saveConnection({ ...MIMO, apiKey: "sk-mimo" });
    const b = two.connections.find((connection) => connection.id !== a)!.id;
    const view = await settings.upsertProfile({ model: "mimo-chat", connectionId: b });
    const profileA = view.profiles.find((profile) => profile.connectionId === a)!;
    const profileB = view.profiles.find((profile) => profile.connectionId === b)!;
    return { settings, profileA, profileB };
  }

  it("写作轮取启用中的主档案，杂活取指定的那条；没指定时跟随主档案", async () => {
    const { settings, profileA, profileB } = await twoModels();
    expect((await settings.configFor("chat"))?.config.model).toBe(profileB.model);
    expect((await settings.configFor("utility"))?.config.model).toBe(profileB.model);

    await settings.setUtilityProfile(profileA.id);
    expect((await settings.configFor("utility"))?.config.model).toBe(profileA.model);
    // 写作轮不受影响：分工只改后台那条。
    expect((await settings.configFor("chat"))?.config.model).toBe(profileB.model);
  });

  it("指定的杂活档案被删 / 连接被删 ⇒ 自动回到主档案，不留悬空引用", async () => {
    const { settings, profileA } = await twoModels();
    await settings.setUtilityProfile(profileA.id);
    expect((await storeOnDisk()) as { utilityProfileId?: string }).toMatchObject({
      utilityProfileId: profileA.id
    });

    const view = await settings.removeProfile(profileA.id);
    expect(view.utilityProfileId).toBeUndefined();
    expect((await settings.configFor("utility"))?.config.model).toBe("mimo-chat");
    expect((await storeOnDisk()) as { utilityProfileId?: string }).not.toHaveProperty(
      "utilityProfileId"
    );
  });

  it("指定 null 等于跟随主模型：盘上这一格被删掉", async () => {
    const { settings, profileA } = await twoModels();
    await settings.setUtilityProfile(profileA.id);
    const view = await settings.setUtilityProfile(null);
    expect(view.utilityProfileId).toBeUndefined();
    expect((await storeOnDisk()) as { utilityProfileId?: string }).not.toHaveProperty(
      "utilityProfileId"
    );
  });

  it("指定不存在的档案 ⇒ 单句中文拒绝，盘上不动", async () => {
    const { settings } = await twoModels();
    const before = await storeOnDisk();
    expect(await rejectMessage(settings.setUtilityProfile("p-missing"))).toContain("模型");
    expect(await storeOnDisk()).toEqual(before);
  });

  it("全部档案都没启用时，chat 按存储顺序取第一条可用档案（配置层降级）", async () => {
    const { settings, profileA, profileB } = await twoModels();
    await settings.enableProfile(profileB.id, false);
    await settings.enableProfile(profileA.id, false);
    // 没有启用档案 ⇒ 不再「看起来像没配模型」，按顺序试到第一条能用的。
    expect((await settings.configFor("chat"))?.config.model).toBe(profileA.model);
  });

  it("改连接 / 启停别把杂活选择顺手丢掉", async () => {
    const { settings, profileA, profileB } = await twoModels();
    await settings.setUtilityProfile(profileA.id);
    await settings.enableProfile(profileB.id, true);
    expect(await settings.setUtilityProfile(profileA.id)).toMatchObject({
      utilityProfileId: profileA.id
    });
    await settings.saveConnection({ connectionId: profileB.connectionId, ...MIMO, apiKey: null });
    expect((await settings.view()).utilityProfileId).toBe(profileA.id);
  });
});

describe("providerSettings · 连接与档案（v3：多连接并存）", () => {
  it("未配置时：空连接表、空档案表，config() 为 null", async () => {
    const settings = createProviderSettings({ dir, credentials });
    expect(await settings.view()).toEqual({ connections: [], profiles: [] });
    expect(await settings.config()).toBeNull();
    expect(await settings.apiKey()).toBeNull();
  });

  it("保存连接：连接进 config.json、密钥按连接分份，视图只给掩码", async () => {
    const settings = createProviderSettings({ dir, credentials });
    const view = await settings.saveConnection({ ...DEEPSEEK, apiKey: "sk-abcdefg" });
    expect(view.connections).toHaveLength(1);
    expect(view.connections[0]).toMatchObject({
      providerId: "deepseek",
      label: "DeepSeek",
      baseURL: "https://api.deepseek.com/v1",
      hasKey: true,
      keyMask: "••••defg"
    });
    // 密钥按连接分份落盘，不再是全局一份 secrets.enc。
    const onDisk = (await storeOnDisk()) as { connections: { id: string }[] };
    expect(onDisk.connections[0]?.id).toBe(view.connections[0]?.id);
    expect(await credentials.read(view.connections[0]!.id)).toBe("sk-abcdefg");
  });

  it("上下文窗口随连接落盘，config() 原样带回（P0-3）", async () => {
    const settings = createProviderSettings({ dir, credentials });
    const view = await settings.saveConnection({
      ...DEEPSEEK,
      apiKey: "sk-abcdefg",
      contextWindow: 65536
    });
    expect(view.connections[0]?.contextWindow).toBe(65536);
    // config() 要的是「启用中那条档案 + 它那条连接」：先把档案挂上去再问。
    await settings.upsertProfile({ model: "test-model", connectionId: view.connections[0]!.id });
    const config = await settings.config();
    expect(config?.contextWindow).toBe(65536);
  });

  it("旧连接没填过上下文窗口 ⇒ config() 不编一个假数，由读取方回退默认值", async () => {
    const settings = createProviderSettings({ dir, credentials });
    const view = await settings.saveConnection({ ...DEEPSEEK, apiKey: "sk-abcdefg" });
    await settings.upsertProfile({ model: "test-model", connectionId: view.connections[0]!.id });
    const config = await settings.config();
    // 键都不在：设置页据此显示「默认值」，而不是把一个 24000 冒充成用户填过的值。
    expect(config).not.toHaveProperty("contextWindow");
  });

  it("编辑连接：没带这一格沿用旧值，带 null 才清空（与 apiKey 同一族语义）", async () => {
    const settings = createProviderSettings({ dir, credentials });
    const saved = await settings.saveConnection({
      ...DEEPSEEK,
      apiKey: "sk-abcdefg",
      contextWindow: 32000
    });
    const id = saved.connections[0]!.id;
    await settings.upsertProfile({ model: "test-model", connectionId: id });

    // undefined = 调用方没带：旧值必须留着，否则换个密钥窗口就被抹平。
    await settings.saveConnection({ connectionId: id, ...DEEPSEEK, apiKey: null });
    expect((await settings.config())?.contextWindow).toBe(32000);

    // null = 明确清空：回到默认档。
    await settings.saveConnection({
      connectionId: id,
      ...DEEPSEEK,
      apiKey: null,
      contextWindow: null
    });
    expect(await settings.config()).not.toHaveProperty("contextWindow");
  });

  it("**两家并存，密钥各归各的**（这是这轮改动的目的，不能又退回全局一份）", async () => {
    const settings = createProviderSettings({ dir, credentials });
    await settings.saveConnection({ ...DEEPSEEK, apiKey: "sk-deep" });
    const view = await settings.saveConnection({ ...MIMO, apiKey: "sk-mimo" });

    expect(view.connections).toHaveLength(2);
    const deep = view.connections.find((c) => c.providerId === "deepseek");
    const mimo = view.connections.find((c) => c.providerId === "mimo");
    expect(deep).toBeDefined();
    expect(mimo).toBeDefined();
    expect(await credentials.read(deep!.id)).toBe("sk-deep");
    expect(await credentials.read(mimo!.id)).toBe("sk-mimo");
    // 头形态也跟着连接走：MiMo 只能走 api-key。
    expect(mimo?.authHeader).toBe("api-key");
    expect(deep?.authHeader).toBe("bearer");
  });

  it("档案挂在连接上；config() 按**启用中那条**去找它那条连接的地址", async () => {
    const settings = createProviderSettings({ dir, credentials });
    await settings.saveConnection({ ...DEEPSEEK, apiKey: "sk-deep" });
    await settings.saveConnection({ ...MIMO, apiKey: "sk-mimo" });
    const view = await settings.view();
    const deep = view.connections.find((c) => c.providerId === "deepseek")!;
    const mimo = view.connections.find((c) => c.providerId === "mimo")!;

    await settings.upsertProfile({ model: "deepseek-chat", connectionId: deep.id });
    expect(await settings.config()).toEqual({
      baseURL: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      authHeader: "bearer",
      thinkingWire: "standard"
    });

    // 切到 MiMo 那条档案：地址与头形态要跟着换，绝不能还拿着 DeepSeek 的。
    await settings.upsertProfile({ model: "mimo-v2.6-pro", connectionId: mimo.id });
    expect(await settings.config()).toEqual({
      baseURL: "https://api.xiaomimimo.com/v1",
      model: "mimo-v2.6-pro",
      authHeader: "api-key",
      thinkingWire: "standard"
    });
    expect(await settings.apiKey()).toBe("sk-mimo");
  });

  it("同名模型在**不同连接**上是两条档案（换个供应商用同一个模型名是常事）", async () => {
    const settings = createProviderSettings({ dir, credentials });
    await settings.saveConnection({ ...DEEPSEEK, apiKey: "sk-a" });
    await settings.saveConnection({ ...MIMO, apiKey: "sk-b" });
    const view = await settings.view();
    const deep = view.connections.find((c) => c.providerId === "deepseek")!;
    const mimo = view.connections.find((c) => c.providerId === "mimo")!;

    await settings.upsertProfile({ model: "same-name", connectionId: deep.id });
    await settings.upsertProfile({ model: "same-name", connectionId: mimo.id });
    expect((await settings.view()).profiles).toHaveLength(2);
  });

  it("同一连接里同名是幂等的，不会建出两条", async () => {
    const settings = createProviderSettings({ dir, credentials });
    await settings.saveConnection({ ...DEEPSEEK, apiKey: "sk-a" });
    const deep = (await settings.view()).connections[0]!;
    await settings.upsertProfile({ model: "deepseek-chat", connectionId: deep.id });
    await settings.upsertProfile({ model: "deepseek-chat", connectionId: deep.id });
    expect((await settings.view()).profiles).toHaveLength(1);
  });

  it("删连接：挂在它下面的档案**一起删**，密钥一并清掉（没人能再用却还替你保管明文）", async () => {
    const settings = createProviderSettings({ dir, credentials });
    await settings.saveConnection({ ...DEEPSEEK, apiKey: "sk-deep" });
    const deep = (await settings.view()).connections[0]!;
    await settings.upsertProfile({ model: "deepseek-chat", connectionId: deep.id });

    const view = await settings.removeConnection(deep.id);

    expect(view.connections).toEqual([]);
    expect(view.profiles).toEqual([]);
    expect(await credentials.read(deep.id)).toBeNull();
    // 留一个指向空连接的档案，卡片上就会列出一个永远发不出请求的模型。
    expect(await settings.config()).toBeNull();
  });

  it("删不存在的连接：单句中文", async () => {
    const settings = createProviderSettings({ dir, credentials });
    expect(await rejectMessage(settings.removeConnection("nope"))).toContain("没有找到这条连接");
  });

  /**
   * 回归钉：删掉的正是**启用中**那条时，剩下的档案会被补一个启用。
   *
   * 此前不管：用户删掉启用中的连接，界面上就变成「一条都没启用」，
   * 发请求时 config() 返 null，看起来像压根没配模型——而他明明还留着能用的那些。
   * 2026-10-05 真机上就是这么撞到的，当时是靠手动把开关拨回来。
   */
  it("删掉启用中的那条 ⇒ 剩下那些里自动启用一个，不留「一条都没启用」", async () => {
    const settings = createProviderSettings({ dir, credentials });
    await settings.saveConnection({ ...DEEPSEEK, apiKey: "sk-deep" });
    const deep = (await settings.view()).connections[0]!;
    await settings.saveConnection({ ...MIMO, apiKey: "sk-mimo" });
    const mimo = (await settings.view()).connections[1]!;
    // upsertProfile 会把传进去的那条设为启用，所以**后写的才是启用中的那条**：
    // 先 deepseek-chat（被停用），再 mimo-chat（启用中）。
    await settings.upsertProfile({ model: "deepseek-chat", connectionId: deep.id });
    await settings.upsertProfile({ model: "mimo-chat", connectionId: mimo.id });

    expect((await settings.view()).profiles.find((p) => p.model === "mimo-chat")?.enabled).toBe(
      true
    );
    expect((await settings.view()).profiles.find((p) => p.model === "deepseek-chat")?.enabled).toBe(
      false
    );

    const view = await settings.removeConnection(mimo.id);

    // mimo 那条档案随连接走了，剩下 deepseek-chat 应当自动接手启用
    expect(view.profiles.map((p) => p.model)).toEqual(["deepseek-chat"]);
    expect(view.profiles[0]?.enabled).toBe(true);
    // 真能发出去：config() 不再是 null
    const config = await settings.config();
    expect(config?.model).toBe("deepseek-chat");
    expect(config?.baseURL).toBe(DEEPSEEK.baseURL);
  });

  it("剩下的档案里本来就有一个启用着的：不动它（别擅自换人）", async () => {
    const settings = createProviderSettings({ dir, credentials });
    await settings.saveConnection({ ...DEEPSEEK, apiKey: "sk-a" });
    const a = (await settings.view()).connections[0]!;
    await settings.saveConnection({ ...MIMO, apiKey: "sk-b" });
    const b = (await settings.view()).connections[1]!;
    await settings.upsertProfile({ model: "a-chat", connectionId: a.id });
    await settings.upsertProfile({ model: "b-chat", connectionId: b.id }); // b 启用、a 停用
    await settings.upsertProfile({ model: "a-chat", connectionId: a.id }); // 再把 a 拨回启用

    const view = await settings.removeConnection(b.id);

    // 启用中的是 a-chat，删 b 不该改变任何启停
    const enabled = view.profiles.filter((p) => p.enabled).map((p) => p.model);
    expect(enabled).toEqual(["a-chat"]);
    expect((await settings.config())?.model).toBe("a-chat");
  });

  it("删完一条都不剩：那就是真的没有了，不硬造一个启用", async () => {
    const settings = createProviderSettings({ dir, credentials });
    await settings.saveConnection({ ...DEEPSEEK, apiKey: "sk" });
    const only = (await settings.view()).connections[0]!;
    await settings.upsertProfile({ model: "deepseek-chat", connectionId: only.id });

    const view = await settings.removeConnection(only.id);
    expect(view.profiles).toEqual([]);
    expect(await settings.config()).toBeNull();
  });

  it("启停互斥：启用一条，其余自动停用", async () => {
    const settings = createProviderSettings({ dir, credentials });
    await settings.saveConnection({ ...DEEPSEEK, apiKey: "sk" });
    const deep = (await settings.view()).connections[0]!;
    await settings.upsertProfile({ model: "a", connectionId: deep.id });
    await settings.upsertProfile({ model: "b", connectionId: deep.id });
    const view = await settings.view();
    const a = view.profiles.find((p) => p.model === "a")!;
    const b = view.profiles.find((p) => p.model === "b")!;
    expect(
      (await settings.enableProfile(a.id, true)).profiles.find((p) => p.id === b.id)?.enabled
    ).toBe(false);
  });

  it("档案挂到不存在的连接上：单句中文，且不写盘", async () => {
    const settings = createProviderSettings({ dir, credentials });
    await settings.saveConnection({ ...DEEPSEEK, apiKey: "sk" });
    expect(
      await rejectMessage(settings.upsertProfile({ model: "x", connectionId: "nope" }))
    ).toContain("没有找到这条连接");
  });
});

describe("连接草稿的密钥语义：null 沿用 / 空串清空 / 新值覆盖", () => {
  it("null = 沿用（改地址不该把云端密钥清掉）", async () => {
    const settings = createProviderSettings({ dir, credentials });
    const first = await settings.saveConnection({ ...DEEPSEEK, apiKey: "sk-keep" });
    const id = first.connections[0]!.id;
    const second = await settings.saveConnection({
      ...DEEPSEEK,
      baseURL: "https://api.deepseek.com/v2",
      apiKey: null
    });
    expect(second.connections[0]?.id, "沿用应当是改同一条，不是新建一条").toBe(id);
    expect(await credentials.read(id)).toBe("sk-keep");
  });

  it("空串 = 明确清空（切到不需要密钥的端点时主动清掉）", async () => {
    const settings = createProviderSettings({ dir, credentials });
    const first = await settings.saveConnection({ ...DEEPSEEK, apiKey: "sk-old" });
    const id = first.connections[0]!.id;
    // **必须指名那条连接**：不传 connectionId 是「再加一家」（同一家开第二个账号是合理需求）。
    const second = await settings.saveConnection({ ...DEEPSEEK, apiKey: "", connectionId: id });
    expect(second.connections).toHaveLength(1);
    expect(second.connections[0]?.hasKey).toBe(false);
    expect(await credentials.read(id)).toBeNull();
  });

  it("不传 connectionId = 新加一条，不覆盖原来那条（同一家开第二个账号是常事）", async () => {
    const settings = createProviderSettings({ dir, credentials });
    const first = await settings.saveConnection({ ...DEEPSEEK, apiKey: "sk-account-a" });
    const second = await settings.saveConnection({ ...DEEPSEEK, apiKey: "sk-account-b" });
    expect(second.connections).toHaveLength(2);
    expect(second.connections[0]?.id).not.toBe(second.connections[1]?.id);
    // 两把钥匙各归各的，第二条没把第一条覆盖掉。
    expect(await credentials.read(first.connections[0]!.id)).toBe("sk-account-a");
    expect(await credentials.read(second.connections[1]!.id)).toBe("sk-account-b");
  });

  /**
   * 回归钉：两条连接地址一模一样时，回执里的 `connectionId` 必须点名**刚存的那条**。
   * 渲染层要靠它去挂模型、去做体检；一旦它退化成「视图里的第一条」，
   * 用户配第二个账号就会配到第一个账号头上，而且界面上看不出异常。
   */
  it("回执点名的 connectionId 是刚存那条（同地址两条并存时也不能认错）", async () => {
    const settings = createProviderSettings({ dir, credentials });
    const first = await settings.saveConnection({ ...DEEPSEEK, apiKey: "sk-account-a" });
    const second = await settings.saveConnection({ ...DEEPSEEK, apiKey: "sk-account-b" });
    expect(first.connectionId).toBe(first.connections[0]!.id);
    expect(second.connectionId).toBe(second.connections[1]!.id);
    expect(second.connectionId).not.toBe(first.connectionId);
    // 点名的这条必须真的存在，且钥匙就是刚存的那把。
    const named = second.connections.find((c) => c.id === second.connectionId);
    expect(named).toBeDefined();
    expect(await credentials.read(second.connectionId)).toBe("sk-account-b");
  });

  it("改已有连接时，回执点名的也是它自己那条（不是视图第一条）", async () => {
    const settings = createProviderSettings({ dir, credentials });
    await settings.saveConnection({ ...DEEPSEEK, apiKey: "sk-a" });
    const other = await settings.saveConnection({ ...MIMO, apiKey: "sk-b" });
    const target = other.connections[0]!.id;
    const edited = await settings.saveConnection({
      ...DEEPSEEK,
      apiKey: "sk-a2",
      connectionId: target
    });
    expect(edited.connectionId).toBe(target);
  });

  it("改密钥框但没碰地址：仍是改同一条连接", async () => {
    const settings = createProviderSettings({ dir, credentials });
    const first = await settings.saveConnection({ ...DEEPSEEK, apiKey: "sk-old" });
    const id = first.connections[0]!.id;
    const second = await settings.saveConnection({
      ...DEEPSEEK,
      apiKey: "sk-new",
      connectionId: id
    });
    expect(second.connections[0]?.id).toBe(id);
    expect(await credentials.read(id)).toBe("sk-new");
  });

  it("拒绝必须是单句中文（不把 ZodError 骨架透给用户）", async () => {
    const settings = createProviderSettings({ dir, credentials });
    expect(
      await rejectMessage(
        settings.saveConnection({ ...DEEPSEEK, baseURL: "不是网址", apiKey: null })
      )
    ).toContain("http://");
    expect(
      await rejectMessage(
        settings.saveConnection({ ...DEEPSEEK, apiKey: null, connectionId: "nope" })
      )
    ).toContain("没有找到这条连接");
  });

  it("密钥保管不可用时**不写 config.json**（整次保存要么全成、要么不留半套地址）", async () => {
    const broken = createCredentialStore(dir, {
      available: false,
      encrypt: (p) => p,
      decrypt: (p) => p
    });
    const settings = createProviderSettings({ dir, credentials: broken });
    await expect(settings.saveConnection({ ...DEEPSEEK, apiKey: "sk-x" })).rejects.toThrow(
      /密钥保管不可用/
    );
    await expect(storeOnDisk()).rejects.toThrow();
  });
});

describe("旧配置迁移：v1 / v2 两代都要接住，**而且密钥要跟着搬**", () => {
  it("v2（地址全局一份）：造一条连接，档案 id 与启停原样保留", async () => {
    await writeFile(
      path.join(dir, "config.json"),
      JSON.stringify({
        baseURL: "https://api.deepseek.com/v1",
        profiles: [
          { id: "keep-1", model: "deepseek-chat", enabled: true },
          { id: "keep-2", model: "deepseek-reasoner", enabled: false }
        ]
      }),
      "utf8"
    );
    const settings = createProviderSettings({ dir, credentials });
    const view = await settings.view();

    expect(view.connections).toHaveLength(1);
    expect(view.connections[0]).toMatchObject({ providerId: "deepseek", label: "DeepSeek" });
    expect(view.profiles).toEqual([
      {
        id: "keep-1",
        connectionId: view.connections[0]!.id,
        model: "deepseek-chat",
        enabled: true
      },
      {
        id: "keep-2",
        connectionId: view.connections[0]!.id,
        model: "deepseek-reasoner",
        enabled: false
      }
    ]);
  });

  it("v1（{baseURL, model}）：造连接 + 一条启用档案", async () => {
    await writeFile(
      path.join(dir, "config.json"),
      JSON.stringify({ baseURL: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" }),
      "utf8"
    );
    const view = await createProviderSettings({ dir, credentials }).view();
    expect(view.connections[0]?.providerId).toBe("kimi");
    expect(view.profiles).toHaveLength(1);
    expect(view.profiles[0]).toMatchObject({ model: "moonshot-v1-8k", enabled: true });
  });

  it("**密钥跟着搬进新桶**——不搬的话用户升级后所有连接都没密钥，配置看着还在却一发请求就 401", async () => {
    // 先用老版方式在 secrets.enc 里放一把密钥。
    await writeFile(
      path.join(dir, "secrets.enc"),
      `enc:${Buffer.from("sk-legacy-key", "utf8").toString("base64url")}`,
      "utf8"
    );
    await writeFile(
      path.join(dir, "config.json"),
      JSON.stringify({
        baseURL: "https://api.deepseek.com/v1",
        profiles: [{ id: "p", model: "deepseek-chat", enabled: true }]
      }),
      "utf8"
    );

    const settings = createProviderSettings({ dir, credentials });
    const view = await settings.view();

    expect(view.connections[0]?.hasKey, "迁完之后这把密钥不见了").toBe(true);
    expect(view.connections[0]?.keyMask).toBe("••••-key");
    expect(await credentials.read(view.connections[0]!.id)).toBe("sk-legacy-key");
    // **搬**不是复制：老文件不该留在盘上（留着等于用户以为清干净了、其实还在）。
    await expect(readFile(path.join(dir, "secrets.enc"), "utf8")).rejects.toThrow();
  });

  it("搬完写回 v3：下次启动不再重走迁移", async () => {
    await writeFile(
      path.join(dir, "config.json"),
      JSON.stringify({
        baseURL: "https://api.deepseek.com/v1",
        profiles: [{ id: "p", model: "m", enabled: true }]
      }),
      "utf8"
    );
    await createProviderSettings({ dir, credentials }).view();
    const onDisk = (await storeOnDisk()) as { connections: unknown[] };
    expect(Array.isArray(onDisk.connections)).toBe(true);
  });

  it("档案挂在不存在的连接上：读配置时就说中文错，不静默放行", async () => {
    await writeFile(
      path.join(dir, "config.json"),
      JSON.stringify({
        connections: [],
        profiles: [{ id: "p", connectionId: "ghost", model: "m", enabled: true }]
      }),
      "utf8"
    );
    const settings = createProviderSettings({ dir, credentials });
    expect(await rejectMessage(settings.view())).toMatch(/缺字段|不存在的连接/);
  });

  it("认不出是哪一代：单句中文，且说清怎么救", async () => {
    await writeFile(path.join(dir, "config.json"), JSON.stringify({ nope: 1 }), "utf8");
    const settings = createProviderSettings({ dir, credentials });
    expect(await rejectMessage(settings.view())).toMatch(/缺字段|重新保存/);
  });
});

/**
 * P0-5（2026-10-09 全仓扫描）：一次读失败把模型配置读成「没配过」，并且缓存永久中毒。
 *
 * 【病灶】`ensure()` 原先**先置 `loaded = true` 再 await 读盘**。非 ENOENT 的 IO 错误
 * （EBUSY / EACCES——Windows 上杀软、OneDrive、备份正在扫这个文件）确实抛了，
 * 但 `loaded` 已经抬上去、`cached` 停在 null，于是：
 * - 第一次调用：抛（用户看见一句人话，还算体面）；
 * - 第二次起：**静默返回 null** ⇒ `view()` 显示「还没有配置模型服务」、`config()` 当没配；
 * - 用户照着提示去设置页填一下 ⇒ `saveConnection` 以 `store === null` 走新建分支，
 *   `writeStore` **整份重写** config.json ⇒ 其余连接与全部模型档案一次冲掉，
 *   密钥文件按新 UUID 改名，旧 `<连接id>.enc` 从此没人能清。
 *
 * 【这五条用例各自钉住什么】
 * ①② 读失败的**每一次**都重读、都抛（回滚 `loaded`），且盘上那份一个字不动；
 * ③ 恢复性：故障只是一次性的，之后必须自己读回真配置——回滚不等于把错误永久缓存；
 * ④⑤ 写盘走原子通路：中途失败目标文件完好，且**迁移写回那一次不算旁路**。
 */
describe("P0-5：一次读失败不许把配置读成「没配过」，写盘不许留下半截", () => {
  /** 「只是读不开」：code 不是 ENOENT，走的正是被误判成「从未配置」的那一支。 */
  function busyError(): NodeJS.ErrnoException {
    return Object.assign(new Error("resource busy or locked, open"), { code: "EBUSY" });
  }

  /** 用户已有的配置：一条 DeepSeek 连接 + 一条启用档案（被冲掉的就是这两样）。 */
  async function seedExistingConfig(): Promise<{ connectionId: string; file: string }> {
    const settings = createProviderSettings({ dir, credentials });
    const saved = await settings.saveConnection({ ...DEEPSEEK, apiKey: "sk-deep" });
    const connectionId = saved.connections[0]?.id ?? "";
    if (connectionId === "") throw new Error("夹具没建起连接");
    await settings.upsertProfile({ model: "deepseek-chat", connectionId });
    return { connectionId, file: path.join(dir, "config.json") };
  }

  it("读失败的第二次仍报同一句中文：不许把「读不开」缓存成「没配过」", async () => {
    await seedExistingConfig();
    const sick = createProviderSettings({
      dir,
      credentials,
      readFile: async () => {
        throw busyError();
      }
    });
    expect(await rejectMessage(sick.view())).toMatch(/读取失败/);
    // 旧实现：第二次起 loaded 已是 true、cached 停在 null ⇒ 这里返回 {connections:[],profiles:[]}。
    expect(await rejectMessage(sick.view())).toMatch(/读取失败/);
    expect(await rejectMessage(sick.config())).toMatch(/读取失败/);
    expect(await rejectMessage(sick.apiKey())).toMatch(/读取失败/);
  });

  it("读失败时保存连盘都不碰：那条连接与它的档案一个字没被改写", async () => {
    const { connectionId, file } = await seedExistingConfig();
    const sick = createProviderSettings({
      dir,
      credentials,
      readFile: async () => {
        throw busyError();
      }
    });
    await expect(sick.saveConnection({ ...MIMO, apiKey: "sk-x" })).rejects.toThrow(/读取失败/);
    await expect(sick.saveConnection({ ...MIMO, apiKey: "sk-y" })).rejects.toThrow(/读取失败/);
    const store = JSON.parse(await readFile(file, "utf8")) as {
      connections: { id: string; baseURL: string }[];
      profiles: { model: string; connectionId: string }[];
    };
    // 旧实现第二次把这份换成「只有 MiMo 一条、零档案」：下面几行就是那条数据丢失的守门人。
    expect(store.connections).toHaveLength(1);
    expect(store.connections[0]?.id).toBe(connectionId);
    expect(store.connections[0]?.baseURL).toBe("https://api.deepseek.com/v1");
    expect(store.profiles).toHaveLength(1);
    expect(store.profiles[0]).toMatchObject({ model: "deepseek-chat", connectionId });
  });

  it("瞬时故障过去后自己读回真配置：回滚 loaded 不等于把错误永久缓存", async () => {
    const { connectionId } = await seedExistingConfig();
    let fail = true;
    const sick = createProviderSettings({
      dir,
      credentials,
      readFile: async (target) => {
        if (fail) throw busyError();
        return readFile(target, "utf8");
      }
    });
    expect(await rejectMessage(sick.view())).toMatch(/读取失败/);
    fail = false;
    const view = await sick.view();
    expect(view.connections).toHaveLength(1);
    expect(view.connections[0]?.id).toBe(connectionId);
    expect(view.profiles).toHaveLength(1);
    expect(await sick.config()).toMatchObject({ model: "deepseek-chat" });
  });

  it("写 config.json 走原子通路：改名那步失败 ⇒ 原文件完好、目标路径没被截断、临时件没留下", async () => {
    const { file } = await seedExistingConfig();
    const before = await readFile(file, "utf8");
    const broken = atomicFsBrokenAt("rename", "盘满了，写入没完成");
    const settings = createProviderSettings({ dir, credentials, fs: broken.fs });
    expect(await rejectMessage(settings.saveConnection({ ...MIMO, apiKey: "sk-z" }))).toMatch(
      /盘满/
    );
    // 裸 `writeFile(configFile, …)` 会先把目标截断：这一条钉的就是「从没直接写过目标」。
    expect(broken.writeTargets).toHaveLength(1);
    expect(broken.writeTargets[0]).not.toBe(file);
    expect(await readFile(file, "utf8")).toBe(before);
    const residue = (await readdir(dir)).filter((name) => name.includes("mochen-tmp"));
    expect(residue).toEqual([]);
  });

  it("迁移写回也走同一条原子通路（ensure 里那一次不是旁路）", async () => {
    await writeFile(
      path.join(dir, "config.json"),
      JSON.stringify({
        baseURL: "https://api.deepseek.com/v1",
        profiles: [{ id: "p", model: "m", enabled: true }]
      }),
      "utf8"
    );
    const broken = atomicFsBrokenAt("rename", "盘满了，写入没完成");
    const settings = createProviderSettings({ dir, credentials, fs: broken.fs });
    expect(await rejectMessage(settings.view())).toMatch(/盘满/);
    expect(broken.writeTargets).toHaveLength(1);
    expect(broken.writeTargets[0]).not.toBe(path.join(dir, "config.json"));
    // 迁移没写成 ⇒ 盘上仍是那一份 v2：下次启动照样能读回来，不会留下半截 v3 让 JSON.parse 直接失败。
    expect((await readFile(path.join(dir, "config.json"), "utf8")).includes("baseURL")).toBe(true);
  });
});
