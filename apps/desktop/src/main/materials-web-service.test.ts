import { describe, expect, it } from "vitest";
import { WebSearchError, type WebSearchOutcome } from "./web-search.js";
import { WebReadError, type WebReadOutcome } from "./web-read.js";
import { materialsFetchReply, materialsSearchReply } from "./materials-web-service.js";

/**
 * 素材库联网搜索的映射（2026-10-24）。
 *
 * 这条判定没有模板可抄、也不会自己报错：漏掉「空词不打源链」只是白挨一次频控；
 * 漏掉「别的错误不透」就会把 `fetch failed` 这类英文技术串端到用户眼前。
 * 所以钉四件事：成功削三字段、空词短路、源链中文原样透、别的错误不透。
 */
const OUTCOME: WebSearchOutcome = {
  sourceId: "duckduckgo",
  sourceLabel: "DuckDuckGo",
  results: [
    { title: "黑暗森林法则", url: "https://example.com/a", snippet: "宇宙社会学的两条公理。" }
  ],
  attempted: 1,
  skipped: [],
  deduped: 0
};

describe("materialsSearchReply · 搜索词 → 渲染层回执", () => {
  it("成功：削成标题 / 链接 / 摘要三字段，并把答上这一轮的源名报出来", async () => {
    const result = await materialsSearchReply("黑暗森林", async () => OUTCOME);
    expect(result).toEqual({
      ok: true,
      sourceLabel: "DuckDuckGo",
      hits: [
        { title: "黑暗森林法则", url: "https://example.com/a", snippet: "宇宙社会学的两条公理。" }
      ]
    });
  });

  it("空搜索词当场回，不去打扰源链（白挨一次频控是最没意义的代价）", async () => {
    let called = false;
    const result = await materialsSearchReply("   ", async () => {
      called = true;
      return OUTCOME;
    });
    expect(result).toEqual({ ok: false, message: "先给一个搜索词。" });
    expect(called).toBe(false);
  });

  it("源链那句中文原样透出：搜不着 / 源用不了，都是写给用户看的", async () => {
    const result = await materialsSearchReply("x", async () => {
      throw new WebSearchError(
        "搜索源都能用，但没搜到「x」的相关结果——换几个关键词再搜一次。",
        "empty"
      );
    });
    expect(result).toEqual({
      ok: false,
      message: "搜索源都能用，但没搜到「x」的相关结果——换几个关键词再搜一次。"
    });
  });

  it("别的错误不透：英文技术串一个字都不许到用户眼前", async () => {
    const result = await materialsSearchReply("x", async () => {
      throw new Error("fetch failed: connect ECONNREFUSED 127.0.0.1:443");
    });
    expect(result.ok).toBe(false);
    const text = JSON.stringify(result);
    expect(text).not.toContain("fetch failed");
    expect(text).not.toContain("ECONNREFUSED");
  });
});

/**
 * 取全文那一半（2026-10-24）。搜索只给摘要，摘要当素材是纸片——落卡前要把正文抓回来。
 * 抓取复用 `web-read.ts` 那条链（agent 的 `web_read` 用的是同一条），这里只判映射。
 *
 * 钉四件事：正文四字段原样带出（含「截断了没有」）、空链接短路、
 * 抓取链那句中文原样透（面板靠它告诉用户「正文没取到」）、别的错误不透。
 */
const PAGE: WebReadOutcome = {
  title: "黑暗森林法则",
  url: "https://example.com/a",
  text: "宇宙社会学的两条公理。",
  truncated: false
};

describe("materialsFetchReply · 链接 → 渲染层正文回执", () => {
  it("成功：标题 / 最终链接 / 正文 / 截断与否，四样都带出去", async () => {
    const result = await materialsFetchReply("https://example.com/a", async () => PAGE);
    expect(result).toEqual({
      ok: true,
      page: {
        title: "黑暗森林法则",
        url: "https://example.com/a",
        text: "宇宙社会学的两条公理。",
        truncated: false
      }
    });
  });

  it("截断这一位必须带出去：素材里要写明「这不是全文」", async () => {
    const result = await materialsFetchReply("https://example.com/a", async () => ({
      ...PAGE,
      truncated: true
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.page.truncated).toBe(true);
  });

  it("空链接当场回，不白跑一次网络", async () => {
    let called = false;
    const result = await materialsFetchReply("   ", async () => {
      called = true;
      return PAGE;
    });
    expect(result).toEqual({ ok: false, message: "没有可读的链接。" });
    expect(called).toBe(false);
  });

  it("抓取链那句中文原样透出：面板靠它告诉用户「这条只收了摘要」", async () => {
    const result = await materialsFetchReply("https://example.com/a", async () => {
      throw new WebReadError("这一页连不上，稍后再试或换一条来源。", "fetch-failed");
    });
    expect(result).toEqual({
      ok: false,
      message: "这一页连不上，稍后再试或换一条来源。"
    });
  });

  it("别的错误不透：英文技术串一个字都不许到用户眼前", async () => {
    const result = await materialsFetchReply("https://example.com/a", async () => {
      throw new Error("TypeError: fetch failed: socket hang up");
    });
    expect(result.ok).toBe(false);
    const text = JSON.stringify(result);
    expect(text).not.toContain("fetch failed");
    expect(text).not.toContain("socket hang up");
    expect(text).not.toContain("TypeError");
  });
});
