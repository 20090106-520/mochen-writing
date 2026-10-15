/**
 * WebDAV 协议的最小纯函数层（2026-10-15）。
 *
 * 【为什么是纯函数 + 注入 fetch】
 * 与 `book-backup.ts` 的 `BackupFs` 同一条铁律：本体要防的失败是「某次请求抛错」与
 * 「PROPFIND XML 多回来一段」，真网络与真服务器在测试里复现不了；这里收的是
 * `WebdavFetch` 这只窄面，单测注入「按预设状态码回固定 body」的假 fetch 即可逐档钉。
 *
 * 【不依赖 electron、不依赖 agent-runtime】
 * electron 在这一层用不到（fetch 由 service 注入，主进程 `fetch` 与 `net.fetch` 都行）；
 * agent-runtime 的 `ProviderError` 也不该漏进来——WebDAV 出网错误对渲染层是「连不上」，
 * 与「模型上游连不上」是两个语义。所以 URL 白名单判据这里**就地复述一份**：
 * 与 `provider-fetch.ts:assertUpstreamUrlAllowed` 同口径（https 或本机回环 http），
 * 铁律 6 的暂时豁免理由见 `webdav-service.ts` 头注释，台账第六十八节记下这个取舍。
 */

/** 窄 fetch 面：service 注入真 fetch，单测注入「按 url / 方法回固定状态码与 body」。 */
export interface WebdavRequestInit {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Uint8Array | string | null;
}

export interface WebdavResponse {
  status: number;
  text: string;
}

export type WebdavFetch = (init: WebdavRequestInit) => Promise<WebdavResponse>;

/**
 * 把全局 `fetch` 适配成 `WebdavFetch`。主进程装配点用，单测不调它（注入自己的假 fetch）。
 *
 * body 为 null 时不传给真 fetch（GET / MKCOL / DELETE）；为 Uint8Array 时直接递。
 * signal 当前不在 `WebdavRequestInit` 里——push / list 一次性走完，没有「用户按 Esc 中断」这条需求
 * （与 `provider-fetch` 的用户打断不同——那边是流式问答、这边是一次性文件搬运）。
 */
export const nodeWebdavFetch: WebdavFetch = async (init) => {
  const response = await fetch(init.url, {
    method: init.method,
    headers: init.headers,
    // exactOptionalPropertyTypes：body 为 null 时不能写成 `body: null` 之外的「没传」，
    // 而裸 `body: undefined` 在 exactOptional 下会拒绝——`as BodyInit | null` 把联合类型
    // 收窄到 fetch 认识的那种，string / Uint8Array / null 三态都接得上。
    body: (init.body ?? null) as BodyInit | null
  });
  const text = await response.text();
  return { status: response.status, text };
};

/**
 * 上游 URL 白名单（与 `provider-fetch.ts:assertUpstreamUrlAllowed` 同口径）。
 *
 * 只放行 https；http 仅本机回环例外（与 ollama 同档理由：本机流量不出网卡）。
 * 这条判据**两处各写一份**——provider-fetch 那份抛 `ProviderError`，
 * 而 webdav-client 不应依赖 agent-runtime（包边界检查会红），所以这里返回 boolean。
 * 取舍记在台账第六十八节「判据暂未抽出」一节；下一刀抽到 `upstream-url.ts` 时两处一并归一。
 */
export function isWebdavUrlAllowed(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol === "https:") return true;
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(parsed.hostname);
  return parsed.protocol === "http:" && loopback;
}

/** `Authorization: Basic <base64>`。用户名 / 密码里有非 ASCII 时按 UTF-8 编码（RFC 7617）。 */
export function basicAuthHeader(username: string, password: string): string {
  const raw = `${username}:${password}`;
  // btoa 不接非 ASCII，先 UTF-8 编码再 base64。Buffer 是 node 主进程的标准件，不需要引库。
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

/**
 * 拼远程 URL：每段按 `/` 拆开后逐段 `encodeURIComponent`（保留 `/` 作为层级），
 * 再与 baseUrl 用单斜杠接起来。baseUrl 末尾的斜杠与段首的斜杠都被归一到一条。
 *
 * 中文文件名（`chapters/第一章.md`）走 `encodeURIComponent` 是 WebDAV 服务端的事实要求——
 * 坚果云 / Nextcloud 对裸中文字节在 URL 里行为不一，编码后所有服务器都认。
 */
export function joinWebdavUrl(baseUrl: string, ...segments: string[]): string {
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  const parts: string[] = [];
  for (const segment of segments) {
    for (const piece of segment.split("/")) {
      if (piece === "" || piece === ".") continue;
      parts.push(encodeURIComponent(piece));
    }
  }
  return `${trimmedBase}/${parts.join("/")}`;
}

/**
 * 从 PROPFIND 响应里提取子项 `<D:href>`（或 `d:` / 无前缀）。
 *
 * 【为什么用正则而不是 DOM】
 * 主进程没有 `DOMParser`，引 `fast-xml-parser` 是新依赖（违反硬约束）。
 * PROPFIND XML 形状在 RFC 4918 里固定：每条 `<D:response>` 里有一对 `<D:href>`，
 * 而我们只需要「子项的路径」这一项——不需要解析属性、不需要树形结构。
 * 正则提取在这一层足够，且能在不引库的前提下被单测逐字符钉。
 *
 * 【过滤自身】
 * PROPFIND Depth: 1 的响应里**包含自身那条** `<D:href>`，我们要的是它的子项，所以先解全部、
 * 再过滤掉「与请求路径归一后等价」的那一条。归一用 URL 解析后的 pathname 比，
 * 不直接比字面——服务端可能返回绝对 URL 也可能返回相对路径。
 */
export function extractHrefsFromPropfindXml(xml: string, requestedUrl: string): string[] {
  // 三种常见前缀：`<D:href>`、`<d:href>`、`<href>`。lazy `[^<]+` 取到下一个 `<` 为止。
  const re = /<(?:D:|d:)?href>([^<]+)<\/(?:D:|d:)?href>/g;
  const seen = new Set<string>();
  const all: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const href = match[1]!.trim();
    if (href === "") continue;
    all.push(href);
  }
  // 自身路径归一：解 URL 的 pathname；解不出来（服务端递相对路径）则按字面去首尾斜杠比。
  let selfPath: string | null;
  try {
    selfPath = new URL(requestedUrl).pathname.replace(/\/+$/, "");
  } catch {
    selfPath = null;
  }
  const result: string[] = [];
  for (const href of all) {
    let hrefPath: string;
    try {
      hrefPath = new URL(href, requestedUrl).pathname;
    } catch {
      hrefPath = href;
    }
    // 自身那条：pathname 与请求的 pathname 相等（去尾斜杠后）。
    if (selfPath !== null && hrefPath.replace(/\/+$/, "") === selfPath) continue;
    // 相对路径作为最终回执（service 会再 joinWebdavUrl 解成绝对路径）。
    if (!seen.has(hrefPath)) {
      seen.add(hrefPath);
      result.push(hrefPath);
    }
  }
  return result;
}

/** MKCOL：建目录。201 = 已建；405 = 已存在（多数 WebDAV 服务端如此回）；401/403 = 凭据/权限；其余 = 失败。 */
export async function mkcolDir(
  fetch: WebdavFetch,
  url: string,
  headers: Record<string, string>
): Promise<{ ok: true; existed: boolean } | { ok: false; status: number; message: string }> {
  let response: WebdavResponse;
  try {
    response = await fetch({ method: "MKCOL", url, headers, body: null });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      message: `MKCOL 请求失败：${error instanceof Error ? error.message : String(error)}`
    };
  }
  if (response.status === 201) return { ok: true, existed: false };
  if (response.status === 405) return { ok: true, existed: true };
  return {
    ok: false,
    status: response.status,
    message: `MKCOL 失败（HTTP ${response.status}）：${response.text.slice(0, 200)}`
  };
}

/** PUT：上传一个文件。200/201/204 都算成功（不同服务端选其一）。 */
export async function putFile(
  fetch: WebdavFetch,
  url: string,
  headers: Record<string, string>,
  body: Uint8Array
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  let response: WebdavResponse;
  try {
    response = await fetch({ method: "PUT", url, headers, body });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      message: `PUT 请求失败：${error instanceof Error ? error.message : String(error)}`
    };
  }
  if (response.status === 200 || response.status === 201 || response.status === 204)
    return { ok: true };
  return {
    ok: false,
    status: response.status,
    message: `PUT 失败（HTTP ${response.status}）：${response.text.slice(0, 200)}`
  };
}

/** DELETE：删一个资源（探活时删自己刚建的临时目录）。 */
export async function deleteResource(
  fetch: WebdavFetch,
  url: string,
  headers: Record<string, string>
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  let response: WebdavResponse;
  try {
    response = await fetch({ method: "DELETE", url, headers, body: null });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      message: `DELETE 请求失败：${error instanceof Error ? error.message : String(error)}`
    };
  }
  // 200/204 都算成功；404 在「探活删除」语义下也视为已清（服务端可能并发删了）。
  if (response.status === 200 || response.status === 204 || response.status === 404)
    return { ok: true };
  return {
    ok: false,
    status: response.status,
    message: `DELETE 失败（HTTP ${response.status}）：${response.text.slice(0, 200)}`
  };
}

/**
 * PROPFIND Depth: 1：列一层子项。返回子项的相对路径数组（service 自己再 joinWebdavUrl）。
 *
 * 207 是 PROPFIND 成功的标准状态码（Multi-Status）。405/404 表示资源不存在。
 */
export async function propfindChildren(
  fetch: WebdavFetch,
  url: string,
  headers: Record<string, string>
): Promise<{ ok: true; children: string[] } | { ok: false; status: number; message: string }> {
  let response: WebdavResponse;
  try {
    response = await fetch({
      method: "PROPFIND",
      url,
      headers: { ...headers, depth: "1" },
      body:
        '<?xml version="1.0" encoding="utf-8"?>' +
        '<D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>'
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      message: `PROPFIND 请求失败：${error instanceof Error ? error.message : String(error)}`
    };
  }
  if (response.status === 404) return { ok: true, children: [] };
  if (response.status !== 207)
    return {
      ok: false,
      status: response.status,
      message: `PROPFIND 失败（HTTP ${response.status}）：${response.text.slice(0, 200)}`
    };
  return { ok: true, children: extractHrefsFromPropfindXml(response.text, url) };
}
