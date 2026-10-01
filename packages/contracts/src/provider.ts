import { z } from "zod";

const httpUrl = /^https?:\/\//;

export const providerConfigSchema = z.object({
  baseURL: z.string().min(1).regex(httpUrl, "baseURL 必须以 http:// 或 https:// 开头"),
  model: z.string().min(1)
});
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

/** apiKey 为 null 表示「保留现有密钥」；渲染层提交的明文密钥只进主进程，绝不回传。 */
export const providerDraftSchema = z.object({
  baseURL: z.string().min(1).regex(httpUrl, "baseURL 必须以 http:// 或 https:// 开头"),
  model: z.string().min(1),
  apiKey: z.string().min(1).nullable()
});
export type ProviderDraft = z.infer<typeof providerDraftSchema>;

export interface ProviderView {
  hasKey: boolean;
  baseURL: string;
  model: string;
  keyMask: string;
}

export function maskApiKey(key: string): string {
  const tail = key.length > 4 ? key.slice(-4) : "";
  return tail === "" ? "••••" : `••••${tail}`;
}
