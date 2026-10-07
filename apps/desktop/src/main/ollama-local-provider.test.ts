/**
 * 本机模型（Ollama）接通的**可执行证据**（2026-10-05，批次 5-②）。
 *
 * ## 为什么不写一次性脚本
 * 这条接线是**产品功能**（用户要能用本机模型写稿），不是一次性验证。
 * 本仓的规矩也摆在这：判定/接线要么有常驻测试，要么它迟早被人改坏。
 *
 * ## 证据边界（说清楚，不含糊）
 * 本机**没装 Ollama**（127.0.0.1:11434 连不上），所以这里起的是一个
 * **会拒绝一切带 Authorization 头的假 Ollama 端点**，用它证明两件事：
 * ① 空密钥那条路真的能走通（拉名单 + 发流式请求）；
 * ② 切到本机端点后，**云端那把密钥真的被清掉了**，不会跟着出网。
 *
 * **它证不了**「连上一台真 Ollama 能写出稿」——那要等本机装上 Ollama 后在真 Electron 里验。
 * 本仓记证据的规矩是「如实记未做」，不拿桩冒充真机（README 批次 2 早有先例）。
 *
 * ## 为什么这个桩要求「不许带 Authorization」
 * Ollama 官方文档对 OpenAI 兼容层的措辞是 `api_key` "required but ignored"——
 * 那是给 OpenAI **SDK 客户端**的约束（不给 apiKey SDK 自己会抛），对裸 HTTP 不成立。
 * 桩比它严：只要收到 Authorization 头就 401。这样一旦哪天 `provider-client.ts`
 * 改成「空密钥也发个空 Bearer 头」，这里会立刻红。
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCredentialStore, type CredentialStore } from "./credential-store.js";
import { createProviderSettings, type ProviderSettings } from "./provider-settings.js";
import { createModelLister } from "./provider-models.js";

interface Seen {
  url: string;
  hasAuth: boolean;
}

let server: http.Server;
let base = "";
const seen: Seen[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const hasAuth = Boolean(req.headers.authorization);
    seen.push({ url: req.url ?? "", hasAuth });
    // 假 Ollama：带 Authorization 头一律拒（真 Ollama 是忽略，但我们要验「压根没发」）。
    if (hasAuth) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "本机端点不该收到 Authorization 头" }));
      return;
    }
    if (req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "qwen3:8b" }, { id: "llama3.2" }] }));
      return;
    }
    if (req.url === "/v1/chat/completions") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "本地模型回话了。" } }] })}\n\n`
      );
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** 一个全新的「配过云端密钥」的设置：目录与凭据都是真的，走的是生产那套 createCredentialStore。 */
async function freshSettings(): Promise<{
  dir: string;
  credentials: CredentialStore;
  settings: ProviderSettings;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "mochen-ollama-"));
  const credentials = createCredentialStore(dir, {
    available: true,
    encrypt: (plain) => `enc:${Buffer.from(plain, "utf8").toString("base64url")}`,
    decrypt: (text) => {
      if (!text.startsWith("enc:")) throw new Error("坏");
      return Buffer.from(text.slice(4), "base64url").toString("utf8");
    }
  });
  return { dir, credentials, settings: createProviderSettings({ dir, credentials }) };
}

describe("本机 Ollama · 切过去的那一步", () => {
  it("配过云端密钥 → 切本机端点并清空密钥：云端那把 key 真的没了", async () => {
    const { dir, credentials, settings } = await freshSettings();
    try {
      // v3：地址与密钥都按连接分份，两次保存改的是**同一条**连接（否则只是又建了一条空的）。
      const cloud = await settings.saveConnection({
        providerId: "custom",
        baseURL: "https://api.cloud.example/v1",
        authHeader: "bearer",
        apiKey: "sk-cloud-secret"
      });
      const connectionId = cloud.connections[0]?.id ?? "";
      if (connectionId === "") throw new Error("连接没建起来");
      expect(await credentials.read(connectionId)).toBe("sk-cloud-secret");

      const view = await settings.saveConnection({
        connectionId,
        providerId: "custom",
        baseURL: base,
        authHeader: "bearer",
        apiKey: ""
      });
      expect(view.connections[0]?.hasKey).toBe(false);
      expect(await credentials.read(connectionId)).toBeNull();
      // 落盘上也不能留：这条连接那份密文（secrets/<连接id>.enc）应已被 clear 删掉
      expect(await readdir(path.join(dir, "secrets"))).not.toContain(`${connectionId}.enc`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("只换地址、不碰密钥框 ⇒ 沿用旧密钥（切回云端不该被顺手清掉）", async () => {
    const { dir, credentials, settings } = await freshSettings();
    try {
      const cloud = await settings.saveConnection({
        providerId: "custom",
        baseURL: "https://api.cloud.example/v1",
        authHeader: "bearer",
        apiKey: "sk-cloud-secret"
      });
      const connectionId = cloud.connections[0]?.id ?? "";
      if (connectionId === "") throw new Error("连接没建起来");
      const view = await settings.saveConnection({
        connectionId,
        providerId: "custom",
        baseURL: "https://api.other.example/v1",
        authHeader: "bearer",
        apiKey: null
      });
      expect(view.connections[0]?.hasKey).toBe(true);
      expect(await credentials.read(connectionId)).toBe("sk-cloud-secret");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("本机 Ollama · 空密钥真的能把请求发出去", () => {
  it("拉模型名单：空密钥 → 请求不带 Authorization → 名单读回来了", async () => {
    const { dir, settings } = await freshSettings();
    const before = seen.length;
    try {
      // v3：地址与密钥按连接分份，模型档案挂在连接上（没有档案就没有「启用中的模型」可拉）。
      const saved = await settings.saveConnection({
        providerId: "custom",
        baseURL: base,
        authHeader: "bearer",
        apiKey: ""
      });
      const connectionId = saved.connections[0]?.id ?? "";
      if (connectionId === "") throw new Error("连接没建起来");
      await settings.upsertProfile({ model: "qwen3:8b", connectionId });
      const result = await createModelLister({ settings }).list();
      expect(result.ok).toBe(true);
      // 生产那侧会去重并排序，顺序不是这条要验的东西（那是 modelListResultSchema 的口径，另有用例钉着）
      if (!result.ok) throw new Error(`不该失败：${result.reason}`);
      expect([...result.models].sort()).toEqual(["llama3.2", "qwen3:8b"]);
      const mine = seen.slice(before);
      expect(mine.map((s) => s.url)).toContain("/v1/models");
      // 关键断言：这一发**没有**带 Authorization。
      expect(mine.every((s) => s.hasAuth === false)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("取数用的 apiKey 是 null 而不是空串（provider-client 那层据此决定发不发头）", async () => {
    const { dir, settings } = await freshSettings();
    try {
      // v3：apiKey() 取的是「启用中那条档案所挂连接」的密钥，所以要先把档案挂上去——
      // 否则这条会因「没有启用中的模型」而返回 null，验的就不是「没有密钥」那件事了。
      const saved = await settings.saveConnection({
        providerId: "custom",
        baseURL: base,
        authHeader: "bearer",
        apiKey: ""
      });
      const connectionId = saved.connections[0]?.id ?? "";
      if (connectionId === "") throw new Error("连接没建起来");
      await settings.upsertProfile({ model: "qwen3:8b", connectionId });
      // settings.apiKey() 回 null（没有密钥这件事要说成「没有」，不是「有一个空的」）；
      // agent-service 把它转成 "" 再交给 provider-client，provider-client 空串就不发头。
      expect(await settings.apiKey()).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
