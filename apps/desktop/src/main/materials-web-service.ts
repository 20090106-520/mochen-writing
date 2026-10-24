/**
 * 素材库联网搜索的 IPC 面（2026-10-24）。
 *
 * 【出网这一段不新写】搜索直接调 `web-search.ts` 那条源链：DuckDuckGo → 必应 → 360，
 * 冷却、判重、「塌方就如实说没搜着」那一整套都在它里面；取全文直接调 `web-read.ts`
 * 那条链（agent 的 `web_read` 用的是同一条）。渲染层碰不到网络。
 *
 * 【为什么把判定拆成纯函数】注册必须走 `handleTrusted`（来源闸 + 参数形状闸），
 * 而拉起那道闸的夹具比这两条逻辑本身重得多。所以判定与映射做成**注入依赖的纯函数**：
 * 搜索 / 抓取函数由调用方递进来，单测直接喂假实现，不必动闸。
 */
import { IPC_CHANNELS } from "@mochen/contracts";
import type { MaterialsFetchResult, MaterialsSearchResult } from "@mochen/contracts";
import { handleTrusted } from "./ipc-guard.js";
import { WebReadError, webRead, type WebReadOutcome } from "./web-read.js";
import { WebSearchError, webSearch, type WebSearchOutcome } from "./web-search.js";

/** ipcMain.handle 的窄形状（由装配处裹一层，与 recent-books-store 同款）。 */
type Handler = (channel: string, fn: (...args: unknown[]) => unknown) => void;

/**
 * 把一个搜索词变成渲染层要的回执。两条规矩：
 * ① 空词**当场回**，不去打扰源链——白挨一次频控是最没有意义的代价；
 * ② 结果削成三字段（标题 / 链接 / 摘要）——回执排版、来源键那些是给模型读的，别渗进界面；
 * ③ 失败只透 `WebSearchError` 的中文句子（源链保证那是给用户看的）；别的错误一律换成通用说明，
 *    绝不把 `fetch failed` 这类英文技术串端到用户眼前。
 */
export async function materialsSearchReply(
  raw: unknown,
  search: (query: string) => Promise<WebSearchOutcome>
): Promise<MaterialsSearchResult> {
  const query = typeof raw === "string" ? raw.trim() : "";
  if (query === "") return { ok: false, message: "先给一个搜索词。" };
  try {
    const outcome = await search(query);
    return {
      ok: true,
      sourceLabel: outcome.sourceLabel,
      hits: outcome.results.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet }))
    };
  } catch (error) {
    const message =
      error instanceof WebSearchError ? error.message : "搜索源那边出了点问题，稍后再试。";
    return { ok: false, message };
  }
}

/**
 * 把一条链接变成渲染层要的正文回执（2026-10-24）。
 *
 * 【为什么要有这一步】搜索回执只有摘要，一两句话。摘要当素材是纸片——写稿时要用的是
 * 那一页真正写了什么。所以落卡前要抓一次正文，抓取复用 `web-read.ts` 那条链，一个字没新写。
 *
 * 三条规矩：
 * ① 空链接当场回（不白跑一次网络）；
 * ② **失败也回回执，不抛**——面板那枚「加入素材库」是 await 后按 `ok` 分支走的，
 *    抛错会让它悬死在 await 上；抓不到正文时面板退回收摘要那一档，不让整条动作作废；
 * ③ 只透 `WebReadError` 的中文句子（抓取链的错句就是写给用户看的），别的错误一律换成通用说明。
 */
export async function materialsFetchReply(
  raw: unknown,
  read: (url: string) => Promise<WebReadOutcome>
): Promise<MaterialsFetchResult> {
  const url = typeof raw === "string" ? raw.trim() : "";
  if (url === "") return { ok: false, message: "没有可读的链接。" };
  try {
    const outcome = await read(url);
    return {
      ok: true,
      page: {
        title: outcome.title,
        url: outcome.url,
        text: outcome.text,
        truncated: outcome.truncated
      }
    };
  } catch (error) {
    const message =
      error instanceof WebReadError ? error.message : "这一页读不出来，稍后再试或换一条来源。";
    return { ok: false, message };
  }
}

export function registerMaterialsWebIpc(register: Handler): void {
  handleTrusted(register, IPC_CHANNELS.materialsSearch, (_event, query: string) =>
    // `dedupe: false`：面板是给人看的，那套「上一次已经递过同样的结果」的措辞是写给模型的；
    // 关掉判重还顺带让**两个角色各记各的**——人在面板搜一次不该把模型下一轮的结果吃掉。
    materialsSearchReply(query, (q) => webSearch(q, { fetchImpl: fetch, dedupe: false }))
  );
  handleTrusted(register, IPC_CHANNELS.materialsFetch, (_event, url: string) =>
    materialsFetchReply(url, (u) => webRead(u, { fetchImpl: fetch }))
  );
}
