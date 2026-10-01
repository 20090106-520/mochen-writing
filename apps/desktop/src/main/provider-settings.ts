import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  maskApiKey,
  providerConfigSchema,
  providerDraftSchema,
  type ProviderConfig,
  type ProviderDraft,
  type ProviderView
} from "@mochen/contracts";
import type { CredentialStore } from "./credential-store.js";

export interface ProviderSettings {
  view(): Promise<ProviderView>;
  config(): Promise<ProviderConfig | null>;
  apiKey(): Promise<string | null>;
  save(draft: ProviderDraft): Promise<ProviderView>;
}

export function createProviderSettings(deps: {
  dir: string;
  credentials: CredentialStore;
}): ProviderSettings {
  const configFile = path.join(deps.dir, "config.json");

  async function loadConfig(): Promise<ProviderConfig | null> {
    const raw = await readFile(configFile, "utf8").catch(() => null);
    // 没配置过就是 null：Task 10 取密钥、Task 11 拦「未配置模型」的 turn 都依赖这条不抛错。
    if (raw === null || raw.trim() === "") return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `模型配置文件不可读：${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error
        }
      );
    }
    const result = providerConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `模型配置文件缺少 baseURL 或 model：${result.error.issues[0]?.message ?? "字段不完整"}`
      );
    }
    return result.data;
  }

  return {
    async view() {
      const config = await loadConfig();
      const key = await deps.credentials.read();
      return {
        hasKey: key !== null,
        baseURL: config?.baseURL ?? "",
        model: config?.model ?? "",
        keyMask: key === null ? "" : maskApiKey(key)
      };
    },

    config: loadConfig,

    apiKey: () => deps.credentials.read(),

    async save(draft) {
      const value = providerDraftSchema.parse(draft);
      const config = { baseURL: value.baseURL, model: value.model };
      await mkdir(deps.dir, { recursive: true });
      // 裁定：先落密钥再落 config.json。若密钥保管不可用（或恒等加密含明文），credentials.save 会抛，
      // config.json 因此不被改写——整次 save 要么全成功、要么不留半套新 baseURL/model。
      // 不引入事务/回滚机制（超出本任务范围），只调整这两次写入的先后。
      if (value.apiKey !== null) await deps.credentials.save(value.apiKey);
      await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`, "utf8");
      const key = await deps.credentials.read();
      return {
        hasKey: key !== null,
        baseURL: config.baseURL,
        model: config.model,
        keyMask: key === null ? "" : maskApiKey(key)
      };
    }
  };
}
