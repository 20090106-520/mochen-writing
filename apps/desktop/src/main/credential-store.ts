import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface Cipher {
  available: boolean;
  encrypt(plain: string): string;
  decrypt(text: string): string;
}

export interface CredentialStore {
  read(ref: string): Promise<string | null>;
  save(ref: string, key: string): Promise<void>;
  clear(ref: string): Promise<void>;
  /** 老版那一份（`secrets.enc`，地址全局唯一时代的产物）在不在。 */
  hasLegacy(): Promise<boolean>;
  /**
   * 把老版那一份搬进 `ref` 名下。
   * **必须真搬（rename）不能复制**：复制会让旧文件一直留在盘上，
   * 用户以为清干净了，其实明文（密文）还在；而且下次迁移又会搬一次，密钥被旧值盖回去。
   */
  moveLegacyTo(ref: string): Promise<void>;
}

/**
 * 读文本文件的注入点：默认走 node 的 utf8 readFile，单测可注入以确定性模拟
 * 非 ENOENT 的 IO 错误（EBUSY/EACCES 等），无需依赖各平台文件系统的具体报错码差异。
 */
export type ReadTextFile = (pathname: string) => Promise<string>;

/** 老版单份密钥的文件名（spec §8）。保留只为了搬走它，不为了继续用。 */
export const LEGACY_SECRET_FILE = "secrets.enc";

/** v3 起密钥按连接分份，都放在这个子目录里。 */
export const SECRET_DIR = "secrets";

/**
 * ref → 文件名。只许字母数字与连字符（连接 id 是 UUID，迁移来的那个是 `legacy`）。
 *
 * **必须校验**：ref 会拼进路径，缺了这道校验，一个 `../../something` 就能把密钥写到目录外。
 * 这不是假设性风险——ref 来自 IPC 参数，而渲染层那条线正是被本仓反复检验过会出意外的。
 */
export function secretFileNameOf(ref: string): string {
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(ref)) {
    throw new Error("密钥存放标识不合法，已拒绝落盘。");
  }
  return `${ref}.enc`;
}

/**
 * 密钥保管：**按连接分份**（2026-10-06 批次 5-⑤）。
 *
 * 此前是全局一份 `secrets.enc`（地址全局唯一时代的产物）。多供应商并存之后那不成立了：
 * DeepSeek 与 OpenAI 各要各的密钥，共用一个文件就必然互相覆盖。
 * 老文件由 `moveLegacyTo` 搬进第一条连接名下，搬完即不再存在。
 */
export function createCredentialStore(
  dir: string,
  cipher: Cipher,
  readFileFn: ReadTextFile = (p) => readFile(p, "utf8")
): CredentialStore {
  const legacyTarget = path.join(dir, LEGACY_SECRET_FILE);
  const dirOf = (ref: string): string => path.join(dir, SECRET_DIR, secretFileNameOf(ref));

  async function readOne(target: string): Promise<string | null> {
    // 只有「文件不存在（ENOENT）」才等于「从未配置」→ null；
    // EBUSY/EACCES 等真实 IO 错误绝不吞成 null，否则设置页会把「读不到」
    // 误判为「没密钥」并诱使用户重填、「未配置模型」守卫会在已配置的机器上误触发。
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
  }

  async function exists(target: string): Promise<boolean> {
    try {
      await readFileFn(target);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw new Error(
        `密钥文件读取失败（${error instanceof Error ? error.message : String(error)}）。`,
        { cause: error }
      );
    }
  }

  return {
    read: (ref) => readOne(dirOf(ref)),

    async save(ref, key) {
      if (!cipher.available)
        throw new Error(
          "系统密钥保管不可用（safeStorage），密钥不会以明文落盘；请先在系统里启用凭据保护。"
        );
      const text = cipher.encrypt(key);
      if (text.includes(key)) throw new Error("加密结果仍含明文，已拒绝落盘。");
      const target = dirOf(ref);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, text, "utf8");
    },

    async clear(ref) {
      await rm(dirOf(ref), { force: true });
    },

    hasLegacy: () => exists(legacyTarget),

    async moveLegacyTo(ref) {
      const target = dirOf(ref);
      await mkdir(path.dirname(target), { recursive: true });
      // rename 是「搬」：源文件随即消失。不存在就当已搬过（幂等，重复迁移不报错）。
      try {
        await rename(legacyTarget, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw new Error(
          `旧密钥文件搬移失败（${error instanceof Error ? error.message : String(error)}）；` +
            "请到模型设置里重新填写一次 API Key。",
          { cause: error }
        );
      }
    }
  };
}
