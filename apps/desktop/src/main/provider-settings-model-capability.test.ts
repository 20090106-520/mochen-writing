import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCredentialStore, type CredentialStore } from "./credential-store.js";
import { createProviderSettings } from "./provider-settings.js";

/**
 * 模型级能力（2026-11-21）：上下文窗口与思考档都挂在**档案（= 模型）**上。
 *
 * 三条判据在这里钉死：
 * 1. **谁更具体谁赢**：档案填过 ⇒ 能力表 ⇒ 连接级 ⇒ 默认值；
 * 2. **档案没填过的两格不被顺手抹平**（`undefined` = 保持现状，`null` = 明确清空）；
 * 3. 算不出来就**不写那个键**——调用方据此回退默认值，界面也要能看出「用的是默认值」。
 *
 * 独立成文件而不是塞进 `provider-settings.test.ts`：那份已经 600 多行，
 * 贴着 800 行硬门禁（`tools/check-source-line-budget.mjs`）。
 */
let dir = "";
let credentials: CredentialStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mochen-provider-cap-"));
  credentials = createCredentialStore(dir, {
    available: true,
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

const CUSTOM = {
  providerId: "custom",
  baseURL: "https://example.invalid/v1",
  authHeader: "bearer",
  thinkingWire: "standard"
} as const;

/** 造一条连接并挂上模型，返回连接 id。 */
async function seed(
  settings: ReturnType<typeof createProviderSettings>,
  model: string,
  connection?: { contextWindow?: number }
): Promise<string> {
  const saved = await settings.saveConnection({
    ...CUSTOM,
    apiKey: "sk-test",
    ...(connection?.contextWindow === undefined ? {} : { contextWindow: connection.contextWindow })
  });
  const connectionId = saved.connections[0]!.id;
  await settings.upsertProfile({ model, connectionId });
  return connectionId;
}

describe("providerSettings · 模型级上下文窗口", () => {
  it("档案填过的窗口落盘并生效（占用条的分母与历史切多少都读这一格）", async () => {
    const settings = createProviderSettings({ dir, credentials });
    const connectionId = await seed(settings, "MiniMax-M3.1-Flash");
    const view = await settings.upsertProfile({
      model: "MiniMax-M3.1-Flash",
      connectionId,
      contextWindow: 32768
    });
    expect(view.profiles[0]?.contextWindow).toBe(32768);
    expect((await settings.config())?.contextWindow).toBe(32768);
  });

  it("档案没填 ⇒ 回落能力表里这个模型那份（MiniMax-M3.1-Flash 官方 1M）", async () => {
    const settings = createProviderSettings({ dir, credentials });
    await seed(settings, "MiniMax-M3.1-Flash");
    expect((await settings.config())?.contextWindow).toBe(1_000_000);
  });

  it("档案填过的赢过能力表（用户改了就以用户那份为准）", async () => {
    const settings = createProviderSettings({ dir, credentials });
    const connectionId = await seed(settings, "MiniMax-M3.1-Flash");
    await settings.upsertProfile({
      model: "MiniMax-M3.1-Flash",
      connectionId,
      contextWindow: 65536
    });
    expect((await settings.config())?.contextWindow).toBe(65536);
  });

  it("能力表也没有 ⇒ 回落连接级那格（老配置里只有它）", async () => {
    const settings = createProviderSettings({ dir, credentials });
    await seed(settings, "某个没人知道的模型", { contextWindow: 12000 });
    expect((await settings.config())?.contextWindow).toBe(12000);
  });

  it("哪儿都没有 ⇒ **不写**那个键：调用方自己回退默认值，界面要能看出「用的是默认值」", async () => {
    const settings = createProviderSettings({ dir, credentials });
    await seed(settings, "某个没人知道的模型");
    expect(await settings.config()).not.toHaveProperty("contextWindow");
  });

  it("明确清空（null）⇒ 键被删掉，回到能力表那份", async () => {
    const settings = createProviderSettings({ dir, credentials });
    const connectionId = await seed(settings, "MiniMax-M3.1-Flash");
    await settings.upsertProfile({
      model: "MiniMax-M3.1-Flash",
      connectionId,
      contextWindow: 65536
    });
    const cleared = await settings.upsertProfile({
      model: "MiniMax-M3.1-Flash",
      connectionId,
      contextWindow: null
    });
    expect(cleared.profiles[0]).not.toHaveProperty("contextWindow");
    // 键没了 ⇒ 能力表那份重新接管。
    expect((await settings.config())?.contextWindow).toBe(1_000_000);
  });
});

describe("providerSettings · 每模型一档思考档（切模型带着走）", () => {
  it("档位随档案落盘，再 upsert 一次不带这一格时旧值还在（undefined = 保持现状）", async () => {
    const settings = createProviderSettings({ dir, credentials });
    const connectionId = await seed(settings, "MiniMax-M3.1-Flash");
    const set = await settings.upsertProfile({
      model: "MiniMax-M3.1-Flash",
      connectionId,
      thinkingLevel: "xhigh"
    });
    expect(set.profiles[0]?.thinkingLevel).toBe("xhigh");

    // 只带模型名与连接（像「切模型」那样）：这一格不该被顺手抹平。
    const again = await settings.upsertProfile({
      model: "MiniMax-M3.1-Flash",
      connectionId
    });
    expect(again.profiles[0]?.thinkingLevel).toBe("xhigh");
  });

  it("两个模型各存各的一档，互不串（这就是「切模型带着走」那一份）", async () => {
    const settings = createProviderSettings({ dir, credentials });
    const connectionId = await seed(settings, "MiniMax-M3.1-Flash");
    await settings.upsertProfile({ model: "MiniMax-M3", connectionId, thinkingLevel: "low" });
    const view = await settings.upsertProfile({
      model: "MiniMax-M3.1-Flash",
      connectionId,
      thinkingLevel: "max"
    });
    const flash = view.profiles.find((profile) => profile.model === "MiniMax-M3.1-Flash");
    const m3 = view.profiles.find((profile) => profile.model === "MiniMax-M3");
    expect(flash?.thinkingLevel).toBe("max");
    expect(m3?.thinkingLevel).toBe("low");
  });

  it("明确清空（null）⇒ 键被删掉，回到该模型的默认档", async () => {
    const settings = createProviderSettings({ dir, credentials });
    const connectionId = await seed(settings, "MiniMax-M3.1-Flash");
    await settings.upsertProfile({
      model: "MiniMax-M3.1-Flash",
      connectionId,
      thinkingLevel: "max"
    });
    const cleared = await settings.upsertProfile({
      model: "MiniMax-M3.1-Flash",
      connectionId,
      thinkingLevel: null
    });
    expect(cleared.profiles[0]).not.toHaveProperty("thinkingLevel");
  });

  it("非法档位被拒（档案形状的关卡不许放一个上游不认的值进盘）", async () => {
    const settings = createProviderSettings({ dir, credentials });
    const connectionId = await seed(settings, "MiniMax-M3.1-Flash");
    await expect(
      settings.upsertProfile({
        model: "MiniMax-M3.1-Flash",
        connectionId,
        thinkingLevel: "ultra" as never
      })
    ).rejects.toThrow();
  });
});
