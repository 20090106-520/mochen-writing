import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { scanBook } from "@mochen/fs-store";
import { sourceKey, type DocRef, type EditProposal, type PermissionMode } from "@mochen/contracts";
import { createDocToolHost } from "./doc-tools-host.js";
import type { WebSearchResult } from "./web-search.js";
import { WebSearchError } from "./web-search.js";
import { WebReadError, type WebReadOutcome } from "./web-read.js";

let root = "";
let docs: DocRef[] = [];
const CHAPTER = "chapters/01-开局.md";
const CHAPTER_TEXT = "第一段\n雾从海面涌上来。\n第三段\n雾又从海面涌上来。\n";
// 书外的真文件：路径尾巴和可写目录同形（chapters/*.md），且真实可读——
// 用它把「绝对路径的拒」钉成「既没进提案管道（baselines 空）、也没被改写（末尾再读一次）」，
// 而不是只对着一个不存在的路径形状自说自话。
let outsideRoot = "";
const OUTSIDE_REL = "chapters/01-开局.md";
const OUTSIDE_TEXT = "盘外之书：这段正文不属于本书，host 永远不该读到它。\n";
let collected: EditProposal[] = [];
let baselines: string[] = [];
let mode: PermissionMode = "read-only";
// web_search 的假实现按用例换装：默认空手而归；要测失败就置 webSearchError / webSearchRawError。
let webSearchResults: WebSearchResult[] = [];
let webSearchAttempted = 1;
let webSearchError: string | null = null;
let webSearchErrorKind: "unavailable" | "empty" = "unavailable";
/** 非 WebSearchError 的异常（模拟将来有人在源链里 new Error("fetch failed")）。 */
let webSearchRawError: Error | null = null;
// web_read 的假实现同理（2026-10-11）。
let webReadOutcome: WebReadOutcome | null = null;
let webReadError: WebReadError | null = null;
let webReadRawError: Error | null = null;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mochen-host-"));
  await mkdir(path.join(root, "chapters"), { recursive: true });
  await mkdir(path.join(root, "characters"), { recursive: true });
  await writeFile(path.join(root, CHAPTER), CHAPTER_TEXT, "utf8");
  await writeFile(path.join(root, "characters", "李深.md"), "身份：守闸人\n", "utf8");
  docs = await scanBook(root);
  outsideRoot = await mkdtemp(path.join(tmpdir(), "mochen-outside-"));
  await mkdir(path.join(outsideRoot, "chapters"), { recursive: true });
  await writeFile(path.join(outsideRoot, OUTSIDE_REL), OUTSIDE_TEXT, "utf8");
});
beforeEach(async () => {
  await writeFile(path.join(root, ...CHAPTER.split("/")), CHAPTER_TEXT, "utf8");
  collected = [];
  baselines = [];
  mode = "read-only";
  webSearchResults = [];
  webSearchAttempted = 1;
  webSearchError = null;
  webSearchErrorKind = "unavailable";
  webSearchRawError = null;
  webReadOutcome = null;
  webReadError = null;
  webReadRawError = null;
});

function host() {
  return createDocToolHost({
    root: () => root,
    docs: () => docs,
    context: () => ({ docRelPath: CHAPTER, permissionMode: mode, workMode: "act" }),
    onProposal: (proposal, baseline) => {
      collected.push(proposal);
      baselines.push(baseline);
    },
    newId: (() => {
      let n = 0;
      return () => `p${(n += 1)}`;
    })(),
    now: () => "2026-10-01T08:00:00.000Z",
    webSearch: async () => {
      if (webSearchRawError !== null) throw webSearchRawError;
      if (webSearchError !== null) throw new WebSearchError(webSearchError, webSearchErrorKind);
      return {
        sourceId: "test",
        sourceLabel: "测试源",
        results: webSearchResults,
        attempted: webSearchAttempted,
        skipped: [],
        deduped: 0
      };
    },
    webRead: async () => {
      if (webReadRawError !== null) throw webReadRawError;
      if (webReadError !== null) throw webReadError;
      return webReadOutcome as WebReadOutcome;
    }
  });
}

describe("read_doc / list_docs / search_docs", () => {
  it("read_doc 返回全文与字数", async () => {
    const out = await host().call("read_doc", { doc: CHAPTER });
    expect(out.ok).toBe(true);
    expect(out.text).toContain("雾从海面涌上来。");
    expect(out.proposals).toEqual([]);
  });

  it("长文按 6000 字截断并说明被截断", async () => {
    await writeFile(path.join(root, ...CHAPTER.split("/")), "雾".repeat(9000), "utf8");
    const out = await host().call("read_doc", { doc: CHAPTER });
    expect(out.text).toContain("已截断");
    expect(out.text.length).toBeLessThan(9000);
  });

  it("恰好 6000 字是边界：不截断、原样返回全文", async () => {
    await writeFile(path.join(root, ...CHAPTER.split("/")), "雾".repeat(6000), "utf8");
    const out = await host().call("read_doc", { doc: CHAPTER });
    expect(out.ok).toBe(true);
    expect(out.text).not.toContain("已截断");
    expect(out.text).toBe("雾".repeat(6000));
  });

  it("未知路径给出可读错误并提示可用清单", async () => {
    const out = await host().call("read_doc", { doc: "chapters/不存在.md" });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("读不到");
  });

  it("list_docs 按类型过滤", async () => {
    const all = await host().call("list_docs", {});
    const characters = await host().call("list_docs", { kind: "character" });
    expect(all.text).toContain(CHAPTER);
    expect(characters.text).toContain("characters/李深.md");
    expect(characters.text).not.toContain(CHAPTER);
  });

  it("search_docs 给出行号", async () => {
    const out = await host().call("search_docs", { query: "守闸人" });
    expect(out.ok).toBe(true);
    expect(out.text).toContain("characters/李深.md:1:");
  });

  it("search_docs 的 query 是空串时拒绝，而不是拿空串去全书逐行匹配", async () => {
    // 空串 line.includes("") 恒真：少了这条守卫，回执会变成「命中 N 处」的全书倾倒。
    const out = await host().call("search_docs", { query: "" });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("非空");
    expect(out.proposals).toEqual([]);
  });

  it("search_docs 精确零命中后按一字之差容错，并如实写明这是容错命中", async () => {
    // 盘上是「守闸人」，query 差一个字：精确匹配零命中，第二轮容错兜底。
    const out = await host().call("search_docs", { query: "守闸入" });
    expect(out.ok).toBe(true);
    expect(out.text).toContain("容错命中");
    expect(out.text).toContain("characters/李深.md:1:");
  });

  it("search_docs 精确命中时不跑容错轮；确实不存在时回「没有命中」且不提容错", async () => {
    const exact = await host().call("search_docs", { query: "守闸人" });
    expect(exact.text).not.toContain("容错");
    const miss = await host().call("search_docs", { query: "绝不会出现的词" });
    expect(miss.ok).toBe(true);
    expect(miss.text).toContain("没有命中");
    expect(miss.text).not.toContain("容错");
  });
});

describe("web_search", () => {
  it("空 query 拒绝（与 search_docs 同一条守门逻辑）", async () => {
    const out = await host().call("web_search", {});
    expect(out.ok).toBe(false);
    expect(out.text).toContain("非空");
    expect(out.proposals).toEqual([]);
  });

  it("成功回执按来源键列出标题/链接/摘要，只读、零提案，并把来源一并交给界面", async () => {
    webSearchResults = [
      {
        title: "修真世界的灵气设定",
        url: "https://example.com/a",
        snippet: "灵气复苏的常见写法……"
      },
      { title: "无摘要的结果", url: "https://example.com/b", snippet: "" }
    ];
    const out = await host().call("web_search", { query: "灵气复苏 写法" });
    expect(out.ok).toBe(true);
    expect(out.text).toContain("来源：测试源");
    // 编号是来源键而不是序号：同一轮里模型可能换词重搜好几次，两张回执各自从 [1]
    // 数起就会让模型写出的「据来源[1]」指代不明（批次 5-⑩）。
    expect(out.text).toContain(`[${sourceKey("https://example.com/a")}] 修真世界的灵气设定`);
    expect(out.text).toContain("https://example.com/a");
    expect(out.text).toContain("灵气复苏的常见写法……");
    expect(out.text).toContain(`[${sourceKey("https://example.com/b")}] 无摘要的结果`);
    expect(out.text).toContain("来源键");
    expect(out.proposals).toEqual([]);
    // sources 是给界面点的数据，与 text 同源：少传一份，工具卡就只剩一坨纯文本。
    expect(out.sources).toEqual(webSearchResults);
  });

  it("首选源没答上时，回执如实说明是第几个源、前面几个用不了", async () => {
    webSearchAttempted = 2;
    webSearchResults = [{ title: "命中", url: "https://example.com/c", snippet: "s" }];
    const out = await host().call("web_search", { query: "随便" });
    expect(out.text).toContain("来源：测试源（试了 2 个源，前面几个用不了）");
  });

  it("一无所获时不是报错，而是如实说「没有搜到」", async () => {
    const out = await host().call("web_search", { query: "冷门词条" });
    expect(out.ok).toBe(true);
    expect(out.text).toContain("没搜到「冷门词条」的相关结果");
    expect(out.text).toContain("换几个关键词再搜一次");
  });

  it("「源都能用只是没搜着」是 ok 的正常回执，不是失败（模型的下一个动作是换词）", async () => {
    webSearchError = "搜索源都能用，但没搜到「冷门词条」的相关结果——换几个关键词再搜一次。";
    webSearchErrorKind = "empty";
    const out = await host().call("web_search", { query: "冷门词条" });
    expect(out.ok).toBe(true);
    expect(out.text).toContain("换几个关键词再搜一次");
    expect(out.text).not.toContain("联网搜索失败");
  });

  it("源坏了回中文理由（可重试/可继续干活），不让模型拿到裸异常", async () => {
    webSearchError = "DuckDuckGo 连不上；360 搜索 触发了访问频控。";
    const out = await host().call("web_search", { query: "随便" });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("联网搜索失败");
    expect(out.text).toContain("DuckDuckGo 连不上");
  });

  it("句子只收一个句号（真机截出来过「继续工作。。」，源侧那句自带句号）", async () => {
    // 判据是「以一个终结符收尾」，不是「以 . 收尾」：源侧的消息有的以「。」结尾、
    // 有的以「…」结尾，两种都不该再被补一刀。
    const endsCleanly = (text: string) => {
      expect(text.endsWith("。。")).toBe(false);
      expect(text).toMatch(/[。.…！？!?]$/);
    };
    webSearchError = "DuckDuckGo 连不上；360 搜索 触发了访问频控。可以换个说法再搜。";
    endsCleanly((await host().call("web_search", { query: "随便" })).text);

    webSearchError = "DuckDuckGo 连不上；360 搜索 触发了访问频控……";
    endsCleanly((await host().call("web_search", { query: "随便" })).text);

    // 没有终结符的那条（兜底文案）照补一个，句子照样是完整的。
    webSearchRawError = new TypeError("fetch failed");
    endsCleanly((await host().call("web_search", { query: "随便" })).text);
  });

  it("非 WebSearchError 的异常一律换成中文兜底，英文技术串一个字都不许漏到界面", async () => {
    // 这条钉的是「有人将来在源链里 new Error(\"fetch failed\")」这个场景。
    webSearchRawError = new TypeError("fetch failed");
    const out = await host().call("web_search", { query: "随便" });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("联网搜索失败");
    expect(out.text).not.toContain("fetch failed");
    expect(out.text).not.toContain("TypeError");
  });
});

describe("web_read", () => {
  it("成功回执：报出页面标题、正文、来源键，零提案，这一页本身进 sources", async () => {
    webReadOutcome = {
      title: "漕运制度考",
      url: "https://example.com/caoyun",
      text: "漕运始于秦汉，盛于明清……",
      truncated: false
    };
    const out = await host().call("web_read", { url: "https://example.com/caoyun" });
    expect(out.ok).toBe(true);
    expect(out.text).toContain("已读取「漕运制度考」");
    expect(out.text).toContain("漕运始于秦汉");
    expect(out.text).toContain(sourceKey("https://example.com/caoyun"));
    expect(out.proposals).toEqual([]);
    expect(out.sources).toEqual([
      { title: "漕运制度考", url: "https://example.com/caoyun", snippet: "" }
    ]);
  });

  it("正文过长：截断要在回执里说出来，不许半截话假装全文", async () => {
    webReadOutcome = {
      title: "长页",
      url: "https://example.com/long",
      text: "长".repeat(9000),
      truncated: true
    };
    const out = await host().call("web_read", { url: "https://example.com/long" });
    expect(out.ok).toBe(true);
    expect(out.text).toContain("只取前 6000 字");
  });

  it("空 url 拒绝", async () => {
    const out = await host().call("web_read", {});
    expect(out.ok).toBe(false);
    expect(out.text).toContain("非空");
  });

  it("非 http/https 的链接拒绝（bad-url）：重试无意义，换链接才有意义", async () => {
    webReadError = new WebReadError(
      "这不是一条可读的网页链接（只收 http/https）——换 web_search 结果里的原文链接。",
      "bad-url"
    );
    const out = await host().call("web_read", { url: "file:///C:/x" });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("只收 http/https");
  });

  it("剥不出正文是「跑通了但空手」（empty），不是失败——模型的下一步是换来源", async () => {
    webReadError = new WebReadError("这一页剥不出正文（可能是纯脚本渲染的页面）……", "empty");
    const out = await host().call("web_read", { url: "https://example.com/spa" });
    expect(out.ok).toBe(true);
    expect(out.text).toContain("剥不出正文");
  });

  it("连不上/超时/非 HTML 回中文失败理由，模型可换来源继续", async () => {
    webReadError = new WebReadError("这一页连接超时，稍后再试或换一条来源。", "fetch-failed");
    const out = await host().call("web_read", { url: "https://example.com/slow" });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("连接超时");
  });

  it("非 WebReadError 的异常换中文兜底，英文技术串不漏到界面", async () => {
    webReadRawError = new TypeError("fetch failed");
    const out = await host().call("web_read", { url: "https://example.com/x" });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("网页读取失败");
    expect(out.text).not.toContain("fetch failed");
  });
});

describe("propose_patch", () => {
  it("锚点唯一时产出 pending 提案，文件字节一字不变（全案最硬的断言）", async () => {
    const before = await chapterFile();
    const out = await host().call("propose_patch", {
      doc: CHAPTER,
      anchor: "第三段",
      replace: "第三段，铁锈味很冲。",
      why: "补一句可感的细节"
    });
    expect(out.ok).toBe(true);
    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0]?.mode).toBe("anchor-replace");
    expect(out.proposals[0]?.expectedFingerprint.length).toBe(64);
    expect(out.text).toContain("等待用户审批");
    expect(await chapterFile()).toBe(before);
    expect(collected).toEqual(out.proposals);
    // baseline 是提案生成那一刻读到的正文，Task 11 的 diffOf 用它算 diff
    expect(baselines).toEqual([before]);
  });

  it("裁定：read-only 档下 propose_patch 仍然恰好产出一条提案（权限档只闸 write_doc）", async () => {
    // beforeEach 把 mode 定回 read-only：提案一个字都不落盘，所以三档权限都不拦它。
    expect(mode).toBe("read-only");
    const before = await chapterFile();
    const out = await host().call("propose_patch", {
      doc: CHAPTER,
      anchor: "第一段",
      replace: "第一段·改",
      why: "钉住裁定"
    });
    expect(out.ok).toBe(true);
    expect(out.proposals).toHaveLength(1);
    expect(collected).toHaveLength(1);
    expect(out.text).toContain("等待用户审批");
    expect(await chapterFile()).toBe(before);
  });

  it("锚点出现两次时不产出提案，并把「锚点不唯一」回喂（§6.1 + 风险表第 3 行）", async () => {
    // 简报原锚「雾从海面涌上来。」在本夹具里只出现 1 次（第 4 行是「雾又从…」，不含该子串），
    // 原样必绿不了歧义路径；改为真实出现 2 次的最长子串「从海面涌上来。」，断言一字未动。
    const out = await host().call("propose_patch", {
      doc: CHAPTER,
      anchor: "从海面涌上来。",
      replace: "海雾涌上来。",
      why: "收紧"
    });
    expect(out.ok).toBe(false);
    expect(out.proposals).toEqual([]);
    expect(collected).toEqual([]);
    expect(out.text).toContain("出现 2 次");
  });

  it("anchor 与 replace 相同（空 diff）时拒绝：文字未发生变化，不产出提案", async () => {
    const before = await chapterFile();
    const out = await host().call("propose_patch", {
      doc: CHAPTER,
      anchor: "雾从海面涌上来。",
      replace: "雾从海面涌上来。",
      why: "原样替换"
    });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("文字未发生变化");
    expect(out.proposals).toEqual([]);
    expect(collected).toEqual([]);
    expect(await chapterFile()).toBe(before);
  });

  it("缺 why 时拒绝：用户在审批卡片上必须能看到中文理由", async () => {
    const out = await host().call("propose_patch", {
      doc: CHAPTER,
      anchor: "第一段",
      replace: "第一段·改"
    });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("中文理由");
    expect(out.proposals).toEqual([]);
    expect(collected).toEqual([]);
  });

  it("doc 与 why 齐、anchor/replace 都缺时不产提案，applyPatch 的中文「锚点为空」原样回喂模型", async () => {
    // host 不自己重写这句话（文案单点在 apply-patch.ts:42-48），只在后面附上「提案没有生成」的兜底说明。
    const out = await host().call("propose_patch", { doc: CHAPTER, why: "模型漏了锚点" });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("锚点为空");
    expect(out.proposals).toEqual([]);
    expect(collected).toEqual([]);
    expect(baselines).toEqual([]);
  });

  it("source 为 text-block 时提案记下来源", async () => {
    const out = await host().call("propose_patch", {
      doc: CHAPTER,
      anchor: "第一段",
      replace: "第一段·改",
      why: "文本块路来的",
      source: "text-block"
    });
    expect(out.proposals[0]?.source).toBe("text-block");
  });

  it("doc 不在五个文稿目录内时直接拒绝，连提案都不给", async () => {
    const out = await host().call("propose_patch", {
      doc: "book.json",
      anchor: "a",
      replace: "b",
      why: "试"
    });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("只允许写入");
    expect(collected).toEqual([]);
  });

  it("反斜杠路径在边界归一：chapters\\01-开局.md 照常产出提案且 docRelPath 为 posix", async () => {
    const out = await host().call("propose_patch", {
      doc: "chapters\\01-开局.md",
      anchor: "第一段",
      replace: "第一段·改",
      why: "模型吐了 Windows 路径"
    });
    expect(out.ok).toBe(true);
    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0]?.docRelPath).toBe(CHAPTER);
  });
});

describe("write_doc", () => {
  it("只读档下拒绝，并把中文理由作为工具回执回喂模型", async () => {
    const out = await host().call("write_doc", { doc: CHAPTER, content: "整篇重写", why: "试" });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("只读参考");
    expect(out.proposals).toEqual([]);
    expect(collected).toEqual([]);
    expect(await chapterFile()).toBe(CHAPTER_TEXT);
  });

  it("全开档下也只产出 doc-overwrite 提案，仍然不写盘", async () => {
    mode = "full-access";
    const out = await host().call("write_doc", { doc: CHAPTER, content: "整篇重写", why: "重建" });
    expect(out.ok).toBe(true);
    expect(out.proposals[0]?.mode).toBe("doc-overwrite");
    expect(out.proposals[0]?.tool).toBe("write_doc");
    expect(await chapterFile()).toBe(CHAPTER_TEXT);
  });

  it("全开档下 write_doc 写入与盘上一字不差的原文（空差异）被拒，不产出提案", async () => {
    // carry-in (a)（Task 5 → Task 10）：doc-overwrite 支的空差异门（host:183-184）与
    // anchor 支（host:211-212）是两条互斥路径，各需一条用例钉住；这条走 write_doc。
    mode = "full-access";
    const out = await host().call("write_doc", {
      doc: CHAPTER,
      content: CHAPTER_TEXT,
      why: "整篇按原文重写一遍"
    });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("文字未发生变化");
    expect(out.proposals).toEqual([]);
    expect(collected).toEqual([]);
    expect(baselines).toEqual([]);
    expect(await chapterFile()).toBe(CHAPTER_TEXT);
  });

  it("边界：Windows 绝对路径的 doc 在路径门就被拒，书外那个真文件既没被读也没被动", async () => {
    mode = "full-access";
    const outside = path.join(outsideRoot, ...OUTSIDE_REL.split("/"));
    const out = await host().call("write_doc", {
      doc: outside,
      content: "覆盖书外文件",
      why: "试着越过书目录"
    });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("非法路径");
    expect(out.proposals).toEqual([]);
    expect(collected).toEqual([]);
    // baselines 为空 = 没有任何书外正文被交给提案管道（读发生在门禁之后）
    expect(baselines).toEqual([]);
    expect(await readFile(outside, "utf8")).toBe(OUTSIDE_TEXT);
  });

  it("边界：POSIX 绝对路径的 doc（/etc/passwd 形）同样被路径门拒，零提案", async () => {
    mode = "full-access";
    const out = await host().call("write_doc", {
      doc: "/etc/passwd",
      content: "越界",
      why: "试着读系统文件"
    });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("非法路径");
    expect(out.proposals).toEqual([]);
    expect(collected).toEqual([]);
    expect(baselines).toEqual([]);
  });

  it("可改当前章档下，别章的 write_doc 被拒", async () => {
    mode = "chapter-write";
    const out = await host().call("write_doc", {
      doc: "characters/李深.md",
      content: "改",
      why: "试"
    });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("只能写入当前章");
  });

  it("反斜杠越界路径仍然 fail-closed：chapters\\..\\book.json 被拒且不产出提案", async () => {
    mode = "full-access";
    const out = await host().call("write_doc", {
      doc: "chapters\\..\\book.json",
      content: "越界",
      why: "试着越过目录"
    });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("非法路径");
    expect(out.proposals).toEqual([]);
    expect(collected).toEqual([]);
  });
});

describe("怪参数兜底（派发层把截断成 {} 的调用原样送来，绝不抛错）", () => {
  it("propose_patch 收到 {} 时回中文拒绝而不是抛错", async () => {
    const out = await host().call("propose_patch", {});
    expect(out.ok).toBe(false);
    expect(out.text).toContain("中文理由");
    expect(out.proposals).toEqual([]);
  });

  it("write_doc 收到 {} 时回中文拒绝而不是抛错", async () => {
    const out = await host().call("write_doc", {});
    expect(out.ok).toBe(false);
    expect(out.text).toContain("中文理由");
    expect(out.proposals).toEqual([]);
  });

  it("read_doc 收到 {} 时回中文拒绝而不是抛错", async () => {
    const out = await host().call("read_doc", {});
    expect(out.ok).toBe(false);
    expect(out.text).toContain("读不到");
    expect(out.proposals).toEqual([]);
  });

  it("非字符串字段按缺失处理：{doc: 123, why: true} 回中文拒绝而不是抛错", async () => {
    const out = await host().call("propose_patch", {
      doc: 123,
      why: true,
      anchor: "第一段",
      replace: "第一段·改"
    });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("中文理由");
    expect(out.proposals).toEqual([]);
  });
});

async function chapterFile(): Promise<string> {
  return readFile(path.join(root, ...CHAPTER.split("/")), "utf8");
}

describe("AI 味自动退稿闸（2026-10-10 二段）", () => {
  // 超标稿：240 字里 30 处重罪命中（套话 + 认知转述），密度远超闸阈值。
  const HEAVY = "他嘴角勾起，眼底闪过一丝复杂的情绪。他知道，这不是巧合。".repeat(10);

  it("write_doc 写正文且 AI 味超标 → 自动退稿，不生成提案", async () => {
    mode = "full-access";
    const out = await host().call("write_doc", { doc: CHAPTER, content: HEAVY, why: "重写开局" });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("自动退稿");
    expect(out.text).toContain("每千字");
    expect(out.text).toContain("嘴角勾起");
    expect(out.text).toContain("重写要求");
    expect(collected).toEqual([]);
  });

  it("同一稿原样重交 → 放行生成提案，回执带提醒（防死循环）", async () => {
    mode = "full-access";
    const h = host();
    const first = await h.call("write_doc", { doc: CHAPTER, content: HEAVY, why: "重写开局" });
    expect(first.ok).toBe(false);
    const second = await h.call("write_doc", { doc: CHAPTER, content: HEAVY, why: "重写开局" });
    expect(second.ok).toBe(true);
    expect(second.proposals).toHaveLength(1);
    expect(second.text).toContain("同一稿第二次提交");
  });

  it("改稿重交（内容变了）仍超标 → 再次退稿", async () => {
    mode = "full-access";
    const h = host();
    await h.call("write_doc", { doc: CHAPTER, content: HEAVY, why: "重写开局" });
    const rewritten = HEAVY + "他推开院门，把锄头靠在墙边。".repeat(20);
    const again = await h.call("write_doc", { doc: CHAPTER, content: rewritten, why: "改了一版" });
    expect(again.ok).toBe(false);
    expect(again.text).toContain("自动退稿");
  });

  it("设定文档（outline/）不闸：AI 腔的设定资料照样出提案", async () => {
    mode = "full-access";
    const out = await host().call("write_doc", {
      doc: "outline/第一卷大纲.md",
      content: HEAVY,
      why: "补设定"
    });
    expect(out.ok, out.text).toBe(true);
    expect(out.proposals).toHaveLength(1);
  });

  it("propose_patch 的正文替换片段超标 → 同样退稿", async () => {
    mode = "read-only";
    const out = await host().call("propose_patch", {
      doc: CHAPTER,
      mode: "anchor-replace",
      anchor: "雾从海面涌上来。",
      replace: HEAVY,
      why: "换一段"
    });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("自动退稿");
    expect(collected).toEqual([]);
  });

  it("撞了句式上限（一章两处对偶）→ 退稿信点破「句式超限」（2026-10-18 收紧）", async () => {
    mode = "full-access";
    // 生成端 ③ 写的是「一章最多一处」，退稿闸按同一枚数字判退；信里要把这条规则说到底——
    // 只说「AI 味超标」模型会当成熟度问题去稀释（真机那轮它自以为只用了一处）。
    const content = HEAVY + "他不是来偷东西的，是来灭灯的。这船不是来送货的，是来接人的。";
    const out = await host().call("write_doc", { doc: CHAPTER, content, why: "新章" });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("句式超限");
    expect(out.text).toContain("一章最多一处");
    expect(collected).toEqual([]);
  });

  it("轻度正文照常出提案：闸是质量下限，不是文风警察", async () => {
    mode = "full-access";
    // 长短句错落的正常叙述（六段起「句长过匀」是独立拦稿理由，
    // 旧样本两句循环复读，句长波动 0.21 会被节奏条正确拦下——那不是本用例要测的事）。
    const mild =
      "他推开院门，把锄头靠在墙边。灶间的火苗窜起来，锅里的粥咕嘟作响。天黑了。" +
      "风从篱笆的缺口灌进来，吹得那串干辣椒轻轻打转，像谁在数一串旧年的念珠。" +
      "他把碗摆上桌。粥还烫。隔壁的狗叫了两声，又安静下去。" +
      "他忽然想起白天在集市上听见的那句闲话——城南的渡口要封了，官船三日不发。" +
      "夜里的更声远远传来。他睡了。\n";
    const out = await host().call("write_doc", { doc: CHAPTER, content: mild, why: "重写开局" });
    expect(out.ok).toBe(true);
    expect(out.proposals).toHaveLength(1);
    expect(out.text).not.toContain("第二次提交");
  });
});

describe("退稿闸 · 换汤不换药点破（2026-10-10 四段）", () => {
  it("改了内容但仍超标的重交：退稿信点破「这一版和上一版几乎一样」", async () => {
    mode = "full-access";
    const h = host();
    const base = "他嘴角勾起，眼底闪过一丝复杂的情绪。他知道，这不是巧合。".repeat(10);
    await h.call("write_doc", { doc: CHAPTER, content: base, why: "初稿" });
    // 只换两个词的「重写」：内容变了（不是原样重交），但与上一版几乎一样。
    const cosmetic = base.replace(/嘴角勾起/g, "嘴角扬起");
    const again = await h.call("write_doc", { doc: CHAPTER, content: cosmetic, why: "改了一版" });
    expect(again.ok).toBe(false);
    expect(again.text).toContain("这一版和上一版几乎一样");
  });

  it("真换了写法的重交：退稿信不冤枉人，不提「几乎一样」", async () => {
    mode = "full-access";
    const h = host();
    const base = "他嘴角勾起，眼底闪过一丝复杂的情绪。他知道，这不是巧合。".repeat(10);
    await h.call("write_doc", { doc: CHAPTER, content: base, why: "初稿" });
    // 仍超标（好用语重灾区），但句式与初稿完全不同 ⇒ bigram 相似度低，不该被冤枉成换汤。
    const rewritten = "他深吸一口气，空气仿佛凝固。她深吸一口气，目光深邃。".repeat(10);
    const again = await h.call("write_doc", { doc: CHAPTER, content: rewritten, why: "真重写" });
    expect(again.ok, again.text).toBe(false);
    expect(again.text).not.toContain("几乎一样");
  });
});

describe("退稿闸 · 句式节奏条 + 连续退稿升级（2026-10-10 五段）", () => {
  it("词干净但节奏烂（每句都「他」开头）→ 也拦，退稿信点破节奏病灶", async () => {
    mode = "full-access";
    // 零词命中、每句「他」开头 × 10 句（约 240 字过 minChars）：词库放行、节奏条拦。
    const robotic = [
      "他推开吱呀作响的院门，把蓑衣挂上门后的木钩。",
      "他把锄头靠在墙边，拍了拍裤腿上的泥。",
      "他蹲在灶间生火，火苗舔着潮柴直冒白烟。",
      "他掀开米缸看了眼，还剩下小半缸。",
      "他添了半瓢水，把粥搅了两圈。",
      "他坐在灶口的小板凳上等开锅。",
      "他听见檐口的雨还在滴滴答答。",
      "他想起了白天在渡口看见的那条空船。",
      "他起身又添了一把柴。",
      "他把火拨小了些，等粥自己咕嘟。",
      "他把碗筷摆上桌，又数了数有几双。",
      "他吹了吹粥上的热气，先给自己盛了一碗。",
      "他隔着窗纱看了眼天色，估摸雨要到后半夜才停。"
    ].join("");
    const out = await host().call("write_doc", { doc: CHAPTER, content: robotic, why: "新章" });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("句式节奏");
    expect(out.text).toContain("「他」开头");
    expect(collected).toEqual([]);
  });

  it("连续第三次退稿 → 退稿信升级为「回到场景重构」的重话", async () => {
    mode = "full-access";
    const h = host();
    const base = "他嘴角勾起，眼底闪过一丝复杂的情绪。他知道，这不是巧合。".repeat(10);
    await h.call("write_doc", { doc: CHAPTER, content: base, why: "初稿" });
    const v2 = base.replace(/嘴角勾起/g, "嘴角扬起");
    await h.call("write_doc", { doc: CHAPTER, content: v2, why: "改一版" }); // 第二次（换汤提醒）
    const v3 = base.replace(/嘴角勾起/g, "嘴角翘起");
    const third = await h.call("write_doc", { doc: CHAPTER, content: v3, why: "再改一版" });
    expect(third.ok).toBe(false);
    expect(third.text).toContain("连续第 3 次退稿");
    expect(third.text).toContain("从头重写");
  });

  it("过闸即清零：第 4 次提交前先交一篇干净稿，升级话术不再出现", async () => {
    mode = "full-access";
    const h = host();
    const base = "他嘴角勾起，眼底闪过一丝复杂的情绪。他知道，这不是巧合。".repeat(10);
    await h.call("write_doc", { doc: CHAPTER, content: base, why: "初稿" });
    await h.call("write_doc", { doc: CHAPTER, content: base + "！", why: "第二版" });
    // 干净稿过闸（开头字轮换不踩节奏条，长短句错落不踩句长条）→ 连退计数归零。
    const clean =
      "他推开院门，把锄头靠在墙边。灶间的火苗窜起来，锅里的粥咕嘟作响。天黑了。" +
      "风从篱笆的缺口灌进来，吹得那串干辣椒轻轻打转，像谁在数一串旧年的念珠。" +
      "他把碗摆上桌。粥还烫。隔壁的狗叫了两声，又安静下去。" +
      "她忽然想起白天在集市上听见的那句闲话——城南的渡口要封了，官船三日不发。" +
      "夜里的更声远远传来。他睡了。\n";
    const passed = await h.call("write_doc", { doc: CHAPTER, content: clean, why: "真重写" });
    expect(passed.ok).toBe(true);
    // 再超标：从「第一次」重新数，没有升级话术。
    const again = await h.call("write_doc", { doc: CHAPTER, content: base, why: "又超了" });
    expect(again.ok).toBe(false);
    expect(again.text).not.toContain("连续第");
  });
});
