/**
 * 素材库联网搜索（2026-10-24）。
 *
 * 【为什么单开一条 IPC，而不复用对话里那枚 `web_search`】`web_search` 是**给模型用的工具**：
 * 它回的是给模型读的排版回执（带来源键、带页脚注意事项），而且必须在一轮对话里才会跑。
 * 用户要的是「在素材库面板里直接搜、直接把结果加成素材卡」——不绕对话、不等模型。
 *
 * 出网这一段**不新写**：主进程直接调 `web-search.ts` 那条源链（DuckDuckGo → 必应 → 360，
 * 冷却与判重都在它里面）。渲染层拿到的只有两种：一份结果清单，或一句中文的失败说明。
 */
export interface MaterialsSearchHit {
  title: string;
  url: string;
  snippet: string;
}

export type MaterialsSearchResult =
  | {
      ok: true;
      /** 答上这一轮的源的中文名（回执里给用户看，别让结果看起来像凭空来的）。 */
      sourceLabel: string;
      hits: MaterialsSearchHit[];
    }
  /** `message` 一律是**中文人话**（源链的 WebSearchError 就是写给用户看的），面板直接摆出来。 */
  | { ok: false; message: string };

/**
 * 一条网页的正文（2026-10-24）。
 *
 * 【为什么搜索之后还要再取一次全文】搜索回执只有**摘要**：搜索站给的那一两句话。
 * 摘要当素材是纸片——写稿时要的是那一页真正写了什么。所以落卡前要再抓一次正文，
 * 抓取复用主进程 `web-read.ts` 那条链（agent 的 `web_read` 用的是同一条），
 * 渲染层不新写抓取、也不碰网络。
 */
export interface MaterialsFetchedPage {
  /** 页面标题（剥不出来时就是最终 URL）。 */
  title: string;
  /** 跳转后的最终 URL——搜索站给的常常是跳转链，正文落在另一头。 */
  url: string;
  /** 正文纯文本。 */
  text: string;
  /** 正文是否只取了前面一段：素材里必须写明「这不是全文」，否则读者会当成全文引用。 */
  truncated: boolean;
}

export type MaterialsFetchResult =
  | { ok: true; page: MaterialsFetchedPage }
  /** `message` 一律是中文人话（抓取链的错误句就是写给用户看的），面板直接摆出来。 */
  | { ok: false; message: string };
