import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  IPC_CHANNELS,
  WebdavConfigSchema,
  type WebdavConfigInput,
  type WebdavConfigSnapshot
} from "@mochen/contracts";
import { defaultAtomicFs, writeFileAtomic, type AtomicWriteFs } from "@mochen/fs-store";
import type { CredentialStore, ReadTextFile } from "./credential-store.js";
import { handleTrusted } from "./ipc-guard.js";

/**
 * WebDAV 密钥在 `credential-store` 里的固定 ref。
 *
 * 与 provider 连接密钥按 connectionId 分份不同，WebDAV 配置全局只有一份（用户配一台 NAS
 * 给所有书共用），所以 ref 是固定字符串。`/^[a-zA-Z0-9-]{1,64}$/` 这一关它合法——
 * 字母数字组成、长度 6，与「连接 id 是 UUID」属于同一档口径。
 */
export const WEBDAV_CRED_REF = "webdav";

/**
 * WebDAV 配置的存读真身（2026-10-15）。
 *
 * 【为什么 url / username 与密码分开存】
 * url / username 落 `<appData>/webdav-config.json`（与 appearance 同款原子写），
 * password 走 `credential-store`（ref = `WEBDAV_CRED_REF`）——与 provider 密钥同套加密分份。
 * 把密码写进 JSON 等于把已经加密存好的密钥再明文落盘一次，等于没加密。
 *
 * 【坏值退默认档，不抛】
 * 与 `appearance-store.ts` 同一档口径：JSON 读不回 / zod 不过 ⇒ persisted:false + 空配置，
 * 不阻塞启动。url / username 这种配置坏了不值得拦着用户修——退默认让他重填即可。
 *
 * 【save 的 password 三态】
 * 见 contracts `WebdavConfigInput` 的注释。`""` 是明确清空，`undefined` 是保留——
 * 与 `provider-save` 那条 `apiKey null = 保留、"" = 清空` 同一条铁律（铁律 6）。
 */
export interface WebdavConfigStore {
  read(): Promise<WebdavConfigSnapshot>;
  save(input: WebdavConfigInput): Promise<void>;
  /**
   * 读明文密钥——只给主进程出网前用，不跨 IPC。
   *
   * 【为什么不在 read() 里一起回】
   * `read()` 的回执要跨 IPC 给渲染层，明文密钥不能跟过去——见 contracts `WebdavConfigSnapshot`
   * 的注释。出网那一层（webdav-service 的 prepare）在主进程内单独调它取密钥，密钥只住在
   * 主进程内存的这一次请求里，IPC 边界永远看不到。
   */
  readPassword(): Promise<string | null>;
}

type Handler = (channel: string, fn: (...args: unknown[]) => unknown) => void;

export function createWebdavConfigStore(deps: {
  dir: string;
  credentials: CredentialStore;
  readFile?: ReadTextFile;
  /** 写盘缝（P0-5 同族）：默认真 fs，测试注入「只坏一步」的实现。命名同 book-service。 */
  fs?: AtomicWriteFs;
}): WebdavConfigStore {
  const configFile = path.join(deps.dir, "webdav-config.json");
  const readText: ReadTextFile = deps.readFile ?? ((p) => readFile(p, "utf8"));
  const writeFs: AtomicWriteFs = deps.fs ?? defaultAtomicFs;

  async function read(): Promise<WebdavConfigSnapshot> {
    const fallback: WebdavConfigSnapshot = {
      persisted: false,
      url: "",
      username: "",
      hasPassword: false
    };
    let raw: string;
    try {
      raw = await readText(configFile);
    } catch (error) {
      // 与 appearance-store 同款：ENOENT 与其他读不动都退默认档，不阻塞启动。
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
      return fallback;
    }
    if (raw.trim() === "") return fallback;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fallback;
    }
    const result = WebdavConfigSchema.safeParse(parsed);
    if (!result.success) return fallback;
    // 密钥读取失败不抛——provider-settings 的同款兜底：单条密钥读坏不能挡住整个配置读不出来。
    let hasPassword: boolean;
    try {
      hasPassword = (await deps.credentials.read(WEBDAV_CRED_REF)) !== null;
    } catch {
      hasPassword = false;
    }
    return {
      persisted: true,
      url: result.data.url,
      username: result.data.username,
      hasPassword
    };
  }

  async function save(input: WebdavConfigInput): Promise<void> {
    const parsed = WebdavConfigSchema.safeParse({
      url: input.url,
      username: input.username
    });
    if (!parsed.success) {
      throw new Error("WebDAV 配置没保存：地址或用户名不合法。");
    }
    // 先落密钥再落 JSON——与 provider-save 同款顺序：密钥保管不可用（或恒等加密含明文），
    // credentials.save 会抛，JSON 因此不被改写，整次 save 要么全成功、要么不留半套新地址。
    if (input.password === "") {
      await deps.credentials.clear(WEBDAV_CRED_REF);
    } else if (input.password !== undefined) {
      await deps.credentials.save(WEBDAV_CRED_REF, input.password);
    }
    // undefined 那一档：不动密钥，只更新 url / username。
    await writeFileAtomic(configFile, `${JSON.stringify(parsed.data, null, 2)}\n`, writeFs);
  }

  async function readPassword(): Promise<string | null> {
    return deps.credentials.read(WEBDAV_CRED_REF);
  }

  return { read, save, readPassword };
}

/** 只注册白名单里的两条通道：读快照（密钥不回）与整份写回。 */
export function registerWebdavConfigIpc(handle: Handler, store: WebdavConfigStore): void {
  handleTrusted(handle, IPC_CHANNELS.webdavConfigGet, () => store.read());
  handleTrusted(handle, IPC_CHANNELS.webdavConfigSave, (_event, input) =>
    store.save(input as WebdavConfigInput)
  );
}
