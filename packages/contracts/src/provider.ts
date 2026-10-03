import { z } from "zod";

const httpUrl = /^https?:\/\//;

export const providerConfigSchema = z.object({
  baseURL: z.string().min(1).regex(httpUrl, "baseURL 必须以 http:// 或 https:// 开头"),
  model: z.string().min(1)
});
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

/** apiKey 为 null 表示「保留现有密钥」；渲染层提交的明文密钥只进主进程，绝不回传。 */
export const providerDraftSchema = z.object({
  baseURL: z
    .string()
    .min(1, "baseURL 不能为空")
    .regex(httpUrl, "baseURL 必须以 http:// 或 https:// 开头"),
  model: z.string().min(1, "模型名不能为空"),
  apiKey: z.string().min(1, "API Key 不能为空").nullable()
});
export type ProviderDraft = z.infer<typeof providerDraftSchema>;

export interface ProviderView {
  hasKey: boolean;
  baseURL: string;
  model: string;
  keyMask: string;
}

/**
 * `{baseURL}/models` 的取数结果（#104）。
 * 每条只有 id：OpenAI 兼容端点不给中文显示名，编一个出来就是假名字，宁缺。
 * `ok:false` 的 reason 是一句可执行的中文，弹层直接摆给用户看——包括「这个地址没返回任何模型」，
 * 因为对用户来说「拉不到可选项」和「失败」的下一步动作是同一件事。
 */
export const modelListResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), models: z.array(z.string().min(1)) }),
  z.object({ ok: z.literal(false), reason: z.string().min(1) })
]);
export type ModelListResult = z.infer<typeof modelListResultSchema>;

export function maskApiKey(key: string): string {
  const tail = key.length > 4 ? key.slice(-4) : "";
  return tail === "" ? "••••" : `••••${tail}`;
}
