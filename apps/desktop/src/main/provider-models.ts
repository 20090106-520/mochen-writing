import type { AuthHeader, ModelListQuery, ModelListResult } from "@mochen/contracts";
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
  list(query?: ModelListQuery): Promise<ModelListResult>;
}

/** 一次出网要的三样：地址、密钥、**密钥放在哪个头里**。 */
export interface ListTarget {
  baseURL: string;
  key: string | null;
  authHeader: AuthHeader;
}

/**
 * 拉名单用哪个地址、带不带密钥（纯函数，单测钉守卫）：
 * ② 草稿地址 ⇒ 跟草稿配对（用户在对话框里现填的那一对）；
 * ③ 都没给 ⇒ 沿用传入的那份已存取数。
 *
 * **按连接取数（`connectionId`）不在这条线上**：那要 async 去读那条连接自己的密钥，
 * 由 `createModelLister` 在进门时就查好传进来。混进这个纯函数只会逼出一堆 `as never`。
 *
 * 铁律是「**已存密钥只发往它自己那条连接的地址**」：渲染层递进来的任意 URL 绝不能带上用户存好的密钥。
 * ② 里草稿带了密钥就用草稿的；草稿只改地址没带密钥时**裸连**，不拿已存密钥去配一个新地址。
 */
export function resolveModelListTarget(
  stored: ListTarget | null,
  query?: ModelListQuery
): ListTarget {
  const draftURL = query?.baseURL?.trim() ?? "";
  const draftKey = query?.apiKey?.trim() ?? "";
  const draftHeader = query?.authHeader ?? "bearer";
  if (draftURL === "") {
    // **只换了密钥、没改地址** ⇒ 拿新密钥去验已存地址。
    // 漏掉这一支的后果很具体：用户在对话框里换了一把密钥，点保存看到「已保存」，
    // 可实际验的还是旧那把——密钥填错也发现不了（2026-10-06 单测当场抓住的重写回退）。
    if (draftKey !== "" && stored !== null) {
      return { baseURL: stored.baseURL, key: draftKey, authHeader: stored.authHeader };
    }
    return stored ?? { baseURL: "", key: null, authHeader: "bearer" };
  }
  if (draftKey !== "") return { baseURL: draftURL, key: draftKey, authHeader: draftHeader };
  // 草稿改了地址却没给密钥 ⇒ 裸连，绝不把已存密钥发到新地址上。
  if (stored === null || draftURL !== stored.baseURL) {
    return { baseURL: draftURL, key: null, authHeader: draftHeader };
  }
  return { baseURL: draftURL, key: stored.key, authHeader: stored.authHeader };
}

/**
 * 密钥进哪个头。
 *
 * **不是所有 OpenAI 兼容端点都收 `Authorization: Bearer`**：小米 MiMo 官方文档的 curl 写的是
 * `--header "api-key: $MIMO_API_KEY"`。这条只有一个实现（provider-client 那边也照此），
 * 否则「选了 MiMo 永远 401」而代码里找不出原因。
 * 没有密钥时**连头都不发**（本机端点常常不需要它），而不是发一个 `Bearer undefined`。
 */
export function authHeadersOf(target: ListTarget): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const key = target.key?.trim() ?? "";
  if (key === "") return headers;
  if (target.authHeader === "api-key") headers["api-key"] = key;
  else headers["Authorization"] = `Bearer ${key}`;
  return headers;
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
    return "密钥无效或没被授权拉取模型列表，在模型设置里核对这把密钥。";
  if (status === 404) return "这个 API 地址没有提供模型列表接口，可以在 Model ID 格里手填模型名。";
  return `拉取模型列表失败（HTTP ${status}）。`;
}

/**
 * 出网失败归类。
 *
 * **为什么要分类**（2026-10-06 真机实测）：`fetch` 抛出来的 `TypeError: fetch failed`
 * 底下压着一个 `cause.code`，不挖出来就只能一律报「连不上，可能是地址填错了」。
 * 实测那一轮地址**完全正确**、密钥也能用，真相是那台机器的 HTTPS 证书只签了 IP
 * （`ERR_TLS_CERT_ALTNAME_INVALID`）。旧文案把用户送去「改地址」——改一个没写错的地址，
 * 于是这件明明是服务端部署的问题，在界面上表现成「你填错了」，
 * 白白把人引到错误的方向上去（这一轮排查就是这么绕远的）。
 *
 * 归类做成**导出纯函数**而不是内联判断：① 单测能直接钉住每一种形状；
 * ② 体检通道（`agent-ipc` 的 `provider:verify`）走的是同一个 `list()`，天然共用这一份判定，
 * 不在第二条通道上再抄一遍（铁律 6）。
 */
export type NetworkFailure = "timeout" | "tls-cert" | "dns" | "refused" | "unreachable" | "generic";

/** Node/undici 的 TLS 错误码：证书对不上域名、自签、链不全、过期……对用户的动作是同一件（找服务方）。 */
const TLS_CODES = new Set([
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_GET_ISSUER_CERT",
  "ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED",
  "ERR_SSL_WRONG_VERSION_NUMBER"
]);

/** 域名问不出 IP：地址里的主机名可能写错了，也可能本机 DNS 有问题——这一类才值得让用户去看地址。 */
const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN"]);

/** 连上了但没人听：端口写错、或服务没起。 */
const REFUSED_CODES = new Set(["ECONNREFUSED"]);

/** 连到一半断了、或根本路由不到：网络层的问题，与地址拼写无关。 */
const UNREACHABLE_CODES = new Set([
  "ECONNRESET",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EHOSTDOWN"
]);

/** 逐层往下摸 code：`fetch` 把真因塞在 `cause` 上，测试桩与某些运行时只有顶层 `code`。 */
function codeChain(error: unknown): string[] {
  const codes: string[] = [];
  let cur: unknown = error;
  for (let depth = 0; depth < 4 && cur !== null && cur !== undefined; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string") codes.push(code);
    cur = (cur as { cause?: unknown }).cause;
  }
  return codes;
}

export function networkFailureOf(error: unknown): NetworkFailure {
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") return "timeout";
  const codes = codeChain(error);
  // 证书这一支要盖住 `ERR_TLS_*` 家族里还没列进来的形状：OpenSSL 偶尔会加新码，
  // 漏一个就退化成泛泛的「连不上」，正是这一版要消灭的那种误导。
  if (codes.some((code) => TLS_CODES.has(code) || code.startsWith("ERR_TLS_"))) return "tls-cert";
  if (codes.some((code) => DNS_CODES.has(code))) return "dns";
  if (codes.some((code) => REFUSED_CODES.has(code))) return "refused";
  if (codes.some((code) => UNREACHABLE_CODES.has(code))) return "unreachable";
  return "generic";
}

/** 网络错误不许把上游原文带过去：那句话里可能有 URL、代理配置，甚至用户贴错的密钥。 */
export function networkReason(error: unknown): string {
  switch (networkFailureOf(error)) {
    case "timeout":
      return "等这个 API 地址回话超时了。可能是网络不通，也可能是服务没起——稍后重试，或核对地址。";
    case "tls-cert":
      // 刻意**不提**「关掉证书校验」这类旁路：证书对不上就是不该连上，
      // 提示用户去关校验等于把一个安全后门交到手上。要修的是那台机器的证书部署。
      return (
        "这台机器的 HTTPS 证书对不上你填的域名（证书失效、自签，或只签了 IP 没签域名）。" +
        "这不是地址写错了，也不用改地址——是服务方的证书部署有问题，请让他们换一张能对上域名的证书。"
      );
    case "dns":
      return "这个域名解析不出 IP。检查地址里的主机名是否拼错，或本机 DNS 是否有问题。";
    case "refused":
      return "连上了那台机器但没人监听这个端口。确认服务已经启动、端口号没填错。";
    case "unreachable":
      return "连到一半断了，或这台机器在网络上不可达。检查本机网络、代理与防火墙。";
    case "generic":
      return "连不上这个 API 地址。可能是服务没起、地址填错了，或者网络到不了那台机器。";
  }
}

/**
 * 拉一次 `{baseURL}/models`。密钥只进请求头，绝不进 URL；没有密钥时连头都不发。
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
    async list(query?: ModelListQuery) {
      const draftURL = query?.baseURL?.trim() ?? "";
      // 进门先分清「按草稿试」与「按已存取」：
      // **添加模型时用户还没存过任何连接**，store 里必然一条连接都没有。
      // 那时若先查「有没有启用中的模型」就直接拒了，草稿拉名单根本没机会走到
      // （2026-10-06 单测当场抓住的回归：对话框首配流程直接失效）。
      const useDraft = query?.connectionId === undefined && draftURL !== "";
      let stored: ListTarget | null = null;
      try {
        // ① 指定了连接 ⇒ 就用那一条（体检与「按连接拉名单」都走这条）。
        if (query?.connectionId !== undefined) {
          const target = await deps.settings.connectionTarget(query.connectionId);
          if (target === null) return { ok: false, reason: "没有找到这条连接，可能已经被删除。" };
          stored = { baseURL: target.baseURL, key: target.key, authHeader: target.authHeader };
        } else if (!useDraft) {
          // ③ 什么都没给 ⇒ 走启用中那条（输入卡的「模型 ▾」浮层维持原判定）。
          const view = await deps.settings.view();
          const enabled = view.profiles.find((profile) => profile.enabled);
          const connectionId = enabled?.connectionId;
          if (connectionId === undefined) {
            return {
              ok: false,
              reason:
                view.profiles.length === 0
                  ? "还没有添加模型。先在模型设置里选一家供应商，填上地址与密钥。"
                  : "当前没有启用中的模型，先在模型设置里启用一个。"
            };
          }
          const target = await deps.settings.connectionTarget(connectionId);
          if (target === null)
            return { ok: false, reason: "启用中的模型找不到它那条连接，请重新添加一次。" };
          stored = { baseURL: target.baseURL, key: target.key, authHeader: target.authHeader };
        }
      } catch (error) {
        // provider-settings 抛的已经是中文单句（配置文件被占用 / 缺字段），原样收成理由。
        return { ok: false, reason: error instanceof Error ? error.message : networkReason(error) };
      }

      const target = resolveModelListTarget(stored, query);
      if (target.baseURL.trim() === "")
        return { ok: false, reason: "还没有配置 API 地址，先在模型设置里填好 baseURL。" };

      let response: Awaited<ReturnType<ModelListFetcher>>;
      try {
        response = await send(modelsUrlOf(target.baseURL), {
          method: "GET",
          headers: authHeadersOf(target),
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
