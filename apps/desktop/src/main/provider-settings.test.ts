import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCredentialStore,
  type CredentialStore,
  type ReadTextFile
} from "./credential-store.js";
import { createProviderSettings } from "./provider-settings.js";

let dir = "";
let credentials: CredentialStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mochen-provider-"));
  credentials = createCredentialStore(dir, {
    available: true,
    // 简报原样用 `enc:${plain}` 作假加密，密文里含明文，会被 credential-store 的
    // includes(key)「不许明文落盘」门禁拒绝——简报自身两处矛盾。这里换成 base64url 假加密，
    // 断言一字未放宽（view/config/read 的期望值不变），只是让假密钥真正隐藏明文。
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

describe("providerSettings", () => {
  it("未配置时 view 给出空串与 hasKey=false", async () => {
    const settings = createProviderSettings({ dir, credentials });
    expect(await settings.view()).toEqual({ hasKey: false, baseURL: "", model: "", keyMask: "" });
    expect(await settings.config()).toBeNull();
  });

  it("保存后 baseURL/model 进 config.json，密钥进 secrets.enc，视图只给掩码", async () => {
    const settings = createProviderSettings({ dir, credentials });
    const view = await settings.save({
      baseURL: "http://127.0.0.1:8787/v1",
      model: "test-model",
      apiKey: "sk-abcdefg"
    });
    expect(view).toEqual({
      hasKey: true,
      baseURL: "http://127.0.0.1:8787/v1",
      model: "test-model",
      keyMask: "••••defg"
    });
    const config = await settings.config();
    expect(config).toEqual({ baseURL: "http://127.0.0.1:8787/v1", model: "test-model" });
  });

  it("apiKey 为 null 时保留旧密钥", async () => {
    const settings = createProviderSettings({ dir, credentials });
    await settings.save({ baseURL: "http://a/v1", model: "m", apiKey: "sk-old1234" });
    const view = await settings.save({ baseURL: "http://b/v1", model: "m2", apiKey: null });
    expect(view.hasKey).toBe(true);
    expect(await credentials.read()).toBe("sk-old1234");
    expect(view.baseURL).toBe("http://b/v1");
  });

  it("apiKey 只供主进程拼请求头，view 与 config 里都不出现它（spec §8）", async () => {
    const settings = createProviderSettings({ dir, credentials });
    await settings.save({ baseURL: "http://a/v1", model: "m", apiKey: "sk-live-9" });
    expect(await settings.apiKey()).toBe("sk-live-9");
    expect(await settings.config()).toEqual({ baseURL: "http://a/v1", model: "m" });
    expect(Object.keys(await settings.view())).toEqual(["hasKey", "baseURL", "model", "keyMask"]);
  });

  it("baseURL 非法时拒绝且不落盘", async () => {
    const settings = createProviderSettings({ dir, credentials });
    await expect(
      settings.save({ baseURL: "127.0.0.1:8787", model: "m", apiKey: null })
    ).rejects.toThrow(/baseURL/);
    expect(await settings.config()).toBeNull();
  });

  it("config.json 被人写坏时 view 报中文错误而不是静默给空", async () => {
    await writeFile(path.join(dir, "config.json"), "{ oops", "utf8");
    const settings = createProviderSettings({ dir, credentials });
    await expect(settings.view()).rejects.toThrow(/模型配置文件/);
  });

  it("config.json 是合法 JSON 但缺字段时 view 报中文错误（safeParse 分支）", async () => {
    await writeFile(
      path.join(dir, "config.json"),
      JSON.stringify({ baseURL: "http://a/v1" }),
      "utf8"
    );
    const settings = createProviderSettings({ dir, credentials });
    await expect(settings.view()).rejects.toThrow(/模型配置文件缺少/);
  });

  it("密钥保管不可用且提交新密钥时，整次 save 失败且 config.json 不落盘（先写密钥再写配置）", async () => {
    const broken = createCredentialStore(dir, {
      available: false,
      encrypt: (s) => s,
      decrypt: (s) => s
    });
    const settings = createProviderSettings({ dir, credentials: broken });
    await expect(
      settings.save({ baseURL: "http://a/v1", model: "m", apiKey: "sk-x1234" })
    ).rejects.toThrow(/不可用/);
    expect(await settings.config()).toBeNull();
  });

  it("保存后读盘校验两个落盘文件的原始字节都不含明文密钥（spec §8：密钥绝不以明文落盘，覆盖每个文件）", async () => {
    const settings = createProviderSettings({ dir, credentials });
    const key = "sk-plaintext-never-on-disk";
    await settings.save({ baseURL: "http://a/v1", model: "m", apiKey: key });
    const configRaw = await readFile(path.join(dir, "config.json"), "utf8");
    const secretsRaw = await readFile(path.join(dir, "secrets.enc"), "utf8");
    expect(configRaw).not.toContain(key);
    expect(secretsRaw).not.toContain(key);
    expect(JSON.parse(configRaw)).toEqual({ baseURL: "http://a/v1", model: "m" });
  });

  it("config.json 读取遇到非 ENOENT 的 IO 错误（EISDIR）时向外抛，不被当成未配置返回 null", async () => {
    // 注入 readFile 抛 EISDIR（非 ENOENT）：确定性、跨平台一致，不依赖真实文件系统对
    // 各类占位/权限场景在不同 OS 上返回 ENOENT/ENOTDIR/EISDIR 的差异。
    const eisdir = Object.assign(new Error("illegal operation on a directory, read"), {
      code: "EISDIR"
    });
    const readSpy = vi.fn<ReadTextFile>(() => Promise.reject(eisdir));
    const settings = createProviderSettings({ dir, credentials, readFile: readSpy });
    await expect(settings.config()).rejects.toThrow(/模型配置文件读取失败/);
  });
});
