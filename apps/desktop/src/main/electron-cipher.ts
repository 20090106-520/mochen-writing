import type { Cipher } from "./credential-store.js";

/** electron `safeStorage` 的形状；由调用方传入，所以本文件的测试不需要 electron。 */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(text: Buffer): string;
}

/**
 * 包装薄到只有编码转换：明文只在这条调用的参数里存在，落盘形态永远是 base64 后的密文。
 * safeStorage 不可用时 available 为 false，credential-store 会拒绝保存，密钥不会明文上盘。
 */
export function electronCipher(storage: SafeStorageLike): Cipher {
  return {
    available: storage.isEncryptionAvailable(),
    encrypt: (plain) => storage.encryptString(plain).toString("base64"),
    decrypt: (text) => storage.decryptString(Buffer.from(text, "base64"))
  };
}
