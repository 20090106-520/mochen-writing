import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCredentialStore } from "./credential-store.js";
import { electronCipher, type SafeStorageLike } from "./electron-cipher.js";

let dir = "";

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mochen-cipher-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface Fake {
  storage: SafeStorageLike;
  encryptInputs: string[];
  decryptInputs: unknown[];
}

/** 真 safeStorage 的形状：入参字符串、返回 Buffer、解密吃 Buffer。 */
function fakeSafeStorage(available: boolean): Fake {
  const encryptInputs: string[] = [];
  const decryptInputs: unknown[] = [];
  return {
    encryptInputs,
    decryptInputs,
    storage: {
      isEncryptionAvailable: () => available,
      encryptString: (plain) => {
        encryptInputs.push(plain);
        return Buffer.from(plain, "utf8");
      },
      decryptString: (value) => {
        decryptInputs.push(value);
        return value.toString("utf8");
      }
    }
  };
}

describe("electronCipher", () => {
  it("available 取的就是 isEncryptionAvailable() 的返回值", () => {
    expect(electronCipher(fakeSafeStorage(true).storage).available).toBe(true);
    expect(electronCipher(fakeSafeStorage(false).storage).available).toBe(false);
  });

  it("encrypt 把明文字符串交给 encryptString，落盘形态是 base64 且不含明文", () => {
    const fake = fakeSafeStorage(true);
    const cipher = electronCipher(fake.storage);
    const text = cipher.encrypt("sk-abcdef123456");
    expect(fake.encryptInputs).toEqual(["sk-abcdef123456"]);
    expect(text).toBe(Buffer.from("sk-abcdef123456", "utf8").toString("base64"));
    expect(text).not.toContain("sk-abcdef123456");
  });

  it("decrypt 递给 decryptString 的是 Buffer，往返还原密钥", () => {
    const fake = fakeSafeStorage(true);
    const cipher = electronCipher(fake.storage);
    expect(cipher.decrypt(cipher.encrypt("sk-往返-9"))).toBe("sk-往返-9");
    expect(fake.decryptInputs[0]).toBeInstanceOf(Buffer);
  });

  it("接上 credential-store 后，那份密钥的原始字节里没有明文", async () => {
    const cipher = electronCipher(fakeSafeStorage(true).storage);
    const store = createCredentialStore(dir, cipher);
    // 2026-10-06 批次 5-⑤：密钥按连接分份存（`secrets/<ref>.enc`），不再是全局一份 secrets.enc。
    const REF = "cipher-round-trip";
    await store.save(REF, "sk-never-on-disk-42");
    const raw = await readFile(path.join(dir, "secrets", `${REF}.enc`), "utf8");
    expect(raw).not.toContain("sk-never-on-disk-42");
    expect(await store.read(REF)).toBe("sk-never-on-disk-42");
  });
});
