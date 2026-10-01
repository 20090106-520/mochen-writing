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

/**
 * 读文本文件的注入点：默认走 node 的 utf8 readFile，单测可注入以确定性模拟
 * 非 ENOENT 的 IO 错误（EBUSY/EACCES 等），无需依赖各平台文件系统的具体报错码差异。
 */
export type ReadTextFile = (pathname: string) => Promise<string>;

/** 密钥文件名与 spec §8 一致：目录内 secrets.enc，内容永远是密文。 */
export function createCredentialStore(
  dir: string,
  cipher: Cipher,
  readFileFn: ReadTextFile = (p) => readFile(p, "utf8")
): CredentialStore {
  const target = path.join(dir, "secrets.enc");

  return {
    async read() {
      // 只有「文件不存在（ENOENT）」才等于「从未配置」→ null；
      // EBUSY/EACCES 等真实 IO 错误绝不吞成 null，否则 Task 14 设置页会把「读不到」
      // 误判为「没密钥」并诱使用户重填、Task 11 的「未配置模型」守卫会在已配置的机器上误触发。
      let raw: string;
      try {
        raw = await readFileFn(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw new Error(
          `密钥文件读取失败（${error instanceof Error ? error.message : String(error)}）；` +
            "请检查密钥存储目录是否被占用或有访问权限。",
          { cause: error }
        );
      }
      if (raw.trim() === "") return null;
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
