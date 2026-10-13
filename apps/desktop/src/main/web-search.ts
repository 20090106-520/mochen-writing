/**
 * 免费联网搜索（无需 API key）：抓搜索页 HTML + 正则解析，主进程出网。
 * 只读工具：结果只回给模型看，一个字都不落盘——要保存由模型整理后走 write_doc（用户审批）。
 * fetchImpl 注入（测试给假实现）；真实出网只在主进程，渲染层碰不到网络。
 *
 * 源链（2026-10-06 批次 5-⑨）：原来只有 DuckDuckGo 一家。实测本机到 html.duckduckgo.com
 * 八秒超时，而这一层「免费联网搜索」从没在很多用户机器上成功过。单一数据源的搜索等于没有搜索，
 * 故改源链：DuckDuckGo 在前（本来就通的人不受影响），360 搜索兜底，回执里如实说这一条是谁答的。
 *
 * 必应 cn.bing.com 当初是被否掉的（5-⑨），**理由后来被推翻**（5-⑬），这里记清楚为什么：
 *   它对没有现成强匹配的中文 query 只认**第一个词**，整个结果页塌成首字的词典条目——
 *   「刘慈欣三体黑暗森林的设定是什么」返回十条「刘（汉语汉字）」，「罗辑黑暗森林」塌成「罗」。
 *   状态码 200、十条结果、条条有标题有链接，看起来完全正常，但没有一句跟问题有关。
 *   当时据「活着 余华准、余华 活着 小说就塌」断定「没有静态规则、故不接」——**那句是错的**：
 *   边界清清楚楚（≤6 字连续名词短语、或 ≤2 个空格分隔词 ⇒ 可用；≥7 字连续或以疑问词开头 ⇒ 塌），
 *   加引号无效、而空格反而有用（它是切词边界）。
 *   真正拿不到的是**改写规则**：把长问句压成关键词，四种候选（去疑问词/截 6 字/截 8 字/取首分句）
 *   全废——盲截断对「民国军阀混战」有效，对「科幻小说常见的世界观设定有哪些」就剩半截话。
 *   所以最终改成：不改写 query，让模型自己发关键词；结果进来先过 `bingCoverage` 质量闸门，
 *   塌了**如实说没搜着**。内容层面的错比搜不到危险得多——宁可空手，不递词典条目。
 */

import { sourceKey } from "@mochen/contracts";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** 一轮搜索的完整回执：除了结果，还得说清「谁答的、试了几个」。 */
export interface WebSearchOutcome {
  /** 答上这一轮的那个源（如 "so-360"）。 */
  sourceId: string;
  /** 源的中文名，回执里写给用户看。 */
  sourceLabel: string;
  results: WebSearchResult[];
  /** 实打实试了几个源才拿到结果：1 = 首选源直接通了。 */
  attempted: number;
  /** 因为在冷却里而整轮跳过的源（id）；没有就是空数组。 */
  skipped: string[];
  /** 这一轮剔掉了几条「上一次搜索已经递过」的重复结果；没有就是 0。 */
  deduped: number;
}

/**
 * 单源的一次尝试。预期内的失败不抛异常——抛了就没法区分「连不上」「被频控」「这页没结果」，
 * 而这三种对源链的处置完全不同（前两种进冷却，第三种不）。
 */
export type SourceAttempt =
  | { ok: true; results: WebSearchResult[] }
  | {
      ok: false;
      /** network=连不上；unavailable=连上了但不让我们用（频控/403）；empty=页面正常但没结果。 */
      reason: "network" | "unavailable" | "empty";
      message: string;
      /**
       * empty 时可选的一句「为什么没搜着」，比 message 更贴近**用户下一次该怎么做**。
       *
       * 为什么单独开一个字段而不是直接用 message：`message` 在 empty 这一档是给内部看的
       * （「页面上没解析出结果」这种），而全链落空时拼出来的那句是给用户看的。
       * 源链要挑一句透出来，就必须能**分得出哪句值得透**——按字符串比对其余源的话，
       * 「页面上没解析出结果」就成了散在两处、第二份真身的魔法串。
       */
      hint?: string;
    };

/** 回执上限：只回前 10 条，防搜索页灌爆模型上下文。 */
export const WEB_SEARCH_RESULTS_LIMIT = 10;

/** 单条摘要上限：搜索页摘要动辄两三百字，十条就是三千字，够把一轮上下文吃掉一大半。 */
export const WEB_SEARCH_SNIPPET_LIMIT = 220;

/** 单源超时：源链最多试两个源，超时太长用户会以为程序死了。 */
export const WEB_SEARCH_SOURCE_TIMEOUT_MS = 6000;

/**
 * 冷却的基础时长。**不是实测出来的恢复窗口**：2026-10-06 在本机连发 5 次搜索后触发频控，
 * 之后每 3 分钟探一次、探到 23 分钟仍未恢复，恢复窗口没测出来，只能说「至少二十多分钟」。
 *
 * 真正管用的是**按连续失败翻倍**（见 `coolDown`）：固定的十分钟本来就短于实测窗口，
 * 改成指数退避之后就不必事先知道窗口有多长——撞得越狠等得越久，直到源真的答上一次。
 */
export const SOURCE_COOLDOWN_MS = 10 * 60 * 1000;

/** 翻倍的封顶：再往上等下去，用户早就去干别的了，等着不如重新开一轮。 */
export const SOURCE_COOLDOWN_MAX_MS = 60 * 60 * 1000;

/**
 * 跨搜索判重的记忆窗口（2026-10-06 批次 5-⑩）。
 *
 * 模型第一轮搜不准时会换几个词再搜一次，而搜索站在同主题上递回来的页面**高度重叠**
 * （实测两次回执里三条有两条是同一页面）。不去重的话模型看到五个编号、实际只有三个页面，
 * 还容易写成「多方来源印证」——那是把一条资料数成两条，不抛不报。
 *
 * 只在十分钟内有效：重搜几乎都发生在同一件事的几分钟内；隔更久再搜同一个问题多半是
 * 真有新问题，把老结果判成「重复」会让第二次搜索空手而归——那比重复更糟。
 */
export const SOURCE_DEDUP_TTL_MS = 10 * 60 * 1000;

export type WebFetchLike = (
  url: string,
  init?: { method?: string; body?: string; headers?: Record<string, string>; signal?: AbortSignal }
) => Promise<Response>;

export interface WebSearchSource {
  id: string;
  label: string;
  run(query: string, fetchImpl: WebFetchLike): Promise<SourceAttempt>;
}

const BROWSER_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8"
};

/** HTML 实体反解（摘要里常见的那几类 + 数字实体交给浏览器式解码兜底）。 */
function decodeEntities(input: string): string {
  return (
    input
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      // &amp; 必须最后解：正文里本来就有 & 时，先解它会把 &lt; 变成真尖括号。
      .replace(/&amp;/g, "&")
  );
}

/** 剥掉片段里残留的内层标签（<b>高亮</b> 之类）并压掉多余空白。 */
function stripTags(input: string): string {
  return decodeEntities(input.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 摘要清洗：搜索页在摘要里塞分隔符和截断尾巴，这些原样进模型上下文既是噪音也是错信息——
 * 行尾的「 …」会被读成原文本来就有的省略。
 */
function cleanSnippet(text: string): string {
  return (
    stripTags(text)
      // &#0183; 是私用区码位（必应拿它当项目符号），实体解码表里没有，按数字实体清掉。
      .replace(/&#0*183;/g, " ")
      .replace(/&ensp;|&emsp;|&thinsp;/g, " ")
      .replace(/\s*[·•]\s*/g, " ")
      .replace(/\s*(?:…|\.\.\.)\s*$/, "")
      .trim()
  );
}

/** 从标签的属性串里取值，单双引号都认；**与属性书写顺序无关**。 */
function attr(tag: string, name: string): string {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const m = tag.match(re);
  return m?.[2] ?? m?.[3] ?? "";
}

/**
 * 摘要按长度截断，末尾补省略号（截断与否要能看出来，别让半句话假装是完整摘要）。
 * 断点落在标点或空白上，断得自然一点；实在没有标点才按字数硬切。
 */
function truncateSnippet(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = text.slice(0, limit);
  const cut = Math.max(head.lastIndexOf("，"), head.lastIndexOf("、"), head.lastIndexOf(" "));
  return `${(cut > limit * 0.6 ? head.slice(0, cut) : head).trimEnd()}…`;
}

/**
 * 比标题用的键：去掉全部空白与标点，只留字。用途有两个——去重，以及判「这条标题是不是就是问题本身」。
 *
 * 去重不能只去空白：真页面上同一条结果会写成「黑暗森林法则是什么?」与「黑暗森林法则是什么」，
 * 差一个全角问号就绕过了去重，于是两条几乎一样的东西各占一个结果位。
 */
export function titleEchoKey(title: string): string {
  return title.replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
}

/** 同一条结果去重 + 摘要截断 + 截条数。各源共用这一份，所以口径不会一个源一个样。 */
export function normalizeResults(
  raw: WebSearchResult[],
  limit = WEB_SEARCH_RESULTS_LIMIT
): WebSearchResult[] {
  const byUrl = new Set<string>();
  const byTitle = new Set<string>();
  const out: WebSearchResult[] = [];
  for (const item of raw) {
    if (item.title === "" || !/^https?:\/\//.test(item.url)) continue;
    // 去重键：归一化掉跟踪参数（搜索源会给同一条结果带 ?form= / &sp=-1 这类），并去掉 # 锚点。
    const urlKey = (item.url.split("#")[0] ?? item.url).replace(
      /[?&](form|sp|sr_share|ved|usg)=[^&]*/g,
      ""
    );
    const titleKey = titleEchoKey(item.title);
    if (byUrl.has(urlKey) || byTitle.has(titleKey)) continue;
    byUrl.add(urlKey);
    byTitle.add(titleKey);
    out.push({
      title: item.title,
      url: item.url,
      snippet: truncateSnippet(item.snippet, WEB_SEARCH_SNIPPET_LIMIT)
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** fetch 把底层错误包成 message = "fetch failed"；这里翻成人话。 */
function networkMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") return "连接超时";
  return "连不上";
}

/** 起一个带超时的 fetch：AbortSignal 让「一直挂着」变成一次有界的失败。 */
async function timedFetch(
  fetchImpl: WebFetchLike,
  url: string,
  init: { method?: string; body?: string; headers?: Record<string, string> },
  timeoutMs: number
): Promise<Response> {
  return fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

/** 非 2xx 的归类：403 是「不让我们用」，其余归「连不上」。 */
function httpFailure(status: number): SourceAttempt {
  return status === 403
    ? { ok: false, reason: "unavailable", message: `返回 ${status}` }
    : { ok: false, reason: "network", message: `返回 ${status}` };
}

/* ── DuckDuckGo ───────────────────────────────────────────────────────────── */

/** DDG 的跳转链接是 /l/?uddg=<encodeURIComponent(真实 url)>；解不进来就原样返回。 */
function unwrapDdgHref(href: string): string {
  const raw = decodeEntities(href);
  const at = raw.indexOf("uddg=");
  if (at === -1) return raw.startsWith("//") ? `https:${raw}` : raw;
  try {
    return decodeURIComponent(raw.slice(at + 5).split("&")[0] ?? raw);
  } catch {
    return raw;
  }
}

/**
 * 逐条扫 `<a class="result__a">`，摘要**在相邻两条之间的窗口里**找，绝不按下标全局配对。
 *
 * 旧写法是两条扁平正则各扫全文、再用 `snippets[index]` 对齐：只要有一条结果没有摘要，
 * 后面每一条的摘要就整体错位一格——把 B 的内容记成 A 的来源。对一个靠来源吃饭的写作工具，
 * 这是把错的东西当真东西喂给模型，比搜不到更糟。
 */
export function parseDuckDuckGoHtml(html: string): WebSearchResult[] {
  // 一趟扫出两类锚点：标题锚点（带 start/end，摘要窗口靠它算）与摘要锚点（带 start）。
  const anchors: { url: string; title: string; start: number; end: number }[] = [];
  const snippets: { start: number; text: string }[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
    const tag = match[1] ?? "";
    const cls = attr(tag, "class");
    const start = match.index ?? 0;
    if (/(^|\s)result__a(\s|$)/.test(cls)) {
      anchors.push({
        url: unwrapDdgHref(attr(tag, "href")),
        title: stripTags(match[2] ?? ""),
        start,
        end: start + match[0].length
      });
    } else if (/(^|\s)result__snippet(\s|$)/.test(cls)) {
      snippets.push({ start, text: cleanSnippet(match[2] ?? "") });
    }
  }
  const results: WebSearchResult[] = [];
  for (const [index, anchor] of anchors.entries()) {
    // 窗口 = 本条结束处 → 下一条**开始**处。窗口里没有摘要就是没有摘要，
    // 绝不去借下一条的（那是把别人的话记到自己名下）。
    const next = anchors[index + 1];
    const windowEnd = next === undefined ? Number.POSITIVE_INFINITY : next.start;
    const hit = snippets.find((s) => s.start >= anchor.end && s.start < windowEnd);
    results.push({ title: anchor.title, url: anchor.url, snippet: hit?.text ?? "" });
  }
  return normalizeResults(results);
}

export const duckduckgoSource: WebSearchSource = {
  id: "duckduckgo",
  label: "DuckDuckGo",
  async run(query, fetchImpl) {
    // POST 表单而不是 GET：DDG 对 GET 查询串的风控更紧；UA 要像浏览器，否则直接 403。
    //
    // **读 body 必须在 try 里面**（2026-10-10 修）：`timedFetch` 的 `AbortSignal.timeout`
    // 确实管得到 `response.text()`（本地服务实测：发完 header 就把 body 卡住，它在 6s 处以
    // AbortError 收场）。原先 `await response.text()` 写在 catch 之外，于是那次超时**以抛异常的形式
    // 逃出源**——源不再返回失败回执，下游拿到的就是一个裸 AbortError。
    let html: string;
    try {
      const response = await timedFetch(
        fetchImpl,
        "https://html.duckduckgo.com/html/",
        {
          method: "POST",
          body: new URLSearchParams({ q: query }).toString(),
          headers: { ...BROWSER_HEADERS, "content-type": "application/x-www-form-urlencoded" }
        },
        WEB_SEARCH_SOURCE_TIMEOUT_MS
      );
      if (!response.ok) return httpFailure(response.status);
      html = await response.text();
    } catch (error) {
      return { ok: false, reason: "network", message: networkMessage(error) };
    }
    const results = parseDuckDuckGoHtml(html);
    if (results.length === 0) return { ok: false, reason: "empty", message: "页面上没解析出结果" };
    return { ok: true, results };
  }
};

/* ── 360 搜索 ─────────────────────────────────────────────────────────────── */

/**
 * 360 触发频控时回的是 200 + 一个 6472 字节的「访问异常页面」，不是 4xx。
 * 不认这一页就会把它当成「搜了但没结果」，于是每轮都去重试、每轮都被挡。
 */
export function isThrottled360Page(html: string): boolean {
  return html.length < 20000 && /访问异常|antispider/i.test(html);
}

/**
 * 按 `class="res-list"` 切块，块内配对标题与摘要。
 *
 * 抓法与结构照着 2026-10-06 在本机对 www.so.com 的真实响应写的：每条一个 res-list，
 * 标题在 `<h3 class="res-title"><a href>`，摘要在 `<p class="res-desc">`。
 * 实测**七条里常常只有三四条带摘要**——正好是「缺摘要不许借下一条」这条判据的用武之地。
 *
 * 多数结果的链接是 `https://www.so.com/link?m=…` 跳转链（参数是不透明串，解不出目标地址）。
 * 本仓不猜它的编码：原样留着，点开照样到目标页——比解码错了把人送去别的页面强。
 */
export function parseSo360Html(html: string): WebSearchResult[] {
  // 容器只认 `class="res-list"` 整块。**不能**写成 `class="res-list` 就切：
  // 真页面上摘要的外层是 `<span class="res-list-summary">`，会被当成新容器切开，
  // 于是每个 res-list 都只剩到摘要之前——标题还在、摘要全丢，而且不报错（2026-10-06 夹具逮到）。
  const starts = [...html.matchAll(/class="res-list(?![-\w])/g)].map((match) => match.index ?? 0);
  const results: WebSearchResult[] = [];
  for (const [index, start] of starts.entries()) {
    const block = html.slice(start, starts[index + 1] ?? html.length);
    const heading = block.match(/<h3\b[\s\S]*?<\/h3>/i);
    const link = heading?.[0].match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
    if (link === null || link === undefined) continue;
    const url = decodeEntities(attr(link[1] ?? "", "href"));
    const title = stripTags(link[2] ?? "");
    // 摘要把内层 <a>（「详情>>」和一堆相关词条）先摘掉，否则 URL 会混进摘要里。
    const snippet = block.match(/<p class="res-desc"[^>]*>([\s\S]*?)<\/p>/i);
    results.push({
      title,
      url,
      snippet:
        snippet === null ? "" : cleanSnippet((snippet[1] ?? "").replace(/<a\b[\s\S]*?<\/a>/gi, ""))
    });
  }
  return normalizeResults(results);
}

/**
 * 360 页面上有几类卡**根本不是内容页**，点开只是把你送回 360 的另一个搜索/AI/视频入口
 * （2026-10-06 真机端到端逮到：搜「黑暗森林法则是什么」时，六条里两条是这种）：
 *   ① 标题就是把问题原样回显的「问题卡」（`黑暗森林法则是什么?`）；
 *   ② 链接落在 360 自己的搜索/AI 端点上（`ai.so.com/search/…`、`www.so.com/s?…`）；
 *   ③ 「短视频大全 / 高清在线观看」这类**聚合落地页**——它是个片库入口，不是一篇文章。
 *
 * 它们不是「相关性差」，是**根本不是来源**：占着结果位、把用户点进另一个页面，
 * 还让模型以为那就是出处。
 *
 * 判据收在 360 这一侧而不是共用的归一里：**360 的噪音只有 360 自己知道**，
 * 别的源有没有同类卡没量过，就不替它们先写一份。共用层只管去重/截断/截条数。
 */
const SO360_SELF_HOSTS = ["ai.so.com", "so.com", "m.so.com"];
const SO360_SELF_PATHS = /^\/(search|ai\/|video|short|s\?)/;
/** 聚合落地页的标题标记：片库/资源站入口，对一个写作工具没有可引用的内容。 */
const LANDING_CARD_MARKERS = [
  "短视频大全",
  "视频大全",
  "高清在线观看",
  "在线观看",
  "电影大全",
  "全集在线"
];

export function isSo360NoiseCard(result: WebSearchResult, query: string): boolean {
  const echo = titleEchoKey(result.title);
  if (echo !== "" && echo === titleEchoKey(query)) return true;
  if (LANDING_CARD_MARKERS.some((marker) => result.title.includes(marker))) return true;
  let url: URL;
  try {
    url = new URL(result.url);
  } catch {
    return false;
  }
  // 主机名比对前先把 www. 摘掉：360 自己就用 www.so.com 递跳转链，不摘就漏掉一半。
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!SO360_SELF_HOSTS.includes(host)) return false;
  // 360 自己的百科/文库站是有内容的，只有落回搜索结果页/AI 页的才算噪音。
  return SO360_SELF_PATHS.test(url.pathname + url.search);
}

export const so360Source: WebSearchSource = {
  id: "so-360",
  label: "360 搜索",
  async run(query, fetchImpl) {
    // 读 body 同样在 try 里（理由见 DuckDuckGo 那一段的注释：超时会以 AbortError 抛出，
    // 写在 catch 之外的话源会抛异常而不是返回失败回执）。
    let html: string;
    try {
      const response = await timedFetch(
        fetchImpl,
        `https://www.so.com/s?q=${encodeURIComponent(query)}`,
        { method: "GET", headers: { ...BROWSER_HEADERS, referer: "https://www.so.com/" } },
        WEB_SEARCH_SOURCE_TIMEOUT_MS
      );
      if (!response.ok) return httpFailure(response.status);
      html = await response.text();
    } catch (error) {
      return { ok: false, reason: "network", message: networkMessage(error) };
    }
    if (isThrottled360Page(html))
      return { ok: false, reason: "unavailable", message: "触发了访问频控" };
    const results = parseSo360Html(html).filter((r) => !isSo360NoiseCard(r, query));
    if (results.length === 0) return { ok: false, reason: "empty", message: "页面上没解析出结果" };
    return { ok: true, results };
  }
};

/* ── 必应（2026-10-06 批次 5-⑬） ──────────────────────────────────────────── */

/**
 * cn.bing.com 会**把查询拆开、只拿拆出来的头一个词去搜**，于是整个结果页塌成那个词的字义条目。
 * 「怎么写一个让读者害怕的反转」十条全是「怎么（汉语词语）_百度百科」，
 * 「罗辑黑暗森林」塌成「罗（汉语文字）」，「黑暗森林法则是怎」塌成「黑暗（汉语词汇）」。
 * 这是**内容层面**的错：状态码 200、十条结果、条条有标题有链接，看着完全正常，没有一句跟问题有关。
 *
 * **这条退化没有可靠的静态预测器。** 前后量过三轮，每一轮都推翻了上一轮的结论：
 *   · 5-⑨：看着「活着 余华」准、「余华 活着 小说」就塌，判「不可预测、故不接」；
 *   · 5-⑫：以为找到了边界（≤6 字连续词、或 ≤2 个空格分隔词）——**错的**：
 *     同为两个词，「三体 黑暗森林」10/10 而「黑暗森林法则 详细解释」22%；
 *   · 5-⑬：又以为是总字数（≤6 好、≥7 塌）——**也是错的**：
 *     「徽派建筑的特点是什么」10 字 67% 放行，「黑暗森林法则是怎」8 字 14% 全塌。
 * 真正起作用的像是**拆词拆出的头一个词有多高频**（黑暗/三/罗/怎/什么 → 字典条目压倒一切；
 * 徽派建筑/漕运 → 不拆散，照常有专页）。这条规律没有可执行的判据，所以不做预测。
 *
 * 于是改成两件事：
 *   ① 工具描述与系统提示词要求模型用关键词发 query（LLM 抽关键词比正则可靠得多）；
 *   ② 结果进来先过 `bingCoverage` 闸门，塌了就**如实说没搜着**，不把词典条目当来源递出去。
 * 「不预测、只测量」正是这里唯一站得住的做法，也是 5-⑩ 那条原则的直接落地：
 * 内容层面的错比搜不到危险得多——宁可空手，不递词典条目。
 */
export function parseBingHtml(html: string): WebSearchResult[] {
  // 必应的每条结果整块包在 class="b_algo" 里；标题是块内 h2 的 a，摘要是块内 b_caption 的 p。
  // 按块切而不是扫全页 <a>：全页扫会把导航、搜索框、建议词一起收进来（实测踩过）。
  const marks = [...html.matchAll(/class="b_algo/g)].map((match) => match.index ?? 0);
  const results: WebSearchResult[] = [];
  for (const [index, start] of marks.entries()) {
    const block = html.slice(start, marks[index + 1] ?? html.length);
    const head = block.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const url = head?.[1] ?? "";
    const title = stripTags(head?.[2] ?? "");
    if (url === "" || title === "") continue;
    const snippet = stripTags(
      block.match(/<p class="b_(?:lineclamp\d+|paractl)[^"]*"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? ""
    );
    results.push({
      title,
      url,
      snippet: truncateSnippet(cleanSnippet(snippet), WEB_SEARCH_SNIPPET_LIMIT)
    });
  }
  return normalizeResults(results);
}

/**
 * 质量闸门用的覆盖率：query 的相邻二字组，有多大比例出现在前十条结果标题里。
 *
 * 为什么是它：它**只读 query 原文和引擎给的标题**，不碰任何整形逻辑——
 * 用自己写的规则去判自己写的规则，就是「探针与被测代码同错」的又一例。
 * 也不用「期望词列表」那种判法（上一轮就是这么被骗的：把「读者」放进期望词，
 * 于是《读者》杂志被判成 10/10 命中）。
 *
 * 实测分布（`p545`，18 条，同内容逐字加长 + 不同内容各形态，闸门就是照这张表定的）：
 *   首条对题的：100 / 100 / 100 / 100 / 83 / 67 / 33 / 30 %
 *   塌成词典的：22 / 14 / 14 / 11 / 10 / 8 / 0 / 0 / 0 %
 * 分界落在 22 与 30 之间，取 0.3。
 *
 * 取 0.3 而不是中点，是因为**两边代价不对称**：误杀一个好结果，用户看到的是「换个说法再搜」，
 * 顶多少搜一次；放过一个塌方，模型会把「黑暗（汉语词汇）」当资料写进小说。
 * 宁可空手，不递错货——所以贴着「对题」那一侧的边走，塌方那一侧多留一截余量。
 */
export const BING_MIN_COVERAGE = 0.3;

export function bingCoverage(query: string, titles: readonly string[]): number {
  const q = stripTags(query).replace(/[\s，,。？?！!、：:；;（）()「」【】]/g, "");
  if (q.length < 2) return 1;
  const hay = titles.join("").replace(/\s+/g, "");
  let hit = 0;
  let total = 0;
  for (let i = 0; i + 2 <= q.length; i += 1) {
    total += 1;
    if (hay.includes(q.slice(i, i + 2))) hit += 1;
  }
  return total === 0 ? 1 : hit / total;
}

export const bingSource: WebSearchSource = {
  id: "bing-cn",
  label: "必应",
  async run(query, fetchImpl) {
    // 读 body 同样在 try 里（理由见 DuckDuckGo 那一段的注释）。
    let html: string;
    try {
      const response = await timedFetch(
        fetchImpl,
        `https://cn.bing.com/search?q=${encodeURIComponent(query)}`,
        { method: "GET", headers: { ...BROWSER_HEADERS, referer: "https://cn.bing.com/" } },
        WEB_SEARCH_SOURCE_TIMEOUT_MS
      );
      if (!response.ok) return httpFailure(response.status);
      html = await response.text();
    } catch (error) {
      return { ok: false, reason: "network", message: networkMessage(error) };
    }
    const results = parseBingHtml(html);
    if (results.length === 0) return { ok: false, reason: "empty", message: "页面上没解析出结果" };
    const coverage = bingCoverage(
      query,
      results.map((r) => r.title)
    );
    if (coverage < BING_MIN_COVERAGE)
      return {
        ok: false,
        reason: "empty",
        message: "页面上没解析出结果",
        // 塌方要跟「这话题确实没资料」分开说：后者会让模型换个话题重试，
        // 而这里真正该做的是把整句换成关键词——那句话不透出去，模型就学不会。
        //
        // 只陈述**观察到的**（结果里几乎没有你的字），不断言机制：
        // 「源只认开头的词」这句话量下来是**错的**（「徽派建筑的特点是什么」10 字照样好使），
        // 把推翻过的机制写进给模型看的提示，等于教它一个假因果。
        hint: `搜到的 ${results.length} 条几乎都不含「${query}」里的字——这条查询被拆成了词义查询。换个说法：压成 2–4 个关键词再搜一次`
      };
    return { ok: true, results };
  }
};

/** 源链顺序即优先级：DuckDuckGo 在前（本来就通的人不受影响），必应次之，360 兜底。 */
export const WEB_SEARCH_SOURCES: readonly WebSearchSource[] = [
  duckduckgoSource,
  bingSource,
  so360Source
];

/* ── 源链 ─────────────────────────────────────────────────────────────────── */

/** 冷却表：源 id → 到期时刻。见 SOURCE_COOLDOWN_MS 的注释：哪几种失败才进、多长。 */
const cooldownUntil = new Map<string, number>();
/** 连续失败次数：源 id → 次数。答上一次就清零，没答上就翻倍（见 `coolDown`）。 */
const consecutiveFailures = new Map<string, number>();
/** 紧邻上一次搜索递过的来源键 + 那次的时刻（见 SOURCE_DEDUP_TTL_MS）。 */
let lastServed: { keys: Set<string>; at: number } | null = null;

/**
 * 测试与探针用：清空模块级状态（冷却表、失败计数、判重记忆）。
 * 不给复位口子的话，同进程里下一条用例会被上一条污染——尤其是判重记忆，
 * 它会让「第二次搜索」在每条用例里都自动发生。
 */
export function resetWebSearchState(): void {
  cooldownUntil.clear();
  consecutiveFailures.clear();
  lastServed = null;
}

export interface WebSearchOptions {
  sources?: readonly WebSearchSource[];
  fetchImpl: WebFetchLike;
  /** 注入时钟；不传用 Date.now。冷却判据需要它可测。 */
  now?: () => number;
}

/**
 * 源链唯一会抛的错误类型。
 *
 * `kind` 分两种，因为它们对模型的下一步动作完全不同，合成一句话等于把两种建议搅在一起：
 *   unavailable —— 源坏了/被拒/在冷却：等一会儿或换个源，不要重复同一个词硬试；
 *   empty       —— 源都好好的，只是这个说法没搜着东西：换关键词才有意义。
 *
 * 调用方**必须**按这个类型分流：catch 到别的东西就说明有人在源链外面 new 了一个
 * 带英文 message 的 Error，那种必须挡掉而不是直接透给用户。
 */
export class WebSearchError extends Error {
  constructor(
    message: string,
    readonly kind: "unavailable" | "empty"
  ) {
    super(message);
    this.name = "WebSearchError";
  }
}

/**
 * 回执里显示的链接上限。360 给的多数是 `so.com/link?m=…` 这种不透明跳转链，
 * 实测单条能到 **450 字符**——原样进回执就是六行乱码，而且六个结果里光这些就吃掉
 * 两千多字符的模型上下文，全是没有任何信息的 base64。
 *
 * 完整地址**不丢**：它一路带在 `sources` 里，界面上点一下就是完整那条。
 * 回执里截到 `WEB_SEARCH_URL_LIMIT` 并标一句「跳转链」，够人认出是哪一家。
 */
export const WEB_SEARCH_URL_LIMIT = 96;

function displayUrl(url: string): string {
  if (url.length <= WEB_SEARCH_URL_LIMIT) return url;
  const head = url.slice(0, WEB_SEARCH_URL_LIMIT);
  // 截在分隔符上，别把一条链接切成两半还看不出它是什么。
  const cut = Math.max(head.lastIndexOf("/"), head.lastIndexOf("?"));
  return `${cut > WEB_SEARCH_URL_LIMIT * 0.6 ? head.slice(0, cut) : head}…（跳转链，界面里可点开）`;
}

/**
 * 回执排版（给模型读的那份）。放在这里而不是 host 里：排版口径跟来源是同一件事。
 *
 * 编号用**来源键**而不是序号（批次 5-⑩）：一轮里模型可能换词重搜好几次，两张回执各自
 * 从 [1] 数起就会让模型写出的「据来源[2]」指代不明——它不知道说的是哪一张回执里的第 2 条。
 * 键是链接的固定身份，同一条结果两次搜索拿到同一个键，不同结果必得不同的键，
 * 引用与顺序无关。键与工具卡上显示的是同一个（两边都调 contracts 的 sourceKey）。
 */
export function webSearchReceipt(outcome: WebSearchOutcome): string {
  const head =
    outcome.attempted === 1
      ? `来源：${outcome.sourceLabel}`
      : `来源：${outcome.sourceLabel}（试了 ${outcome.attempted} 个源，前面几个用不了）`;
  const deduped =
    outcome.deduped === 0 ? "" : `（本次有 ${outcome.deduped} 条与上一次搜索重复，已略去）`;
  const lines = outcome.results.map(
    (r) =>
      `[${sourceKey(r.url)}] ${r.title}\n     ${displayUrl(r.url)}${r.snippet === "" ? "" : `\n     ${r.snippet}`}`
  );
  return (
    `${head}${deduped}\n${lines.join("\n")}\n\n` +
    // 这句每张回执都要带（模型只看得到自己眼前这张），所以越短越好：
    // 只留三件模型必须知道的事——按什么引用、为什么不许写序号、跳转链怎么核对。
    // 页脚里**不放举例的键**：编一个出来模型会当真去引，而界面上并不存在那一条。
    "引用时带上方括号里的来源键，别用序号——同一轮里可能连着搜好几次，序号会撞车。" +
    "部分链接是搜索站的跳转链，界面上可按来源键点开核对。"
  );
}

/**
 * 源链主入口：按序试，网络类/被拒类失败的源进冷却，全挂了才抛——抛的是一句中文，
 * 不含任何 Node 的 `fetch failed` 之类英文技术串（用户看得懂「连不上」，看不懂 failed）。
 *
 * 判重（`serveResults`）刻意放在**源链跑完之后**而不是每个源答上时：
 * 放在里面的话，头一个源递回来的全是重复项就会直接短路，后面那个源根本没机会答，
 * 于是「这次没搜到新东西」会被误报成「搜索源用不了」。
 */
export async function webSearch(
  query: string,
  options: WebSearchOptions
): Promise<WebSearchOutcome> {
  const outcome = await runSourceChain(query, options);
  const served = serveResults(outcome.results, (options.now ?? Date.now)());
  // 一条不剩 = 全是刚递过的。措辞必须说清这是「重复」而不是「没搜到」：
  // 两者的下一步动作不同（换个更具体的词 vs 换一批词），混成一句模型就会原地打转。
  if (served.fresh.length === 0)
    throw new WebSearchError(
      `上一次搜索已经递过同样的 ${served.deduped} 条结果，没有新的可看——换个更具体的关键词再搜一次，或直接用上一轮的来源。`,
      "empty"
    );
  return { ...outcome, results: served.fresh, deduped: served.deduped };
}

/**
 * 跨搜索判重（批次 5-⑩）：剔掉上一次搜索已经递过的链接，并把本轮全部键记下来。
 *
 * 只跟**紧邻的上一次**比、只在 `SOURCE_DEDUP_TTL_MS` 内有效。记忆记的是本轮的**全部**结果
 * （包括被剔掉的重复项）：模型见过它们，反复递一遍不会让它多知道什么。
 * 全被剔光时记忆照样刷新，否则「一直重搜同一件事」会连着撞上一条早该过期的记忆。
 */
function serveResults(
  results: WebSearchResult[],
  at: number
): { fresh: WebSearchResult[]; deduped: number } {
  const previous = lastServed;
  const fresh =
    previous !== null && at - previous.at <= SOURCE_DEDUP_TTL_MS
      ? results.filter((item) => !previous.keys.has(sourceKey(item.url)))
      : results;
  lastServed = { keys: new Set(results.map((item) => sourceKey(item.url))), at };
  return { fresh, deduped: results.length - fresh.length };
}

/** 只管「源链怎么走」：按序试、该进冷却的进冷却、全挂了抛。判重与措辞不归它管。 */
async function runSourceChain(
  query: string,
  options: WebSearchOptions
): Promise<Omit<WebSearchOutcome, "deduped">> {
  const sources = options.sources ?? WEB_SEARCH_SOURCES;
  const now = options.now ?? Date.now;
  const skipped: string[] = [];
  const tried: string[] = [];
  const broken: string[] = [];
  const hint: string[] = [];

  for (const source of sources) {
    const until = cooldownUntil.get(source.id);
    if (until !== undefined && until > now()) {
      skipped.push(source.id);
      continue;
    }
    tried.push(source.label);
    // **源抛异常不许掐断整条链**（2026-10-10 修）。源的契约是「返回一条 SourceAttempt」，
    // 真源已把读 body 也包进自己的 try；这里是第二道——第三方源或将来的改动一旦抛了，
    // 它仍只是一个「坏掉的源」：记一条失败、进冷却、继续试下一个。
    // 不这么做的话，一个源的异常会把后面的源整段跳过，冷却簿记也整段不记，
    // 于是「三个源都试一遍」实际只试了一个，而且下一轮还会再撞一次。
    let attempt: SourceAttempt;
    try {
      attempt = await source.run(query, options.fetchImpl);
    } catch (error) {
      attempt = { ok: false, reason: "network", message: networkMessage(error) };
    }
    if (attempt.ok && attempt.results.length > 0) {
      // 答上一次就把连续失败清零：一次偶发的连不上不该让后面的冷却一直翻倍。
      // 不清零的话「断网三秒 + 之后一直正常」会一路涨到六十分钟，那是在惩罚早就恢复的源。
      consecutiveFailures.delete(source.id);
      cooldownUntil.delete(source.id);
      return {
        sourceId: source.id,
        sourceLabel: source.label,
        results: attempt.results,
        attempted: tried.length,
        skipped
      };
    }
    // 「源是好的，只是这次没搜着」——`empty` 与「ok 但 0 条」都归这一类：
    // 不进冷却（换个词还能搜），也不算「源坏了」（源本身好着呢）。
    if (attempt.ok || attempt.reason === "empty") {
      if (!attempt.ok && attempt.hint !== undefined) hint.push(attempt.hint);
      continue;
    }
    coolDown(source.id, now());
    broken.push(`${source.label}${attempt.message === "" ? "" : `：${attempt.message}`}`);
  }

  if (tried.length === 0)
    throw new WebSearchError(`搜索源都在冷却里，${waitHint(now())}再试一次。`, "unavailable");
  // 没有一个源是坏的、只是都没搜到：这不是失败，是这个说法没搜着东西。两句话给模型的下一步
  // 动作完全不同（等一会儿 vs 换关键词），不能混成一句。
  // 有源说得出「为什么」（比如必应塌方），那句话比泛泛的「没搜到」更能教会模型下一次怎么发。
  if (broken.length === 0)
    throw new WebSearchError(
      hint.length === 0
        ? `搜索源都能用，但没搜到「${query}」的相关结果——换几个关键词再搜一次。`
        : `${hint[0]}。`,
      "empty"
    );
  throw new WebSearchError(
    `搜索源用不了——${broken.join("；")}。可以换个说法再搜，或先基于已有文稿继续工作。`,
    "unavailable"
  );
}

/**
 * 把一个源打进冷却，时长按**连续失败次数**翻倍（封顶 SOURCE_COOLDOWN_MAX_MS）。
 *
 * 为什么不是固定十分钟：2026-10-06 在本机实测，360 的频控窗口**超过 23 分钟**没恢复。
 * 固定十分钟的冷却比真实窗口短，于是连着搜几次的用户会这样撞墙——
 * 搜 → 被拒 → 等十分钟 → 再搜 → 又被拒 → 再等十分钟，一轮接一轮全是白等。
 * **冷却短于源的脾气，等于没有冷却。**
 *
 * 指数退避不需要事先知道窗口有多长：源答上一次就把次数清零；一直不答就
 * 10 → 20 → 40 → 60 分钟，撞得越狠等得越久，直到真的答上一次为止。
 */
function coolDown(sourceId: string, at: number): void {
  const strikes = (consecutiveFailures.get(sourceId) ?? 0) + 1;
  consecutiveFailures.set(sourceId, strikes);
  const span = Math.min(SOURCE_COOLDOWN_MS * 2 ** (strikes - 1), SOURCE_COOLDOWN_MAX_MS);
  cooldownUntil.set(sourceId, at + span);
}

/** 冷却满而一个源都没试时，告诉用户/模型**还差多久**——已经等了 50 分钟还说「等几分钟」是假话。 */
function waitHint(at: number): string {
  const left = [...cooldownUntil.values()].filter((until) => until > at);
  if (left.length === 0) return "稍等";
  const mins = Math.ceil(Math.max(...left.map((until) => until - at)) / 60000);
  return `最长还要等 ${mins} 分钟，`;
}
