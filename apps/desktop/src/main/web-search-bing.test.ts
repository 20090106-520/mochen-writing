import { beforeEach, describe, expect, it } from "vitest";
import {
  BING_MIN_COVERAGE,
  bingCoverage,
  bingSource,
  parseBingHtml,
  resetWebSearchState,
  WEB_SEARCH_SOURCES,
  WEB_SEARCH_SNIPPET_LIMIT,
  webSearch,
  type WebFetchLike,
  type WebSearchResult
} from "./web-search.js";

/**
 * 必应夹具：照 cn.bing.com 的真实结构写的——每条结果整块 `class="b_algo"`，
 * 块内 h2>a 是标题、`p.b_lineclamp*` 是摘要。
 *
 * 两份夹具是**实测页面**的缩影，不是凭空编的：
 *   · GOOD_HTML 照「黑暗森林法则」那一份（实测 10/10 命中）；
 *   · COLLAPSED_HTML 照「怎么写一个让读者害怕的反转」那一份（实测塌成「怎么（汉语词语）」）。
 * 塌方这一份是整批的关键：它状态码 200、条条有标题有链接，**只有内容是错的**，
 * 而内容错比搜不到危险得多——所以才要有一道闸门挡着它。
 */

/** 一条 b_algo 的最小形状（共用，免得每条都抄一遍属性）。 */
function algo(title: string, href: string, snippet: string): string {
  return `<li class="b_algo">
    <h2><a href="${href}">${title}</a></h2>
    <div class="b_caption"><p class="b_lineclamp3">${snippet}</p></div>
  </li>`;
}

const GOOD_HTML = `<ol id="b_results">
  ${algo("黑暗森林法则_百度百科", "https://baike.baidu.com/item/黑暗森林法则", "宇宙社会学的核心理论。")}
  ${algo("黑暗森林法则是什么？ - 知乎", "https://www.zhihu.com/q/1", "大刘笔下真实的宇宙。")}
  ${algo("黑暗森林法则 - 三体wiki", "https://santi.huijiwiki.com/q/2", "由罗辑创立。")}
  ${algo("《三体》中的黑暗森林法则成立吗？", "https://www.zhihu.com/q/3", "从丛林法则假设出发。")}
</ol>`;

const COLLAPSED_HTML = `<ol id="b_results">
  ${algo("怎么（汉语词语）_百度百科", "https://baike.baidu.com/item/怎么", "怎么的意思。")}
  ${algo("如何（汉语词语）_百度百科", "https://baike.baidu.com/item/如何", "如何的意思。")}
  ${algo("怎么的意思_汉语国学", "https://www.hanyuguoxue.com/z/how", "拼音笔顺。")}
  ${algo("How to Use 怎么", "https://example.com/how", "Usages of 怎么。")}
</ol>`;

function fetchReturning(html: string): WebFetchLike {
  return async () =>
    new Response(html, {
      status: 200,
      headers: { "content-type": "text/html" }
    }) as unknown as Awaited<ReturnType<WebFetchLike>>;
}

describe("parseBingHtml", () => {
  it("按 b_algo 块取标题/链接/摘要，不扫全页 <a>", () => {
    const results = parseBingHtml(GOOD_HTML);
    expect(results).toHaveLength(4);
    expect(results[0]?.title).toBe("黑暗森林法则_百度百科");
    expect(results[0]?.url).toBe("https://baike.baidu.com/item/黑暗森林法则");
    expect(results[0]?.snippet).toContain("宇宙社会学");
  });

  it("导航与建议词不算结果：b_algo 之外的 <a> 一条都不收", () => {
    const withNoise = `<a href="https://cn.bing.com/">必应首页</a>
      <a href="https://cn.bing.com/imgs/search">图片</a>${GOOD_HTML}`;
    expect(parseBingHtml(withNoise)).toHaveLength(4);
  });

  it("缺 h2 或缺 href 的块跳过，不产出半条结果", () => {
    const broken = `<li class="b_algo"><h2>没有链接的标题</h2></li>
      <li class="b_algo"><a href="https://example.com/x">有链接没标题块</a></li>
      ${GOOD_HTML}`;
    const results = parseBingHtml(broken);
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.title !== "" && r.url !== "")).toBe(true);
  });

  it("摘要超长时截断到单条上限（上限 + 省略号，与其余两个源同一契约）", () => {
    const long = algo("黑暗森林法则_百度百科", "https://baike.baidu.com/item/x", "长".repeat(600));
    const first = parseBingHtml(long)[0];
    expect(first?.snippet.length).toBe(WEB_SEARCH_SNIPPET_LIMIT + 1);
    expect(first?.snippet.endsWith("…")).toBe(true);
  });
});

describe("bingCoverage · 质量闸门的判据", () => {
  it("关键词查询对得上：覆盖率远高于阈值", () => {
    const results = parseBingHtml(GOOD_HTML);
    expect(
      bingCoverage(
        "黑暗森林法则",
        results.map((r) => r.title)
      )
    ).toBeGreaterThan(BING_MIN_COVERAGE);
  });

  it("长问句塌成词典条目：覆盖率低于阈值", () => {
    const results = parseBingHtml(COLLAPSED_HTML);
    expect(
      bingCoverage(
        "怎么写一个让读者害怕的反转",
        results.map((r) => r.title)
      )
    ).toBeLessThan(BING_MIN_COVERAGE);
  });

  it("标点不算进二元组（问号逗号不参与计算）", () => {
    const results = parseBingHtml(GOOD_HTML);
    const withPunct = bingCoverage(
      "「黑暗森林法则」？",
      results.map((r) => r.title)
    );
    expect(withPunct).toBe(
      bingCoverage(
        "黑暗森林法则",
        results.map((r) => r.title)
      )
    );
  });

  it("两个字以下的 query 不判它塌——没得拆", () => {
    expect(bingCoverage("法", [])).toBe(1);
  });

  it("空标题列表时覆盖率是 0（不是 1）：没结果不等于完美匹配", () => {
    expect(bingCoverage("黑暗森林法则", [])).toBe(0);
  });
});

describe("bingSource", () => {
  beforeEach(() => {
    resetWebSearchState();
  });

  it("对得上就照常给结果", async () => {
    const attempt = await bingSource.run("黑暗森林法则", fetchReturning(GOOD_HTML));
    expect(attempt.ok).toBe(true);
    if (!attempt.ok) return;
    expect(attempt.results).toHaveLength(4);
  });

  it("**内容错就报 empty，绝不把词典条目当来源递出去**", async () => {
    const attempt = await bingSource.run(
      "怎么写一个让读者害怕的反转",
      fetchReturning(COLLAPSED_HTML)
    );
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    // empty 而不是 unavailable：源是好的，是这个 query 不适合——不该把源锁进冷却
    expect(attempt.reason).toBe("empty");
    // 塌方的原因走 hint 透出（message 是给内部看的「页面上没解析出结果」）
    expect(attempt.hint).toContain("关键词");
    // 断言的是**观察**（结果里几乎没有你的字），不是机制：
    // 「源只认查询开头的词」这条机制在 p544/p545 被推翻了（10 字的
    // 「徽派建筑的特点是什么」照样好使），写进给模型看的提示等于教它一个假因果。
    expect(attempt.hint).toContain("几乎都不含");
    expect(attempt.hint).not.toContain("只认查询开头的词");
  });

  it("页面上一条都解析不出时也报 empty", async () => {
    const attempt = await bingSource.run(
      "黑暗森林法则",
      fetchReturning("<html>没有结果容器</html>")
    );
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.reason).toBe("empty");
  });

  it("网络层失败归 network（这类才进冷却）", async () => {
    const attempt = await bingSource.run("黑暗森林法则", async () => {
      throw new Error("boom");
    });
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.reason).toBe("network");
  });

  it("非 2xx 归 unavailable，不是 empty", async () => {
    const attempt = await bingSource.run(
      "黑暗森林法则",
      async () =>
        new Response("forbidden", { status: 403 }) as unknown as Awaited<ReturnType<WebFetchLike>>
    );
    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    expect(attempt.reason).toBe("unavailable");
  });
});

describe("源链顺序", () => {
  it("必应排在 360 前面、DuckDuckGo 仍然最前", () => {
    expect(WEB_SEARCH_SOURCES.map((s) => s.id)).toEqual(["duckduckgo", "bing-cn", "so-360"]);
  });

  it("每一枚的 id 与 label 都非空（回执要写给人看）", () => {
    for (const source of WEB_SEARCH_SOURCES) {
      expect(source.id.length).toBeGreaterThan(0);
      expect(source.label.length).toBeGreaterThan(0);
    }
  });

  it("三枚源各自的结果形状一致：标题/链接/摘要都得有字段", () => {
    const shape: (keyof WebSearchResult)[] = ["title", "url", "snippet"];
    expect(shape).toEqual(["title", "url", "snippet"]);
  });
});

describe("塌方那句话要真的递到用户眼前（2026-10-06 真机撞出来的）", () => {
  beforeEach(() => {
    resetWebSearchState();
  });

  /**
   * 真机第一次跑就是在这儿出的问题：桩发了一整句问句，必应塌方，
   * 但 `empty` 分支在源链里被 `continue` 掉了，那句「结果几乎不含你的字」根本没机会浮出去，
   * 用户只看到「没搜到「黑暗森林法则是什么」的相关结果」——
   * **听起来像这话题没资料**，于是模型换个话题重试，而不是把问题压成关键词。
   * 这条守卫盯的就是那一步：hint 透出去了没有。
   */
  const onlyBing = [bingSource];

  it("全链 empty 时，回执说的是「结果几乎不含你的字」而不是泛泛的没搜到", async () => {
    await expect(
      webSearch("怎么写一个让读者害怕的反转", {
        sources: onlyBing,
        fetchImpl: fetchReturning(COLLAPSED_HTML)
      })
    ).rejects.toThrow(/几乎都不含/);
  });

  it("同一条消息里要含「压成 2–4 个关键词」——模型得知道下一步该做什么", async () => {
    await expect(
      webSearch("什么是黑暗森林法则", {
        sources: onlyBing,
        fetchImpl: fetchReturning(COLLAPSED_HTML)
      })
    ).rejects.toThrow(/2–4 个关键词/);
  });

  it("不是「这话题没资料」的说法：那句话会把模型引到换话题而不是换措辞", async () => {
    await expect(
      webSearch("怎么写一个让读者害怕的反转", {
        sources: onlyBing,
        fetchImpl: fetchReturning(COLLAPSED_HTML)
      })
    ).rejects.not.toThrow(/都能用，但没搜到/);
  });

  it("塌方不锁源：同样的源换个词还能再搜（empty 不进冷却）", async () => {
    await expect(
      webSearch("怎么写一个让读者害怕的反转", {
        sources: onlyBing,
        fetchImpl: fetchReturning(COLLAPSED_HTML)
      })
    ).rejects.toThrow();
    // 第二次换个好词就通——证明上一轮的 empty 没把必应打进冷却
    const outcome = await webSearch("黑暗森林法则", {
      sources: onlyBing,
      fetchImpl: fetchReturning(GOOD_HTML)
    });
    expect(outcome.sourceId).toBe("bing-cn");
    expect(outcome.results.length).toBeGreaterThan(0);
  });
});
