import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  LEGACY_SECRET_FILE,
  SECRET_DIR,
  createCredentialStore,
  secretFileNameOf,
  type Cipher,
  type ReadTextFile
} from "./credential-store.js";

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
  dir = await mkdtemp(path.join(tmpdir(), "mochen-secrets-v3-"));
});
afterEach(async () => {
  for (const entry of await readdir(dir)) {
    await rm(path.join(dir, entry), { recursive: true, force: true });
  }
});

const REF_A = "11111111-2222-3333-4444-555555555555";
const REF_B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("credentialStore · 按连接分份（v3）", () => {
  it("保存后读回同一串，落盘文件里没有明文", async () => {
    const store = createCredentialStore(dir, reversible);
    await store.save(REF_A, "sk-secret-token");
    expect(await store.read(REF_A)).toBe("sk-secret-token");
    const onDisk = await readFile(path.join(dir, SECRET_DIR, `${REF_A}.enc`), "utf8");
    expect(onDisk).not.toContain("sk-secret-token");
  });

  it("**两把密钥互不覆盖**（多供应商并存的根需求，共用一个文件就必然互相盖掉）", async () => {
    const store = createCredentialStore(dir, reversible);
    await store.save(REF_A, "sk-deep");
    await store.save(REF_B, "sk-mimo");
    expect(await store.read(REF_A)).toBe("sk-deep");
    expect(await store.read(REF_B)).toBe("sk-mimo");
  });

  it("清一条不影响另一条", async () => {
    const store = createCredentialStore(dir, reversible);
    await store.save(REF_A, "sk-a");
    await store.save(REF_B, "sk-b");
    await store.clear(REF_A);
    expect(await store.read(REF_A)).toBeNull();
    expect(await store.read(REF_B)).toBe("sk-b");
  });

  it("从没存过的那条读出来是 null（不是空串）", async () => {
    const store = createCredentialStore(dir, reversible);
    expect(await store.read("never-saved-ref")).toBeNull();
  });

  it("ref 会拼进路径：**必须校验**，否则 `../../` 就能把密钥写到目录外", () => {
    for (const bad of ["../../escape", "a/b", "..", "", "x".repeat(65), "a\\b", "a b"]) {
      expect(() => secretFileNameOf(bad), `${bad} 竟被放行`).toThrow(/不合法/);
    }
    // 合法的那几个照常给文件名。
    expect(secretFileNameOf(REF_A)).toBe(`${REF_A}.enc`);
    expect(secretFileNameOf("legacy")).toBe("legacy.enc");
  });

  it("落盘那一刻就拒非法 ref（不是等读的时候才炸）", async () => {
    const store = createCredentialStore(dir, reversible);
    await expect(store.save("../escape", "sk-x")).rejects.toThrow(/不合法/);
  });

  it("系统密钥保管不可用时拒绝落盘，且目录里不留下任何文件", async () => {
    const store = createCredentialStore(dir, {
      available: false,
      encrypt: (s) => s,
      decrypt: (s) => s
    });
    await expect(store.save(REF_A, "sk-secret")).rejects.toThrow(/密钥保管不可用/);
    await expect(readdir(dir)).resolves.toEqual([]);
  });

  it("加密结果仍含明文时拒绝落盘", async () => {
    const store = createCredentialStore(dir, {
      available: true,
      encrypt: (s) => `x${s}x`,
      decrypt: (s) => s
    });
    await expect(store.save(REF_A, "sk-secret")).rejects.toThrow(/仍含明文/);
  });

  it("非 ENOENT 的读错误不当成「没密钥」（否则会诱使用户重填）", async () => {
    const readFileFn: ReadTextFile = vi.fn(async () => {
      const error: NodeJS.ErrnoException = new Error("文件被别的程序占用");
      error.code = "EBUSY";
      throw error;
    });
    const store = createCredentialStore(dir, reversible, readFileFn);
    await expect(store.read(REF_A)).rejects.toThrow(/密钥文件读取失败/);
  });

  it("空文件当作「没存过」，不拿去解密报错", async () => {
    await mkdir(path.join(dir, SECRET_DIR), { recursive: true });
    await writeFile(path.join(dir, SECRET_DIR, `${REF_A}.enc`), "", "utf8");
    const store = createCredentialStore(dir, reversible);
    expect(await store.read(REF_A)).toBeNull();
  });
});

describe("旧版那一份的搬移（secrets.enc → secrets/<连接id>.enc）", () => {
  it("搬完新位置能读到，**老文件不再存在**（复制会让用户以为清干净了、其实还在盘上）", async () => {
    await writeFile(path.join(dir, LEGACY_SECRET_FILE), reversible.encrypt("sk-legacy"), "utf8");
    const store = createCredentialStore(dir, reversible);
    expect(await store.hasLegacy()).toBe(true);

    await store.moveLegacyTo(REF_A);

    expect(await store.read(REF_A)).toBe("sk-legacy");
    expect(await store.hasLegacy()).toBe(false);
    await expect(readFile(path.join(dir, LEGACY_SECRET_FILE), "utf8")).rejects.toThrow();
  });

  it("没有老文件时搬移是**幂等**的，不报错（重复迁移不该把用户卡住）", async () => {
    const store = createCredentialStore(dir, reversible);
    expect(await store.hasLegacy()).toBe(false);
    await expect(store.moveLegacyTo(REF_A)).resolves.toBeUndefined();
  });

  it("搬移不落地盘目标目录时先建目录（老版本可能压根没有 secrets/）", async () => {
    await writeFile(path.join(dir, LEGACY_SECRET_FILE), reversible.encrypt("sk-x"), "utf8");
    const store = createCredentialStore(dir, reversible);
    await store.moveLegacyTo(REF_B);
    expect(await store.read(REF_B)).toBe("sk-x");
  });
});
