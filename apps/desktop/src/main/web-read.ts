/**
 * web_read：抓一条网页链接的正文（2026-10-11）。web_search 只回标题+摘要——
 * 扫榜、查资料的任务常需要某一条来源的**正文**，这一枚把网页剥成纯文本给模型读。
 * 与 web-search.ts 同一套纪律：主进程出网（渲染层碰不到网络）、fetchImpl 注入可测、
 * 带超时防挂死、错误全部翻成中文；只读工具，一个字都不落盘。
 *
 * 安全口径与 app:open-web-source 同源：URL 判定直接引 `isOpenableWebSource`
 * （http/https 白名单、拒 file/javascript/data、拒 user:pass@）——
 * 「能不能打开」与「能不能去读」是同一个问题，不该有两份判据。
 */

import { isOpenableWebSource } from "./web-source-link.js";
import type { WebFetchLike } from "./web-search.js";
import { sourceKey } from "@mochen/contracts";

/** 正文的回执上限（字符）。与 read_doc 的 READ_TRUNCATE_AT 同一量级：够模型读透一篇资料。 */
export const WEB_READ_TEXT_LIMIT = 6000;

/** 下载的 HTML 上限（字节）：百科正文页通常几百 KB；再大基本是无限滚动页或夹带。 */
export const WEB_READ_MAX_BYTES = 3 * 1024 * 1024;

/** 单页超时：抓正文比抓搜索页慢是常态（页面更大），但同样必须有界。 */
export const WEB_READ_TIMEOUT_MS = 15000;

export interface WebReadOutcome {
  /** 页面 <title>（剥不出来的话就是 URL 本身，回执永远报得出「读的是哪一页」）。 */
  title: string;
  /** 最终生效的 URL（跳转后）。 */
  url: string;
  text: string;
  /** 截断与否要能看出来：模型读的是前 WEB_READ_TEXT_LIMIT 个字符，不是全文。 */
  truncated: boolean;
}

/**
 * 源链外唯一会抛的错误类型。kind 只分两档，处置不同：
 *   bad-url  —— 链接本身不合法/不是 http(s)：重试没意义，换链接；
 *   fetch 类 —— 连不上 / 超时 / 非 HTML / 剥不出正文：稍后再试或换一条来源。
 * 调用方必须按 kind 分流；catch 到别的东西（裸 Error）一律挡在 host 那层，
 * 不把英文技术串透给用户——与 web-search 同一条纪律。
 */
export class WebReadError extends Error {
  constructor(
    message: string,
    readonly kind: "bad-url" | "fetch-failed" | "not-html" | "empty"
  ) {
    super(message);
    this.name = "WebReadError";
  }
}

const BROWSER_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8"
};

/** fetch 把底层错误包成 message = "fetch failed"；这里翻成人话（与 web-search 同一份措辞口径）。 */
function networkMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") return "连接超时";
  return "连不上";
}

/** HTML 实体反解：与 web-search 的 decodeEntities 同一张表（&amp; 必须最后解）。 */
function decodeEntities(input: string): string {
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/**
 * HTML → 纯文本（纯函数，唯一真身）。做法刻意保守：
 * ① 整段删掉 script / style / noscript / svg / 模板与注释——它们是「字很多但不是正文」的大头；
 * ② 块级元素的**闭合**换行成 \n（段落感保得住，又不会把行内标签变成断行）；
 * ③ 剩余标签全部剥掉，实体反解，空白压一行；
 * ④ 连续空行压成一段——导航残渣再漏进来也只是一行字，不是一屏噪音。
 * 不追求还原语义（链接列表、表格会拍平），只保证「读得懂、没有脚本杂讯」。
 */
export function htmlToText(html: string): { title: string; text: string } {
  const title =
    decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")
      .replace(/\s+/g, " ")
      .trim() || "";
  const body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(?:p|div|section|article|h[1-6]|li|tr|blockquote|pre|figcaption)>/gi, "\n")
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  const text = decodeEntities(body)
    .replace(/[ \t\f\v]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text };
}

export interface WebReadOptions {
  fetchImpl: WebFetchLike;
}

export async function webRead(rawUrl: string, options: WebReadOptions): Promise<WebReadOutcome> {
  // 与「点开来源」同一条闸：协议白名单等判定只住在 web-source-link 那一份。
  if (!isOpenableWebSource(rawUrl))
    throw new WebReadError(
      "这不是一条可读的网页链接（只收 http/https）——换 web_search 结果里的原文链接。",
      "bad-url"
    );
  let response: Response;
  try {
    response = await options.fetchImpl(rawUrl, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(WEB_READ_TIMEOUT_MS)
    });
  } catch (error) {
    throw new WebReadError(
      `这一页${networkMessage(error)}，稍后再试或换一条来源。`,
      "fetch-failed"
    );
  }
  if (!response.ok)
    throw new WebReadError(
      `这一页返回了 ${response.status}，读不了——换一条来源试试。`,
      "fetch-failed"
    );
  const type = response.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml|text\/plain/.test(type))
    throw new WebReadError(
      "这一页不是网页正文（可能是 PDF / 图片 / 下载项），读不了。",
      "not-html"
    );
  // 上限内截断字节再解码：无限滚动页与夹带超大文件的站点不该拖垮主进程。
  const buffer = Buffer.from(await response.arrayBuffer());
  const clipped = buffer.subarray(0, WEB_READ_MAX_BYTES);
  const html = clipped.toString("utf8");
  const finalUrl = response.url !== "" ? response.url : rawUrl;
  const { title, text } = htmlToText(html);
  if (text === "")
    throw new WebReadError(
      "这一页剥不出正文（可能是纯脚本渲染的页面）——换一条来源，或用搜索摘要。",
      "empty"
    );
  const truncated = text.length > WEB_READ_TEXT_LIMIT;
  return {
    title: title === "" ? finalUrl : title,
    url: finalUrl,
    text: truncated ? text.slice(0, WEB_READ_TEXT_LIMIT) : text,
    truncated
  };
}

/** 回执排版（给模型读）：报出读的是哪一页、正文、截断与否与来源键——引用口径与 web_search 一致。 */
export function webReadReceipt(outcome: WebReadOutcome): string {
  const head = `已读取「${outcome.title}」${outcome.truncated ? `（正文过长，只取前 ${WEB_READ_TEXT_LIMIT} 字）` : ""}：`;
  return `${head}\n${outcome.text}\n\n来源键：${sourceKey(outcome.url)}。引用这一页的内容时带上它；要保存就整理后用 write_doc 写进文稿。`;
}
