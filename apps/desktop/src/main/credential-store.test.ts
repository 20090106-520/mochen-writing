import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createCredentialStore, type Cipher, type ReadTextFile } from "./credential-store.js";

let dir = "";

const reversible: Cipher = {
  available: true,
  encrypt: (plain) => `enc:${Buffer.from(plain, "utf8").toString("base64url")}`,
  decrypt: (text) => {
    if (!text.startsWith("enc:")) throw new Error("不是本存储写出的格式");
    return Buffer.from(text.slice(4), "base64url").toString("utf8");
  }
};

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mochen-secrets-"));
});
afterEach(async () => {
  for (const entry of await readdir(dir)) {
    await rm(path.join(dir, entry), { recursive: true, force: true });
  }
});

describe("credentialStore", () => {
  it("保存后读回同一串，落盘文件里没有明文", async () => {
    const store = createCredentialStore(dir, reversible);
    await store.save("sk-secret-token");
    expect(await store.read()).toBe("sk-secret-token");
    const files = await readdir(dir);
    expect(files).toEqual(["secrets.enc"]);
    const raw = await readFile(path.join(dir, "secrets.enc"), "utf8");
    expect(raw).not.toContain("sk-secret-token");
    expect(raw.startsWith("enc:")).toBe(true);
  });

  it("没有保存过密钥时 read 返回 null", async () => {
    expect(await createCredentialStore(dir, reversible).read()).toBeNull();
  });

  it("密钥文件为空/纯空白时 read 返回 null（不把空文件当密文去解密）", async () => {
    const store = createCredentialStore(dir, reversible);
    await writeFile(path.join(dir, "secrets.enc"), "   ", "utf8");
    expect(await store.read()).toBeNull();
  });

  it("系统密钥保管不可用时拒绝落盘，且目录里不留下任何文件（spec §8）", async () => {
    const store = createCredentialStore(dir, {
      available: false,
      encrypt: (s) => s,
      decrypt: (s) => s
    });
    await expect(store.save("sk-secret-token")).rejects.toThrow(/不可用/);
    expect(await readdir(dir)).toEqual([]);
  });

  it("加密结果仍是恒等（含明文）时拒绝落盘，且不写出 secrets.enc", async () => {
    const store = createCredentialStore(dir, {
      available: true,
      encrypt: (s) => s,
      decrypt: (s) => s
    });
    await expect(store.save("sk-secret-token")).rejects.toThrow(/明文/);
    expect(await readdir(dir)).not.toContain("secrets.enc");
  });

  it("文件被外部改动导致解密失败时抛中文错误，不返回半串", async () => {
    const store = createCredentialStore(dir, reversible);
    await store.save("sk-abcdef");
    await writeFile(path.join(dir, "secrets.enc"), "garbage", "utf8");
    await expect(store.read()).rejects.toThrow(/密钥读取失败/);
  });

  it("clear 后文件消失", async () => {
    const store = createCredentialStore(dir, reversible);
    await store.save("sk-abcdef");
    await store.clear();
    expect(await store.read()).toBeNull();
  });

  it("读密钥遇到非 ENOENT 的 IO 错误（EBUSY）时向外抛，不被当成未配置返回 null", async () => {
    // 注入 readFile 抛出 EBUSY（非 ENOENT）：确定性、跨平台一致，不依赖真实文件系统对
    // 「父级是文件」「目标是目录」在不同 OS 上返回 ENOENT/ENOTDIR/EISDIR/EBUSY 的差异。
    const busy = Object.assign(new Error("resource busy or locked"), { code: "EBUSY" });
    const readSpy = vi.fn<ReadTextFile>(() => Promise.reject(busy));
    const store = createCredentialStore(dir, reversible, readSpy);
    await expect(store.read()).rejects.toThrow(/密钥文件读取失败/);
  });
});
