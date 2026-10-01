import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  firstIssueMessage,
  maskApiKey,
  providerConfigSchema,
  providerDraftSchema,
  type ProviderConfig,
  type ProviderDraft,
  type ProviderView
} from "@mochen/contracts";
import type { CredentialStore, ReadTextFile } from "./credential-store.js";

export interface ProviderSettings {
  view(): Promise<ProviderView>;
  config(): Promise<ProviderConfig | null>;
  apiKey(): Promise<string | null>;
  save(draft: ProviderDraft): Promise<ProviderView>;
}

export function createProviderSettings(deps: {
  dir: string;
  credentials: CredentialStore;
  readFile?: ReadTextFile;
}): ProviderSettings {
  const configFile = path.join(deps.dir, "config.json");
  const readText: ReadTextFile = deps.readFile ?? ((p) => readFile(p, "utf8"));

  async function loadConfig(): Promise<ProviderConfig | null> {
    // 只有 ENOENT（从未配置）才返回 null；EBUSY/EACCES 等真实 IO 错误向外抛，
    // 否则 Task 11 的「未配置模型」守卫会在配置文件只是读不了（被占用/无权限）时误触发。
    let raw: string;
    try {
      raw = await readText(configFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error(
        `模型配置文件读取失败（${error instanceof Error ? error.message : String(error)}）；` +
          "请检查该文件是否被占用或有访问权限。",
        { cause: error }
      );
    }
    if (raw.trim() === "") return null;
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
      // 模型设置的拒绝同样是跨 IPC 的用户可见文案（裁定 n）：只留单句中文，不留 issue 数组。
      const parsed = providerDraftSchema.safeParse(draft);
      if (!parsed.success)
        throw new Error(firstIssueMessage(parsed.error, "模型设置没保存：填写的内容不对。"));
      const value = parsed.data;
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
