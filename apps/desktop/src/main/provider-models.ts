import type { ModelListResult } from "@mochen/contracts";
import type { ProviderSettings } from "./provider-settings.js";

export const MODEL_LIST_TIMEOUT_MS = 10_000;

/** 出网那一发用到的字段：测试处传自记调用的假函数，生产处默认全局 fetch。 */
export interface ModelListFetcher {
  (
    url: string,
    init: { method: "GET"; headers: Record<string, string>; signal: AbortSignal }
  ): Promise<Pick<Response, "ok" | "status"> & { json: () => Promise<unknown> }>;
}

export interface ModelLister {
  list(): Promise<ModelListResult>;
}

/**
 * 与 agent-runtime 的 `chat/completions` 同一个拼接口径：吃掉 baseURL 尾部斜杠再接端点名。
 * 两处各写一次 `replace(/\/+$/,"")` 不是第二份决策表——真正的规则是「baseURL 以 /v1 结尾、
 * 端点名往后接」，这一条在本文件与 provider-client 里各自只出现一处。
 */
export function modelsUrlOf(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, "")}/models`;
}

/**
 * 宽容解析：OpenAI 兼容端点的三种常见外壳都认（`{data:[{id}]}`、`{models:[…]}`、裸数组），
 * 项可以是 `{id}` 也可以是裸字符串。空白项与非字符串 id 直接丢，去重后按码元排序——
 * 与工具清单同一个排序口径，不引入 locale 比较（同一份输入在两台机器上必须给同一个列表）。
 */
export function modelIdsOf(payload: unknown): string[] {
  const root = payload as Record<string, unknown> | undefined;
  const raw = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.["data"])
      ? (root?.["data"] as unknown[])
      : Array.isArray(root?.["models"])
        ? (root?.["models"] as unknown[])
        : [];
  const ids = new Set<string>();
  for (const item of raw) {
    const candidate =
      typeof item === "string"
        ? item
        : typeof (item as { id?: unknown })?.id === "string"
          ? ((item as { id: string }).id as string)
          : "";
    const id = candidate.trim();
    if (id !== "") ids.add(id);
  }
  return [...ids].sort();
}

function httpReason(status: number): string {
  if (status === 401 || status === 403)
    return "密钥无效或没被授权拉取模型列表，先在模型设置里核对密钥。";
  if (status === 404) return "这个 API 地址没有提供模型列表接口，请在模型设置里手填模型名。";
  return `拉取模型列表失败（HTTP ${status}）。`;
}

/** 网络错误不许把上游原文带过去：那句话里可能有 URL、代理配置，甚至用户贴错的密钥。 */
function networkReason(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError")
    return "等这个 API 地址回话超时了，稍后重试，或先在模型设置里核对地址。";
  return "连不上这个 API 地址，先在模型设置里核对 baseURL 是否可访问。";
}

/**
 * 拉一次 `{baseURL}/models`。密钥只进 `Authorization: Bearer` 头，绝不进 URL；
 * 没有密钥时连这个头都不发（本地端点常常不需要它），而不是发一个 `Bearer undefined`。
 * 任何失败都收成 `{ok:false, reason}`：这条通道是给弹层摆列表用的，不该变成渲染层的 unhandled rejection。
 */
export function createModelLister(deps: {
  settings: ProviderSettings;
  fetchImpl?: ModelListFetcher;
  timeoutMs?: number;
}): ModelLister {
  const send: ModelListFetcher = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const timeoutMs = deps.timeoutMs ?? MODEL_LIST_TIMEOUT_MS;

  return {
    async list() {
      let baseURL: string;
      let key: string | null;
      try {
        const config = await deps.settings.config();
        if (config === null)
          return { ok: false, reason: "还没有配置 API 地址，先在模型设置里填好 baseURL。" };
        baseURL = config.baseURL;
        key = await deps.settings.apiKey();
      } catch (error) {
        // provider-settings 抛的已经是中文单句（配置文件被占用 / 缺字段），原样收成理由。
        return { ok: false, reason: error instanceof Error ? error.message : networkReason(error) };
      }

      const headers: Record<string, string> = { Accept: "application/json" };
      if (key !== null && key.trim() !== "") headers["Authorization"] = `Bearer ${key}`;

      let response: Awaited<ReturnType<ModelListFetcher>>;
      try {
        response = await send(modelsUrlOf(baseURL), {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch (error) {
        return { ok: false, reason: networkReason(error) };
      }
      if (!response.ok) return { ok: false, reason: httpReason(response.status) };

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return {
          ok: false,
          reason: "这个地址回来的不是 JSON，多半不是 OpenAI 兼容接口。"
        };
      }
      const models = modelIdsOf(payload);
      if (models.length === 0) return { ok: false, reason: "这个 API 地址没有返回任何模型。" };
      return { ok: true, models };
    }
  };
}
