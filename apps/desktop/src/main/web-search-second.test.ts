import { beforeEach, describe, expect, it } from "vitest";
import {
  resetWebSearchState,
  SOURCE_DEDUP_TTL_MS,
  webSearch,
  type SourceAttempt,
  type WebFetchLike,
  type WebSearchResult,
  type WebSearchSource
} from "./web-search.js";

/**
 * 一轮里模型换词重搜（批次 5-⑩）。
 *
 * 单独一个文件，是因为它与「单次搜索」是**两种不同的失败模式**：单次搜索照不出的东西，
 * 恰恰是这一组要钉的——编号撞车、同一页面被数成两条来源、记忆该在什么时候作废。
 * 混在同一个文件里，读者会以为那些断言是上一组的边角。
 */
function ok(results: WebSearchResult[]): SourceAttempt {
  return { ok: true, results };
}
function fail(reason: "network" | "unavailable" | "empty", message = ""): SourceAttempt {
  return { ok: false, reason, message };
}
function source(id: string, run: WebSearchSource["run"]): WebSearchSource {
  return { id, label: id, run };
}
const never = (): WebFetchLike => () => new Promise<Response>(() => {});

beforeEach(() => {
  resetWebSearchState();
});

describe("第二轮搜索：判重与键的身份性", () => {
  const A = "https://www.zhihu.com/q/111";
  const B = "https://baike.baidu.com/item/darkforest";
  const C = "https://www.guokr.com/article/439";
  const item = (title: string, url: string): WebSearchResult => ({ title, url, snippet: "" });

  /**
   * 夹具照的是真机量到的形状：两个查询递回**高度重叠**的页面（两次五条里有两条是同一页面）。
   * 旧套件每条用例都只搜一次，所以这一整类现象——编号撞车、同一页面被数成两条来源——
   * 在只搜一次时**全都是对的**，照不出来。
   */
  function answering(pages: Record<string, WebSearchResult[]>): WebSearchSource {
    return source("s", async (query) => {
      const results = pages[query] ?? [];
      return results.length === 0 ? fail("empty", "没搜着") : ok(results);
    });
  }

  it("第二次搜索里上一次已经递过的链接被剔掉，只把新的递回模型", async () => {
    const s = answering({
      第一: [item("知乎", A), item("百科", B)],
      第二: [item("知乎", A), item("百科", B), item("果壳", C)]
    });
    const first = await webSearch("第一", { sources: [s], fetchImpl: never() });
    const second = await webSearch("第二", { sources: [s], fetchImpl: never() });

    expect(first.results.map((r) => r.url)).toEqual([A, B]);
    expect(first.deduped).toBe(0);
    // 这三条若原样递回去，模型看到五个编号、实际只有三个页面，还会当成「多方印证」。
    expect(second.results.map((r) => r.url)).toEqual([C]);
    expect(second.deduped).toBe(2);
  });

  it("全部重复时说的是「重复」而不是「没搜到」——两者的下一步动作完全不同", async () => {
    const s = answering({ 第一: [item("知乎", A)], 第二: [item("知乎", A)] });
    await webSearch("第一", { sources: [s], fetchImpl: never() });
    await expect(webSearch("第二", { sources: [s], fetchImpl: never() })).rejects.toMatchObject({
      kind: "empty",
      message: expect.stringContaining("已经递过同样的 1 条结果")
    });
  });

  it("判重只认同一个链接，不按标题相似度乱判（同题不同页都该留着）", async () => {
    const other = "https://www.zhihu.com/q/999";
    const s = answering({
      第一: [item("知乎：黑暗森林是什么", A)],
      第二: [item("知乎：宇宙社会学的公理", other)]
    });
    await webSearch("第一", { sources: [s], fetchImpl: never() });
    const second = await webSearch("第二", { sources: [s], fetchImpl: never() });
    expect(second.results.map((r) => r.url)).toEqual([other]);
    expect(second.deduped).toBe(0);
  });

  it("记忆只在短窗口内有效：隔得久再搜同一个问题，该给的还是要给", async () => {
    let now = 0;
    const s = answering({ q: [item("知乎", A)] });
    const run = () => webSearch("q", { sources: [s], fetchImpl: never(), now: () => now });
    await run();
    now += SOURCE_DEDUP_TTL_MS + 1;
    // 隔太久判成重复，会让第二次搜索空手而归——那比重复更糟。
    expect((await run()).results.map((r) => r.url)).toEqual([A]);
  });

  it("只跟紧邻的上一次比：A→B→A 里第三次仍拿得到 A（不是拿整个会话的键去卡）", async () => {
    const D = "https://example.test/d";
    const s = answering({
      一: [item("A", A)],
      二: [item("D", D)],
      三: [item("A", A)]
    });
    await webSearch("一", { sources: [s], fetchImpl: never() });
    await webSearch("二", { sources: [s], fetchImpl: never() });
    expect((await webSearch("三", { sources: [s], fetchImpl: never() })).results).toHaveLength(1);
  });

  it("判重不吞掉源链的失败语义：首源挂掉、次源只给重复项时，说的是「重复」不是「源坏了」", async () => {
    const broken = source("broken", async () => fail("unavailable", "触发了访问频控"));
    const dup = answering({ q: [item("知乎", A)] });
    await webSearch("q", { sources: [dup], fetchImpl: never() });
    // 源链确实走了第二个源（第一个挂了），只是第二个递回来的是刚见过的页面。
    // 这时报「搜索源用不了」会让模型去等一个根本没坏的源——两类错的下一步动作相反。
    await expect(
      webSearch("q", { sources: [broken, dup], fetchImpl: never() })
    ).rejects.toMatchObject({
      kind: "empty",
      message: expect.stringContaining("已经递过同样的 1 条")
    });
  });
});

/**
 * 判重**关掉**的那条路（2026-10-24）：素材库面板。
 *
 * 判重是为**模型**写的（同一页面被数成两条「多方印证」），而面板是给人看的：
 * 人点第二次「搜」看到同样那几条，不是被骗；而「上一次搜索已经递过同样的 N 条结果……
 * 或直接用上一轮的来源」那句是写给模型的下一步动作的，摆在人眼前只会让人摸不着头脑。
 * ⇒ 关掉判重还顺带让两个角色各记各的：人在面板搜一次，不该把模型下一轮的结果吃掉。
 */
describe("判重关掉时（面板那条路）：原样递回，且不写进模型的记忆", () => {
  const A = "https://www.zhihu.com/q/111";
  const item = (title: string, url: string): WebSearchResult => ({ title, url, snippet: "" });

  function answering(pages: Record<string, WebSearchResult[]>): WebSearchSource {
    return source("s", async (query) => {
      const results = pages[query] ?? [];
      return results.length === 0 ? fail("empty", "没搜着") : ok(results);
    });
  }

  it("同样的结果照样递回来，不剔、也不抛「已经递过同样的结果」", async () => {
    const s = answering({ 第一: [item("知乎", A)], 第二: [item("知乎", A)] });
    await webSearch("第一", { sources: [s], fetchImpl: never(), dedupe: false });
    const second = await webSearch("第二", { sources: [s], fetchImpl: never(), dedupe: false });
    expect(second.results.map((r) => r.url)).toEqual([A]);
    expect(second.deduped).toBe(0);
  });

  it("面板那一次搜索**不写**模型的判重记忆：模型下一轮照样拿得到那些页面", async () => {
    const s = answering({ 第一: [item("知乎", A)], 第二: [item("知乎", A)] });
    // 人在面板里搜了一次（判重关着）。
    await webSearch("第一", { sources: [s], fetchImpl: never(), dedupe: false });
    // 模型随后搜同一件事——这一轮开着判重，却不该被判成「重复」。
    const model = await webSearch("第二", { sources: [s], fetchImpl: never() });
    expect(model.results.map((r) => r.url)).toEqual([A]);
    expect(model.deduped).toBe(0);
  });
});
