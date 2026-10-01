import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface Cipher {
  available: boolean;
  encrypt(plain: string): string;
  decrypt(text: string): string;
}

export interface CredentialStore {
  read(): Promise<string | null>;
  save(key: string): Promise<void>;
  clear(): Promise<void>;
}

/** 密钥文件名与 spec §8 一致：目录内 secrets.enc，内容永远是密文。 */
export function createCredentialStore(dir: string, cipher: Cipher): CredentialStore {
  const target = path.join(dir, "secrets.enc");

  return {
    async read() {
      const raw = await readFile(target, "utf8").catch(() => null);
      if (raw === null || raw.trim() === "") return null;
      try {
        return cipher.decrypt(raw);
      } catch (error) {
        throw new Error(
          `密钥读取失败（${error instanceof Error ? error.message : String(error)}）；请在设置里重新填写 API Key。`,
          { cause: error }
        );
      }
    },

    async save(key: string) {
      if (!cipher.available)
        throw new Error(
          "系统密钥保管不可用（safeStorage），密钥不会以明文落盘；请先在系统里启用凭据保护。"
        );
      const text = cipher.encrypt(key);
      if (text.includes(key)) throw new Error("加密结果仍含明文，已拒绝落盘。");
      await mkdir(dir, { recursive: true });
      await writeFile(target, text, "utf8");
    },

    async clear() {
      await rm(target, { force: true });
    }
  };
}
