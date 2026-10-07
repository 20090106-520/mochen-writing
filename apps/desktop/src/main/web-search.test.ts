import { beforeEach, describe, expect, it } from "vitest";
import { sourceKey } from "@mochen/contracts";
import {
  duckduckgoSource,
  isSo360NoiseCard,
  isThrottled360Page,
  normalizeResults,
  parseDuckDuckGoHtml,
  parseSo360Html,
  resetWebSearchState,
  so360Source,
  SOURCE_COOLDOWN_MAX_MS,
  SOURCE_COOLDOWN_MS,
  WEB_SEARCH_RESULTS_LIMIT,
  WEB_SEARCH_SNIPPET_LIMIT,
  WEB_SEARCH_URL_LIMIT,
  webSearchReceipt,
  webSearch,
  type SourceAttempt,
  type WebFetchLike,
  type WebSearchOutcome,
  type WebSearchResult,
  type WebSearchSource
} from "./web-search.js";

/**
 * DuckDuckGo 夹具：照 html.duckduckgo.com/html/ 的真实结构写的（result 容器 → result__body →
 * h2>a.result__a + a.result__snippet）。
 *
 * 第 2 条**故意没有摘要**：旧解析器是两条扁平正则按下标配对，这一条缺摘要就让第 3、4 条的摘要
 * 整体前移一格——把第 3 条的摘要记成第 2 条的来源。这条夹具就是那个缺陷的照妖镜。
 */
const DDG_HTML = `
<div class="result results_links web-result">
  <div class="links_main result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fone&amp;rut=aa">第一条 &amp; <b>标题</b></a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fone">第一条摘要。</a>
  </div>
</div>
<div class="result results_links web-result">
  <div class="links_main result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Ftwo&amp;rut=bb">第二条标题</a>
    </h2>
  </div>
</div>
<div class="result results_links web-result">
  <div class="links_main result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fthree&amp;rut=cc">第三条标题</a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fthree">第三条摘要。</a>
  </div>
</div>
<div class="result results_links web-result">
  <div class="links_main result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Ffour&amp;rut=dd">第四条标题</a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Ffour">第四条摘要。</a>
  </div>
</div>
`;

/**
 * 360 夹具：照 2026-10-06 在本机抓到的那次真实响应写的（www.so.com/s）。
 * 刻意保留了三样真页面上就有、朴素正则会栽跟头的东西：
 *   ① 第 1 条带图片位和 res-rich 包裹层，摘要藏在 `<p class="res-desc"><span class="res-list-summary">` 里；
 *   ② 摘要尾部挂着一串「详情>>」和相关词条的 <a>（不清掉就会把 URL 混进摘要）；
 *   ③ 第 3、4 条**没有摘要**——实测七条里常常只有三四条带摘要。
 */
const SO360_HTML = `<div class="res-list"><h3 class="res-title"><a href="https://baike.so.com/doc/5586742-32338966.html" rel="noopener" data-res='{"tp":21}' target="_blank"><em>黑暗森林</em>法则_360百科</a></h3><div class="res-rich res-baike clearfix"><div class="g-img-wrap res-comm-img"><div class="g-img-inner g-img-def"><a href="https://baike.so.com/doc/5586742-32338966.html"><img class="so-lazyimg" data-isrc="https://so.360tres.com/a.jpg"></a></div></div><div class="res-comm-con"><p class="res-desc"><span class="res-list-summary">黑暗森林法则，<em>科幻小说作家刘慈欣在《三体II 黑暗森林》引入的法则</em>。罗辑借由引入猜疑链和技术爆炸，从理论上建立起 <a href="https://baike.so.com/doc/5586742-32338966.html" class="detail" data-type="more">详情&gt;&gt;</a><br></span><span class="gray2"><a href="https://baike.so.com/doc/1">叶罗理论</a> - <a href="https://baike.so.com/doc/2">概率理论</a></span></p></div></div></div>
<div class="res-list"><h3 class="res-title"><a href="https://www.so.com/link?m=uKrrMJcI%2Fd6HyYETyQkpQD1Ms3alCK4uNL0n056" target="_blank">三体之黑暗森林法则 - 今日头条</a></h3><p class="res-desc"><span class="res-list-summary">2026年6月13日 - 黑暗森林法则是刘慈欣科幻小说《三体Ⅱ：黑暗森林》的核心世界观设定，由叶文洁提出宇宙社会学的公理基础 <a href="https://www.so.com/link?m=zzz" class="detail">详情&gt;&gt;</a></span></p></div>
<div class="res-list"><h3 class="res-title"><a href="https://www.so.com/link?m=wB81voTNbpvB8ITmlz%2BHAoB331jfiMBajch7%2FjV0big" target="_blank">寂静的猎场：解读刘慈欣的黑暗森林理论</a></h3></div>
<div class="res-list"><h3 class="res-title"><a href="https://zhuanlan.zhihu.com/p/1895582420746621458" target="_blank">刘姓概况和53位古今名人</a></h3></div>`;

/** 360 触发频控时回的那一页（200 + 「访问异常」）。字节数取自实测的 6472。 */
const SO360_THROTTLED = `<html><head><title>访问异常页面</title></head><body><div>${"x".repeat(
  6400
)}</div></body></html>`;

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

/** 取第 i 条并报出实际条数：`noUncheckedIndexedAccess` 开着，而断言红时报「第 3 条不存在」比报 undefined 有用。 */
function at(list: WebSearchResult[], index: number): WebSearchResult {
  const hit = list[index];
  if (hit === undefined) throw new Error(`第 ${index + 1} 条不存在（实际 ${list.length} 条）`);
  return hit;
}

beforeEach(() => {
  resetWebSearchState();
});

describe("DuckDuckGo 解析", () => {
  it("缺摘要的那条摘要留空，后面几条的摘要不跟着前移（这是旧实现的真缺陷）", () => {
    const results = parseDuckDuckGoHtml(DDG_HTML);
    expect(results.map((r) => r.title)).toEqual([
      "第一条 & 标题",
      "第二条标题",
      "第三条标题",
      "第四条标题"
    ]);
    expect(at(results, 1).snippet).toBe("");
    expect(at(results, 2).snippet).toBe("第三条摘要。");
    expect(at(results, 3).snippet).toBe("第四条摘要。");
  });

  it("uddg 跳转链接解成真实地址，解不出来时原样留着并补协议", () => {
    const results = parseDuckDuckGoHtml(DDG_HTML);
    expect(at(results, 0).url).toBe("https://example.com/one");
    const raw = parseDuckDuckGoHtml('<a class="result__a" href="//example.com/x">标题</a>');
    expect(at(raw, 0).url).toBe("https://example.com/x");
  });

  it("class 在 href 之后也认（属性顺序不是判据）", () => {
    const html = '<a href="https://example.com/z" class="result__a">倒序属性</a>';
    expect(at(parseDuckDuckGoHtml(html), 0)).toEqual({
      title: "倒序属性",
      url: "https://example.com/z",
      snippet: ""
    });
  });
});

describe("360 解析（结构照 2026-10-06 本机真实响应）", () => {
  it('res-list-summary 是摘要的容器，不是新结果块（写成 class="res-list 就切会切碎块、摘要全丢）', () => {
    // 夹具里真正的结果块 4 个，外加 2 个 <span class="res-list-summary">。
    // 少写那个 (?![-\w]) 就会切成 6 段 —— 块被切碎后每条摘要都变成空串，而且**不报错**。
    const sloppy = SO360_HTML.match(/class="res-list/g)?.length;
    const strict = SO360_HTML.match(/class="res-list(?![-\w])/g)?.length;
    expect(sloppy).toBe(6);
    expect(strict).toBe(4);
    const results = parseSo360Html(SO360_HTML);
    expect(results).toHaveLength(4);
    expect(at(results, 0).snippet).toContain("科幻小说作家刘慈欣");
    expect(at(results, 1).snippet).toContain("核心世界观设定");
  });

  it("标题链接摘要各归各位；res-rich 的图片位不把标题抢走", () => {
    const results = parseSo360Html(SO360_HTML);
    expect(results.map((r) => r.title)).toEqual([
      "黑暗森林法则_360百科",
      "三体之黑暗森林法则 - 今日头条",
      "寂静的猎场：解读刘慈欣的黑暗森林理论",
      "刘姓概况和53位古今名人"
    ]);
    expect(at(results, 0).url).toBe("https://baike.so.com/doc/5586742-32338966.html");
  });

  it("缺摘要的那两条摘要留空，不去借前一条的", () => {
    const results = parseSo360Html(SO360_HTML);
    expect(at(results, 2).snippet).toBe("");
    expect(at(results, 3).snippet).toBe("");
    expect(at(results, 1).snippet).toContain("核心世界观设定");
  });

  it("摘要里的「详情>>」和相关词条链接被摘掉，URL 不混进摘要", () => {
    const results = parseSo360Html(SO360_HTML);
    expect(at(results, 0).snippet).not.toContain("baike.so.com");
    expect(at(results, 0).snippet).not.toContain("详情");
    expect(at(results, 0).snippet).not.toContain("叶罗理论");
    expect(at(results, 1).snippet).not.toContain("详情");
  });

  it("so.com/link 跳转链原样留着（参数是不透明串，本仓不猜它的编码）", () => {
    const results = parseSo360Html(SO360_HTML);
    expect(at(results, 1).url).toBe(
      "https://www.so.com/link?m=uKrrMJcI%2Fd6HyYETyQkpQD1Ms3alCK4uNL0n056"
    );
  });

  it("标题高亮 <em> 被剥掉，但字一个不少", () => {
    expect(at(parseSo360Html(SO360_HTML), 0).title).toBe("黑暗森林法则_360百科");
  });

  it("频控页被认出来（200 + 「访问异常」），不当成「搜了但没结果」", () => {
    expect(isThrottled360Page(SO360_THROTTLED)).toBe(true);
    expect(isThrottled360Page(SO360_HTML)).toBe(false);
    expect(isThrottled360Page("")).toBe(false);
  });
});

describe("360 自己塞进来的噪音卡不是来源（2026-10-06 真机端到端逮到）", () => {
  // 这一组三条来自真机那次端到端：搜「黑暗森林法则是什么」，六条里有两条是这种东西。
  const query = "黑暗森林法则是什么";
  const echoCard = {
    title: "黑暗森林法则是什么?",
    url: "https://www.so.com/link?m=eXl5hd2b0mPJRfj%2BHcLnBbSD",
    snippet: ""
  };
  const aiCard = {
    title: "黑暗森林法则是什么",
    url: "https://ai.so.com/search/so9543ac5d0554f05de00f246fb62f8a32?search=%E9",
    snippet: "黑暗森林法则用一个隐喻描述了宇宙的面貌……"
  };
  const videoCard = {
    title: "黑暗森林法则是什么-短视频大全-高清在线观看",
    url: "https://www.so.com/link?m=bHoGBZs%2BtZV80waaJIqbXfXxkFZkeMAAnKTXAy83RF",
    snippet: ""
  };

  it("标题就是问题本身的「问题卡」判成噪音（差一个全角问号也算）", () => {
    expect(isSo360NoiseCard(echoCard, query)).toBe(true);
    expect(isSo360NoiseCard({ ...echoCard, title: "黑暗森林法则是什么" }, query)).toBe(true);
    expect(isSo360NoiseCard({ ...echoCard, title: "黑暗森林法则是什么?" }, query)).toBe(true);
  });

  it("落在 360 自己搜索/AI/短视频端点上的判成噪音", () => {
    expect(isSo360NoiseCard(aiCard, query)).toBe(true);
    expect(isSo360NoiseCard(videoCard, query)).toBe(true);
  });

  it("真内容页一律留下：标题相关、主机名在站外", () => {
    expect(
      isSo360NoiseCard(
        {
          title: "黑暗森林法则深度解析-今日头条",
          url: "https://www.toutiao.com/article/123",
          snippet: ""
        },
        query
      )
    ).toBe(false);
    // 360 自己的百科**有内容**，不能连坐成噪音。
    expect(
      isSo360NoiseCard(
        {
          title: "黑暗森林法则_360百科",
          url: "https://baike.so.com/doc/5586742.html",
          snippet: ""
        },
        query
      )
    ).toBe(false);
  });

  it("源这一层把噪音卡滤掉，回执里只剩真来源", async () => {
    const fetchImpl: WebFetchLike = async () =>
      new Response(
        `<li class="res-list"><h3 class="res-title"><a href="${aiCard.url}">${aiCard.title}</a></h3><p class="res-desc">${aiCard.snippet}</p></li>` +
          `<li class="res-list"><h3 class="res-title"><a href="https://baike.so.com/doc/5586742.html">黑暗森林法则_360百科</a></h3><p class="res-desc">刘慈欣在《三体II》引入的法则。</p></li>`,
        { status: 200 }
      );
    const attempt = await so360Source.run(query, fetchImpl);
    expect(attempt.ok).toBe(true);
    expect(attempt.ok && attempt.results.map((r) => r.title)).toEqual(["黑暗森林法则_360百科"]);
  });

  /**
   * 真机端到端那一次的**原样**六条，按 360 真实页面结构还原后走一遍完整链路。
   * 单测 `isSo360NoiseCard` 只验了判据本身；这条验的是**判据接在链路上的位置对不对**
   * ——漏了它，噪音卡照样会进回执（上一版就是这样：六条里两条是这种）。
   */
  it("真机那六条走完整链路：只剩三条真来源，回执短了一截", () => {
    const blob = `https://www.so.com/link?m=${"eXl5hd2b0mPJRfj%2BHcLnBbSD%2Bg0JDQ".repeat(5)}`;
    const raw = [
      {
        title: "黑暗森林法则 - MBA智库百科",
        url: blob,
        snippet: "一旦某个文明被发现，就必然遭到其他文明的打击。"
      },
      {
        title: "黑暗森林法则(科幻小说《三体Ⅱ 黑暗森林》中的设定)百科",
        url: "https://baike.so.com/doc/5586742-32338966.html",
        snippet: "刘慈欣在《三体II》引入的法则。"
      },
      { title: "黑暗森林法则是什么?", url: aiCard.url, snippet: "" },
      {
        title: "黑暗森林法则是什么",
        url: aiCard.url.replace("9543", "39a7"),
        snippet: aiCard.snippet
      },
      {
        title: "黑暗森林法则深度解析-今日头条",
        url: "https://www.so.com/link?m=bCxJdrAM3UJPuAUxbjm6bgnqj66Sctx2%2F9f9kdJZ7h",
        snippet: "主要分为三个步骤。"
      },
      { title: videoCard.title, url: videoCard.url, snippet: "" }
    ];
    const html = raw
      .map(
        (r) =>
          `<li class="res-list"><h3 class="res-title"><a href="${r.url}">${r.title}</a></h3>` +
          (r.snippet === ""
            ? ""
            : `<p class="res-desc"><span class="res-list-summary">${r.snippet}</span></p>`) +
          `</li>`
      )
      .join("");
    const parsed = parseSo360Html(html);
    const kept = parsed.filter((r) => !isSo360NoiseCard(r, query));
    expect(kept.map((r) => r.title)).toEqual([
      "黑暗森林法则 - MBA智库百科",
      "黑暗森林法则(科幻小说《三体Ⅱ 黑暗森林》中的设定)百科",
      "黑暗森林法则深度解析-今日头条"
    ]);

    const receipt = webSearchReceipt({
      sourceId: "so-360",
      sourceLabel: "360 搜索",
      results: kept,
      attempted: 2,
      skipped: [],
      deduped: 0
    });
    // 那条 450 字符的跳转链不再整段进上下文，回执里每个链接都只有一行。
    expect(receipt).not.toContain(blob);
    for (const line of receipt.split("\n"))
      expect(line.length, `这一行太长：${line.slice(0, 40)}…`).toBeLessThanOrEqual(
        WEB_SEARCH_URL_LIMIT + 40
      );
  });
});

describe("结果归一", () => {
  it("同一条结果的跟踪参数不同也只留一条", () => {
    const merged = normalizeResults([
      { title: "标题", url: "https://a.example/one?form=QBLH", snippet: "一" },
      { title: "标题", url: "https://a.example/one?sp=-1", snippet: "二" },
      { title: "标题", url: "https://a.example/one", snippet: "三" },
      { title: "另一个", url: "https://b.example/two", snippet: "四" }
    ]);
    expect(merged).toHaveLength(2);
    expect(at(merged, 0).snippet).toBe("一");
  });

  it("非 http/https 的链接整条丢掉（javascript:、协议相对、相对路径都不进回执）", () => {
    const out = normalizeResults([
      { title: "坏一", url: "javascript:alert(1)", snippet: "" },
      { title: "坏二", url: "//example.com/x", snippet: "" },
      { title: "好", url: "https://a.example/1", snippet: "s" }
    ]);
    expect(out).toHaveLength(1);
    expect(at(out, 0).title).toBe("好");
  });

  it("长摘要截断并留省略号，断点落在标点上", () => {
    // 逗号放在 140 字处（上限 220 的 63%），截断点因此落在标点上而不是硬切在半句中间。
    const long = `${"深海".repeat(70)}，${"浪".repeat(120)}，尾巴`;
    expect(long.length).toBeGreaterThan(WEB_SEARCH_SNIPPET_LIMIT);
    const first = at(normalizeResults([{ title: "t", url: "https://a/1", snippet: long }]), 0);
    expect(first.snippet).toBe(`${"深海".repeat(70)}…`);
    expect(first.snippet).not.toContain("浪");
  });

  it("没有标点可断时按字数硬切，不把半截话当完整摘要", () => {
    const long = "深海".repeat(200);
    const first = at(normalizeResults([{ title: "t", url: "https://a/1", snippet: long }]), 0);
    expect(first.snippet).toBe(`${"深海".repeat(WEB_SEARCH_SNIPPET_LIMIT / 2)}…`);
    expect(first.snippet.length).toBe(WEB_SEARCH_SNIPPET_LIMIT + 1);
  });

  it("恰好在上限内的摘要一个字都不动", () => {
    const exact = "长".repeat(WEB_SEARCH_SNIPPET_LIMIT);
    expect(
      at(normalizeResults([{ title: "t", url: "https://a/1", snippet: exact }]), 0).snippet
    ).toBe(exact);
  });

  it("条数封顶在 WEB_SEARCH_RESULTS_LIMIT", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      title: `第${i}条`,
      url: `https://a.example/${i}`,
      snippet: `摘要${i}`
    }));
    expect(normalizeResults(many)).toHaveLength(WEB_SEARCH_RESULTS_LIMIT);
  });
});

describe("回执排版", () => {
  const outcome = (results: WebSearchResult[], attempted = 1, deduped = 0): WebSearchOutcome => ({
    sourceId: "so-360",
    sourceLabel: "360 搜索",
    results,
    attempted,
    skipped: [],
    deduped
  });

  it("超长跳转链在回执里截断并标明（真机实测单条能到 450 字符，六条就是两千多字符的 base64）", () => {
    const blob = `https://www.so.com/link?m=${"eXl5hd2b0mPJRfj".repeat(30)}`;
    expect(blob.length).toBeGreaterThan(WEB_SEARCH_URL_LIMIT * 3);
    const text = webSearchReceipt(outcome([{ title: "黑暗森林法则", url: blob, snippet: "摘要" }]));
    const line = text.split("\n").find((l) => l.includes("跳转链")) ?? "";
    expect(line.length).toBeLessThanOrEqual(WEB_SEARCH_URL_LIMIT + 20);
    expect(line).toContain("跳转链");
    expect(text).not.toContain(blob);
    // 完整地址没丢：它一路带在 sources 里，界面上点一下就是完整那条。
    expect(outcome([{ title: "t", url: blob, snippet: "" }]).results[0]?.url).toBe(blob);
  });

  it("短链接原样显示，链接那一行不加任何截断标记", () => {
    const text = webSearchReceipt(
      outcome([
        { title: "黑暗森林法则_360百科", url: "https://baike.so.com/doc/1.html", snippet: "" }
      ])
    );
    // 只看链接那一行（回执里链接是缩进五格起的）：页脚那句「部分链接是搜索站的跳转链」
    // 是**说明**，不算截断标记；来源键那行也含域名，不能靠「含 baike.so.com」去找。
    const urlLine = text.split("\n").find((l) => l.startsWith("     https://")) ?? "";
    expect(urlLine).toBe("     https://baike.so.com/doc/1.html");
    expect(urlLine).not.toContain("…");
  });

  it("首选源直接答上时不提「试了几个」，退到第二个才说", () => {
    const r = [{ title: "t", url: "https://a/1", snippet: "" }];
    expect(webSearchReceipt(outcome(r, 1))).toContain("来源：360 搜索\n");
    expect(webSearchReceipt(outcome(r, 2))).toContain("（试了 2 个源，前面几个用不了）");
  });

  it("引用键是链接的身份而不是位置：同一张回执里两条不同的结果必得不同的键", () => {
    const text = webSearchReceipt(
      outcome([
        { title: "甲", url: "https://a.test/one", snippet: "" },
        { title: "乙", url: "https://b.test/two", snippet: "" }
      ])
    );
    const keys = [...text.matchAll(/^\[([^\]]+)\]/gm)].map((m) => m[1]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(sourceKey("https://a.test/one"));
    expect(keys[1]).toBe(sourceKey("https://b.test/two"));
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("明确要求模型按来源键引用、并说清为什么不能写序号", () => {
    const text = webSearchReceipt(outcome([{ title: "t", url: "https://a/1", snippet: "" }]));
    expect(text).toContain("来源键");
    expect(text).toContain("别用序号");
    expect(text).toContain("序号会撞车");
    expect(text).toContain("可按来源键点开核对");
    // 页脚里不许出现编出来的举例键：模型会照着引，而界面上根本没有那一条。
    expect(text).not.toMatch(/（如 [a-z0-9.-]+-[0-9a-f]{4}）/);
  });

  it("这次剔掉了重复项时，回执头里如实说是几条", () => {
    const r = [{ title: "t", url: "https://a/1", snippet: "" }];
    expect(webSearchReceipt(outcome(r, 1, 0))).not.toContain("重复");
    expect(webSearchReceipt(outcome(r, 1, 2))).toContain("本次有 2 条与上一次搜索重复，已略去");
  });
});

describe("冷却按连续失败翻倍（实测窗口 >23 分钟，固定十分钟等于没有冷却）", () => {
  it("越撞越久：10 → 20 → 40 → 封顶 60 分钟", async () => {
    let now = 0;
    const stubborn = source("s", async () => fail("unavailable", "触发了访问频控"));
    const run = () => webSearch("x", { now: () => now, fetchImpl: never(), sources: [stubborn] });
    const MIN = 60_000;

    // 每一次都真撞一次墙，然后问一句「还差多久」——退避翻倍这件事，用户就是从这句话上看出来的。
    for (const expected of [10, 20, 40, 60, 60]) {
      await expect(run(), `第 ${expected} 轮`).rejects.toThrow(/触发了访问频控/);
      now += 1;
      await expect(run(), `第 ${expected} 轮之后`).rejects.toThrow(
        new RegExp(`最长还要等 ${expected} 分钟`)
      );
      now += expected * MIN + 1; // 等满冷却，让下一轮真的能试
    }
  });

  it("答上一次就把连续失败清零，不一路涨到封顶", async () => {
    let now = 0;
    let healthy = false;
    const flaky = source("f", async () =>
      healthy ? ok([{ title: "t", url: "https://a/1", snippet: "" }]) : fail("network", "连不上")
    );
    const run = () => webSearch("x", { now: () => now, fetchImpl: never(), sources: [flaky] });

    // 连续三次失败，冷却应当依次变长
    await expect(run()).rejects.toThrow();
    now += SOURCE_COOLDOWN_MS + 1;
    await expect(run()).rejects.toThrow();
    now += SOURCE_COOLDOWN_MS * 2 + 1;
    await expect(run()).rejects.toThrow();

    // 源恢复了 → 成功
    healthy = true;
    now += SOURCE_COOLDOWN_MS * 4 + 1;
    const ok1 = await run();
    expect(ok1.sourceId).toBe("f");

    // 之后又失败一次：冷却应当回到**基础**十分钟，而不是接着上一次翻到四十分钟。
    // 判据就是「清零了没有」——不清零的话，一次偶发抖动会把源锁很久，那是惩罚早就恢复的源。
    healthy = false;
    now += 1;
    await expect(run()).rejects.toThrow();
    now += SOURCE_COOLDOWN_MS + 1; // 只让基础十分钟过去
    healthy = true;
    const ok2 = await run();
    expect(ok2.sourceId).toBe("f");
  });

  it("冷却满时说的是还差多久，不是笼统的「等几分钟」", async () => {
    let now = 0;
    const stubborn = source("s", async () => fail("unavailable", "触发了访问频控"));
    const run = () => webSearch("x", { now: () => now, fetchImpl: never(), sources: [stubborn] });

    await expect(run()).rejects.toThrow(/触发了访问频控/);
    // 失败三轮把冷却涨到封顶，再问一次就该看到「最长还要等 60 分钟」
    now += SOURCE_COOLDOWN_MAX_MS + 1;
    await expect(run()).rejects.toThrow();
    now += SOURCE_COOLDOWN_MAX_MS + 1;
    await expect(run()).rejects.toThrow();
    now += SOURCE_COOLDOWN_MAX_MS + 1;
    await expect(run()).rejects.toThrow();
    now += 5_000;
    await expect(run()).rejects.toThrow(/最长还要等 60 分钟/);
  });
});

describe("源链", () => {
  it("首选源通了就不碰第二个，attempted=1", async () => {
    const calls: string[] = [];
    const outcome = await webSearch("深海", {
      now: () => 0,
      fetchImpl: never(),
      sources: [
        source("first", async () => {
          calls.push("first");
          return ok([{ title: "t", url: "https://a/1", snippet: "s" }]);
        }),
        source("second", async () => {
          calls.push("second");
          return ok([]);
        })
      ]
    });
    expect(calls).toEqual(["first"]);
    expect(outcome.sourceId).toBe("first");
    expect(outcome.attempted).toBe(1);
    expect(outcome.skipped).toEqual([]);
  });

  it("首选源用不了时自动退到第二个", async () => {
    const outcome = await webSearch("深海", {
      now: () => 0,
      fetchImpl: never(),
      sources: [
        source("a", async () => fail("network", "连接超时")),
        source("b", async () => ok([{ title: "t", url: "https://a/1", snippet: "s" }]))
      ]
    });
    expect(outcome.sourceId).toBe("b");
    expect(outcome.attempted).toBe(2);
  });

  it("首选源返回 0 条（页面正常但没结果）也退到第二个，不把「没找到」当成终局", async () => {
    const outcome = await webSearch("深海", {
      now: () => 0,
      fetchImpl: never(),
      sources: [
        source("a", async () => ok([])),
        source("b", async () => ok([{ title: "t", url: "https://a/1", snippet: "s" }]))
      ]
    });
    expect(outcome.sourceId).toBe("b");
    expect(outcome.attempted).toBe(2);
  });

  it("连不上的源进冷却：十分钟内不再试（别让每轮搜索都先白等一个超时）", async () => {
    let tries = 0;
    // 这条用例只关心冷却与源链选择，而它连着搜三次同一个词——判重层会因为三次递回
    // 同一条结果而短路，那不是这里要测的东西。所以每次给一条不同的链接，避开那一层。
    let served = 0;
    const fresh = (tag: string): WebSearchResult[] => [
      { title: tag, url: `https://example.test/${tag}/${(served += 1)}`, snippet: "s" }
    ];
    const flaky: WebSearchSource = source("flaky", async () => {
      tries += 1;
      return tries === 1 ? fail("network", "连接超时") : ok(fresh("flaky"));
    });
    const backup: WebSearchSource = source("backup", async () => ok(fresh("backup")));
    const sources = [flaky, backup];

    let now = 1_000;
    const run = () => webSearch("深海", { now: () => now, fetchImpl: never(), sources });

    await run();
    expect(tries).toBe(1);

    // 冷却期内：flaky 整轮被跳过，skipped 如实记一条。
    const second = await run();
    expect(tries).toBe(1);
    expect(second.sourceId).toBe("backup");
    expect(second.skipped).toEqual(["flaky"]);

    // 冷却一过：重新纳入尝试，flaky 这回通了。
    now += SOURCE_COOLDOWN_MS + 1;
    const third = await run();
    expect(tries).toBe(2);
    expect(third.sourceId).toBe("flaky");
    expect(third.skipped).toEqual([]);
  });

  it("被频控的源也进冷却（再打过去只会更糟）", async () => {
    let tries = 0;
    const throttled: WebSearchSource = source("t", async () => {
      tries += 1;
      return tries === 1 ? fail("unavailable", "触发了访问频控") : fail("network", "连接超时");
    });
    const sources = [throttled, source("b", async () => fail("network", "连不上"))];
    const run = () => webSearch("x", { now: () => 0, fetchImpl: never(), sources });

    await expect(run()).rejects.toThrow();
    expect(tries).toBe(1);
    await expect(run()).rejects.toThrow();
    // 第二次被冷却挡住了，tries 没有涨。
    expect(tries).toBe(1);
  });

  it("「这页没结果」不进冷却（换个词还能搜，不该锁十分钟）", async () => {
    let tries = 0;
    const picky: WebSearchSource = source("p", async () => {
      tries += 1;
      return fail("empty", "页面上没解析出结果");
    });
    const sources = [picky, source("b", async () => fail("network", "连不上"))];
    const run = () => webSearch("x", { now: () => 0, fetchImpl: never(), sources });

    await expect(run()).rejects.toThrow();
    expect(tries).toBe(1);
    await expect(run()).rejects.toThrow();
    expect(tries).toBe(2);
  });

  it("源都能用但都没搜到时，提示的是「换关键词」而不是「搜索源用不了」", async () => {
    await expect(
      webSearch("不存在的词", {
        now: () => 0,
        fetchImpl: never(),
        sources: [
          source("a", async () => ok([])),
          source("b", async () => fail("empty", "页面上没解析出结果"))
        ]
      })
    ).rejects.toThrow(/没搜到「不存在的词」的相关结果/);
  });

  it("全源都挂时抛的是中文，且带上每个源的失败原因", async () => {
    await expect(
      webSearch("深海", {
        now: () => 0,
        fetchImpl: never(),
        sources: [
          source("a", async () => fail("network", "连接超时")),
          source("b", async () => fail("unavailable", "触发了访问频控"))
        ]
      })
    ).rejects.toThrow(/a：连接超时；b：触发了访问频控/);
  });

  it("全源都在冷却里时，提示的是「等几分钟」而不是「搜不到」", async () => {
    const dead = source("dead", async () => fail("network", "连接超时"));
    const run = () => webSearch("x", { now: () => 0, fetchImpl: never(), sources: [dead] });
    // 第一轮真试一次并把它打进冷却；第二轮才是「整轮都在冷却里」。
    await expect(run()).rejects.toThrow(/连接超时/);
    await expect(run()).rejects.toThrow(/冷却/);
  });

  it("失败的错误信息里不夹带 fetch failed 这类英文技术串", async () => {
    const boom = (): WebFetchLike => () => Promise.reject(new TypeError("fetch failed"));
    await expect(
      webSearch("深海", {
        now: () => 0,
        fetchImpl: boom(),
        sources: [duckduckgoSource, so360Source]
      })
    ).rejects.toThrow(/DuckDuckGo：连不上/);
  });
});

describe("两枚内置源的请求形状", () => {
  it("360 走 GET，带浏览器 UA、中文 Accept-Language 与 referer", async () => {
    let seen: { url: string; init: Record<string, unknown> } | null = null;
    const fetchImpl: WebFetchLike = async (url, init) => {
      seen = { url, init: init as Record<string, unknown> };
      return new Response(SO360_HTML, { status: 200 });
    };
    const attempt = await so360Source.run("深海 科幻", fetchImpl);
    expect(attempt.ok).toBe(true);
    const hit = seen as unknown as {
      url: string;
      init: { method: string; headers: Record<string, string>; signal: AbortSignal };
    };
    expect(hit.url.startsWith("https://www.so.com/s?q=")).toBe(true);
    expect(hit.url).toContain(encodeURIComponent("深海 科幻"));
    expect(hit.init.method).toBe("GET");
    expect(hit.init.headers["user-agent"]).toContain("Chrome/126");
    expect(hit.init.headers["accept-language"]).toContain("zh-CN");
    expect(hit.init.headers.referer).toContain("so.com");
    expect(hit.init.signal).toBeDefined();
  });

  it("DuckDuckGo 走 POST 表单（它对 GET 查询串风控更紧）", async () => {
    let method = "";
    let body = "";
    const fetchImpl: WebFetchLike = async (_url, init) => {
      method = init?.method ?? "";
      body = init?.body ?? "";
      return new Response(DDG_HTML, { status: 200 });
    };
    const attempt = await duckduckgoSource.run("深海", fetchImpl);
    expect(attempt.ok).toBe(true);
    expect(method).toBe("POST");
    expect(body).toBe(new URLSearchParams({ q: "深海" }).toString());
  });

  it("403 判成「不让我们用」而不是「连不上」", async () => {
    const fetchImpl: WebFetchLike = async () => new Response("", { status: 403 });
    expect(await duckduckgoSource.run("x", fetchImpl)).toEqual({
      ok: false,
      reason: "unavailable",
      message: "返回 403"
    });
  });

  it("页面正常但解析不出结果时说的是「没解析出结果」，不是「没搜到」", async () => {
    const fetchImpl: WebFetchLike = async () =>
      new Response("<html>没有结果块的页面</html>", { status: 200 });
    expect(await so360Source.run("x", fetchImpl)).toEqual({
      ok: false,
      reason: "empty",
      message: "页面上没解析出结果"
    });
  });
});
