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
 * 与「模型上游连不上」是两个语义。URL 白名单因此只取 boolean 适配（判据真身在
 * `./upstream-url.ts`，与 `provider-fetch` 同一份，台账第七十三节把第六十八节记的
 * 「暂时豁免」归一了），本文件不再另写一份判据。
 */
import { judgeUpstreamUrl } from "./upstream-url.js";

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
  /**
   * 响应的**原始字节**（2026-10-15 pull 那一刀加的）。
   *
   * 为什么不能只有 text：pull 要把远程的件按字节落回本地，而 `Response.text()` 是按
   * UTF-8 解的——备份里的图片 / 字体等二进制件走 text 再 `TextEncoder` 编回来就被替换字符
   * 打烂了。真 fetch 两态都给（同一份 buffer 派生），夹具只给 text 时按 UTF-8 编码兜底
   * （夹具造的都是文本件，二进制在假 fetch 里不会出现）。
   */
  bytes?: Uint8Array;
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
  // 一次读完 buffer，再派生两态：pull 的 GET 要按字节原样落盘（`text()` 会把二进制件打烂），
  // PROPFIND 要文本。两态同源、只读一次网，不会因为「先读 text 再读 bytes」变成两次消费。
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { status: response.status, text: new TextDecoder().decode(bytes), bytes };
};

/**
 * WebDAV 出网地址白名单——判据真身在 `./upstream-url.ts`（与 `provider-fetch` 同一份），
 * 这里只留 boolean 适配形状：WebDAV 这一层只需知道「能不能出网」，不关心是「解析不出」
 * 还是「协议不合」（那是 provider-fetch 才要分两句的话）。
 */
export function isWebdavUrlAllowed(rawUrl: string): boolean {
  return judgeUpstreamUrl(rawUrl) === "ok";
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

/** PROPFIND 子项的一枚：`path` 是归一后的路径（与 extractHrefs 同一份口径），`isDir` 来自 `<resourcetype>`。 */
export interface WebdavPropfindEntry {
  path: string;
  isDir: boolean;
}

/**
 * 与 `extractHrefsFromPropfindXml` **同一份 XML、不同的输出面**：这一份多带「是不是目录」。
 *
 * 【为什么要多带这一位】
 * pull 是递归搬运：PROPFIND Depth:1 的响应里目录与文件是混在一起的，只有「是不是目录」
 * 能决定「再往里 PROPFIND」还是「GET 下来写盘」。光有路径的 `extractHrefsFromPropfindXml`
 * 判不出这一位（list 只需要路径，用那份），所以这里按 `<response>` 块切，块内再找 href 与 collection。
 *
 * 【`<resourcetype>` 里有没有 `<collection/>` 就是「是不是目录」的判据】
 * RFC 4918：目录的 `resourcetype` 含 `<collection/>`，普通文件是空的。
 * 自闭合 `<D:collection/>` 与成对 `<D:collection></D:collection>` 都认——所以判据写成
 * `<collection` 后面跟 `/`、`>` 或空白，而不是认死 `/>`。**不会误判**：href 文本里出现
 * `collection` 时它前面是 `/` 或别的字符，不满足「`<` 紧跟 collection」这一条。
 */
export function extractEntriesFromPropfindXml(
  xml: string,
  requestedUrl: string
): WebdavPropfindEntry[] {
  let selfPath: string | null;
  try {
    selfPath = new URL(requestedUrl).pathname.replace(/\/+$/, "");
  } catch {
    selfPath = null;
  }
  const blocks = /<(?:D:|d:)?response\b[^>]*>([\s\S]*?)<\/(?:D:|d:)?response>/g;
  const hrefRe = /<(?:D:|d:)?href>([^<]+)<\/(?:D:|d:)?href>/;
  const dirRe = /<(?:D:|d:)?collection[\s/>]/;
  const seen = new Set<string>();
  const result: WebdavPropfindEntry[] = [];
  let block: RegExpExecArray | null;
  while ((block = blocks.exec(xml)) !== null) {
    const body = block[1] ?? "";
    const hrefMatch = hrefRe.exec(body);
    if (hrefMatch === null) continue;
    const href = hrefMatch[1]!.trim();
    if (href === "") continue;
    let hrefPath: string;
    try {
      hrefPath = new URL(href, requestedUrl).pathname;
    } catch {
      hrefPath = href;
    }
    // 自身那条（请求目录自己）不算子项——与 extractHrefs 同一条过滤口径。
    if (selfPath !== null && hrefPath.replace(/\/+$/, "") === selfPath) continue;
    if (seen.has(hrefPath)) continue;
    seen.add(hrefPath);
    result.push({ path: hrefPath, isDir: dirRe.test(body) });
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
 * PROPFIND Depth: 1 的真请求，回原始 XML（或失败档）。**只有这一处构造 PROPFIND**：
 * list 与 pull 是两个输出面（路径 / 带目录位的项），但请求是同一条——
 * 分两份写就会出现「一边改了深度或 body、另一边没改」的那种分家。
 *
 * 207 是 PROPFIND 成功的标准状态码（Multi-Status）。404 表示资源不存在，按空 XML 回
 * （调用方各自把「空」解成「没有子项」/「没有这一份」）。
 */
async function propfindRaw(
  fetch: WebdavFetch,
  url: string,
  headers: Record<string, string>
): Promise<{ ok: true; xml: string } | { ok: false; status: number; message: string }> {
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
  if (response.status === 404) return { ok: true, xml: "" };
  if (response.status !== 207)
    return {
      ok: false,
      status: response.status,
      message: `PROPFIND 失败（HTTP ${response.status}）：${response.text.slice(0, 200)}`
    };
  return { ok: true, xml: response.text };
}

/** 列一层子项的**路径**（service 自己再 joinWebdavUrl）。list 用这一份。 */
export async function propfindChildren(
  fetch: WebdavFetch,
  url: string,
  headers: Record<string, string>
): Promise<{ ok: true; children: string[] } | { ok: false; status: number; message: string }> {
  const raw = await propfindRaw(fetch, url, headers);
  if (!raw.ok) return raw;
  return { ok: true, children: extractHrefsFromPropfindXml(raw.xml, url) };
}

/** 列一层子项的**项**（路径 + 是不是目录）。pull 递归搬运用这一份。 */
export async function propfindEntries(
  fetch: WebdavFetch,
  url: string,
  headers: Record<string, string>
): Promise<
  { ok: true; entries: WebdavPropfindEntry[] } | { ok: false; status: number; message: string }
> {
  const raw = await propfindRaw(fetch, url, headers);
  if (!raw.ok) return raw;
  return { ok: true, entries: extractEntriesFromPropfindXml(raw.xml, url) };
}

/**
 * GET 一个文件。200 才算拿到内容（不认 206 部分内容——备份里的件都是一次取完的整份）。
 *
 * 回的是**字节**而不是文本：备份里的图片 / 字体落回本地时必须原样。
 * 夹具只给 `text`（不给 `bytes`）时按 UTF-8 兜底编码——夹具造的都是文本件。
 */
export async function getFile(
  fetch: WebdavFetch,
  url: string,
  headers: Record<string, string>
): Promise<{ ok: true; data: Uint8Array } | { ok: false; status: number; message: string }> {
  let response: WebdavResponse;
  try {
    response = await fetch({ method: "GET", url, headers, body: null });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      message: `GET 请求失败：${error instanceof Error ? error.message : String(error)}`
    };
  }
  if (response.status !== 200)
    return {
      ok: false,
      status: response.status,
      message: `GET 失败（HTTP ${response.status}）：${response.text.slice(0, 200)}`
    };
  return { ok: true, data: response.bytes ?? new TextEncoder().encode(response.text) };
}
