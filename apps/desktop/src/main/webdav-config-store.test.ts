import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CredentialStore } from "./credential-store.js";
import { WEBDAV_CRED_REF, createWebdavConfigStore } from "./webdav-config-store.js";

/**
 * WebDAV 配置存读（2026-10-15）。密钥三态与「url/username 落 JSON、密码走 credential-store」
 * 是这一刀的本体——这里逐档钉，坏值退默认档那条与 appearance-store 同款。
 */

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mochen-webdav-cfg-"));
});
afterEach(async () => {
  for (const entry of await readdir(dir)) {
    await rm(path.join(dir, entry), { recursive: true, force: true });
  }
});

/** 内存份的 CredentialStore：save / read / clear 三条全在 Map 里走，不碰真盘加密。 */
function memCredentials(): CredentialStore {
  const store = new Map<string, string>();
  return {
    async save(ref, value) {
      store.set(ref, value);
    },
    async read(ref) {
      return store.get(ref) ?? null;
    },
    async clear(ref) {
      store.delete(ref);
    },
    async hasLegacy() {
      return false;
    },
    async moveLegacyTo() {}
  };
}

describe("webdavConfigStore · read", () => {
  it("没存过时回 persisted=false + 空配置", async () => {
    const store = createWebdavConfigStore({ dir, credentials: memCredentials() });
    const snap = await store.read();
    expect(snap).toEqual({
      persisted: false,
      url: "",
      username: "",
      hasPassword: false
    });
  });

  it("save 后 read 原样读回，persisted=true", async () => {
    const store = createWebdavConfigStore({ dir, credentials: memCredentials() });
    await store.save({
      url: "https://nas.local/dav/",
      username: "alice",
      password: "secret"
    });
    const snap = await store.read();
    expect(snap).toEqual({
      persisted: true,
      url: "https://nas.local/dav/",
      username: "alice",
      hasPassword: true
    });
  });

  it("盘上 JSON 损坏时退默认档，不阻塞", async () => {
    await writeFile(path.join(dir, "webdav-config.json"), "{ 不是 JSON", "utf8");
    const store = createWebdavConfigStore({ dir, credentials: memCredentials() });
    const snap = await store.read();
    expect(snap.persisted).toBe(false);
    expect(snap.url).toBe("");
  });

  it("盘上内容过不了 zod（url 空）退默认档", async () => {
    await writeFile(
      path.join(dir, "webdav-config.json"),
      JSON.stringify({ url: "", username: "alice" }),
      "utf8"
    );
    const snap = await createWebdavConfigStore({
      dir,
      credentials: memCredentials()
    }).read();
    expect(snap.persisted).toBe(false);
  });

  it("read 不把明文密钥递回去——snapshot 里没有 password 字段", async () => {
    const store = createWebdavConfigStore({ dir, credentials: memCredentials() });
    await store.save({ url: "https://nas/", username: "u", password: "p" });
    const snap = await store.read();
    expect((snap as unknown as { password?: string }).password).toBeUndefined();
  });
});

describe("webdavConfigStore · save 的密码三态", () => {
  it("password=undefined ⇒ 保留已存密码（只更 url / username）", async () => {
    const creds = memCredentials();
    const store = createWebdavConfigStore({ dir, credentials: creds });
    await store.save({ url: "https://nas/", username: "u", password: "first" });
    // 这次 save 不递 password——undefined 那一档
    await store.save({ url: "https://nas/new/", username: "u" });
    expect(await store.readPassword()).toBe("first");
    const snap = await store.read();
    expect(snap.url).toBe("https://nas/new/");
    expect(snap.hasPassword).toBe(true);
  });

  it("password='' ⇒ 明确清空（hasPassword 变 false）", async () => {
    const creds = memCredentials();
    const store = createWebdavConfigStore({ dir, credentials: creds });
    await store.save({ url: "https://nas/", username: "u", password: "first" });
    expect((await store.read()).hasPassword).toBe(true);
    await store.save({ url: "https://nas/", username: "u", password: "" });
    expect((await store.read()).hasPassword).toBe(false);
    expect(await store.readPassword()).toBeNull();
  });

  it("password=非空 ⇒ 替换（旧值被盖掉）", async () => {
    const creds = memCredentials();
    const store = createWebdavConfigStore({ dir, credentials: creds });
    await store.save({ url: "https://nas/", username: "u", password: "first" });
    await store.save({ url: "https://nas/", username: "u", password: "second" });
    expect(await store.readPassword()).toBe("second");
  });

  it("save 拒非法值（url 空）——密钥不落，JSON 也不落", async () => {
    const creds = memCredentials();
    const store = createWebdavConfigStore({ dir, credentials: creds });
    await expect(store.save({ url: "", username: "u", password: "p" })).rejects.toThrow(
      /WebDAV 配置没保存/
    );
    // 读回还是没存过
    expect((await store.read()).persisted).toBe(false);
  });

  it("readPassword 在密钥保管失败时如实抛错——service 那一层 prepare 会接成 io-error", async () => {
    const credsThrow: CredentialStore = {
      async save() {},
      async read() {
        throw new Error("safeStorage 不可用");
      },
      async clear() {},
      async hasLegacy() {
        return false;
      },
      async moveLegacyTo() {}
    };
    const store = createWebdavConfigStore({ dir, credentials: credsThrow });
    await expect(store.readPassword()).rejects.toThrow(/safeStorage 不可用/);
  });
});

describe("webdavConfigStore · 落盘文件", () => {
  it("url / username 落 webdav-config.json，明文密码不进 JSON", async () => {
    const creds = memCredentials();
    const store = createWebdavConfigStore({ dir, credentials: creds });
    await store.save({
      url: "https://nas.local/dav/",
      username: "alice",
      password: "super-secret-token"
    });
    const raw = await readFile(path.join(dir, "webdav-config.json"), "utf8");
    expect(raw).toContain("https://nas.local/dav/");
    expect(raw).toContain("alice");
    expect(raw).not.toContain("super-secret-token");
  });

  it("密钥用固定 ref = WEBDAV_CRED_REF（与 provider 连接密钥同套加密分份）", async () => {
    expect(WEBDAV_CRED_REF).toBe("webdav");
  });
});

describe("webdavConfigStore · IPC 注册", () => {
  it("registerWebdavConfigIpc 注册两条：webdavConfigGet / webdavConfigSave", async () => {
    const { registerWebdavConfigIpc } = await import("./webdav-config-store.js");
    const { IPC_CHANNELS } = await import("@mochen/contracts");
    const registered = new Map<string, (...args: unknown[]) => unknown>();
    const handle = (channel: string, fn: (...args: unknown[]) => unknown): void => {
      registered.set(channel, fn);
    };
    const store = createWebdavConfigStore({ dir, credentials: memCredentials() });
    registerWebdavConfigIpc(handle, store);
    expect(registered.has(IPC_CHANNELS.webdavConfigGet)).toBe(true);
    expect(registered.has(IPC_CHANNELS.webdavConfigSave)).toBe(true);
  });
});
