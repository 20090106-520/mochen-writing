/**
 * 上游地址白名单的**唯一判据**（台账第七十三节）。
 *
 * 【为什么收成一份】`provider-fetch.ts` 与 `webdav-client.ts` 原先各写一份「https，
 * 或本机回环的 http」——同一份判据分两份写，改一处漏一处就是两套口径（铁律 6）。
 * 本模块把「解析 + 协议判」收在这里，两处只留各自对外的适配形状：
 * provider-fetch 要抛 `ProviderError`（模型上游），webdav-client 要一个 boolean（WebDAV 出网）。
 * 抽取前的取舍（第六十八节里记的「暂时豁免」）到此归一，两处不再各写一份。
 *
 * 【为什么返回三态而不是 boolean】两处对外的**话术**不同：provider-fetch 把「解析不出」
 * 与「协议不合」说成两句不同的话（一处怪地址本身、一处怪明文出网会把密钥裸送），
 * 压成 boolean 就把这份区分丢了。三态正是这条判据的真实粒度，适配层各取所需——
 * webdav-client 只要 `=== "ok"`，provider-fetch 按档给两句话。
 */
export type UpstreamUrlVerdict = "ok" | "not-a-url" | "not-allowed";

/**
 * 只放行 `https:`；`http:` 仅本机回环例外（ollama / LM Studio 都长在 127.0.0.1 上，
 * 本机流量不出网卡，谈不上「明文外送」）。解析不出的地址回 `not-a-url`，其余回 `not-allowed`。
 */
export function judgeUpstreamUrl(rawUrl: string): UpstreamUrlVerdict {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "not-a-url";
  }
  if (parsed.protocol === "https:") return "ok";
  // 回环名单四种写法：localhost 与 IPv4/IPv6 两种字面量（URL 会把 [::1] 的主机名解析成 ::1）。
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(parsed.hostname);
  if (parsed.protocol === "http:" && loopback) return "ok";
  return "not-allowed";
}
