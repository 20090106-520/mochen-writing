import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { scanBook } from "@mochen/fs-store";
import {
  type AgentProfile,
  type BibleProposal,
  type DocRef,
  type EditProposal,
  type PermissionMode
} from "@mochen/contracts";
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
/** 设定提案（2026-11-20）：独立回调，与正文提案分开收。 */
let bibleCollected: BibleProposal[] = [];
let mode: PermissionMode = "read-only";
// P0-1：这一轮档案。null = 不传，走 ToolContext 的既有兜底（主笔），既有用例一字不动。
let profile: AgentProfile | null = null;
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
  bibleCollected = [];
  mode = "read-only";
  profile = null;
  webSearchResults = [];
  webSearchAttempted = 1;
  webSearchError = null;
  webSearchErrorKind = "unavailable";
  webSearchRawError = null;
  webReadOutcome = null;
  webReadError = null;
  webReadRawError = null;
});

/** 传 `false` 时**不**接设定提案回调：模拟「这一轮没接上通道」那支。 */
function host(withBible = true) {
  return createDocToolHost({
    root: () => root,
    docs: () => docs,
    context: () => ({
      docRelPath: CHAPTER,
      permissionMode: mode,
      workMode: "act",
      ...(profile === null ? {} : { profile })
    }),
    onProposal: (proposal, baseline) => {
      collected.push(proposal);
      baselines.push(baseline);
    },
    ...(withBible
      ? {
          onBibleProposal: (proposal: BibleProposal) => {
            bibleCollected.push(proposal);
          }
        }
      : {}),
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

  it("read_doc 可按行接着读：from + lines 只给这一段，头部写明行范围", async () => {
    const body = Array.from({ length: 60 }, (_, i) => `第${i + 1}行`).join("\n");
    await writeFile(path.join(root, ...CHAPTER.split("/")), body, "utf8");
    const out = await host().call("read_doc", { doc: CHAPTER, from: 51, lines: 10 });
    expect(out.ok).toBe(true);
    expect(out.text).toContain("第 51–60 行（共 60 行）");
    expect(out.text).toContain("第51行");
    expect(out.text).toContain("第60行");
    expect(out.text).not.toContain("第50行");
    expect(out.text).not.toContain("第61行");
  });

  it("from 超出总行数时给中文拒绝并报总行数", async () => {
    const body = Array.from({ length: 60 }, (_, i) => `第${i + 1}行`).join("\n");
    await writeFile(path.join(root, ...CHAPTER.split("/")), body, "utf8");
    const out = await host().call("read_doc", { doc: CHAPTER, from: 999 });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("超出范围");
    expect(out.text).toContain("60 行");
  });

  it("长文 + from 被截断时，提示从哪一行接着读", async () => {
    await writeFile(path.join(root, ...CHAPTER.split("/")), "雾".repeat(9000), "utf8");
    const out = await host().call("read_doc", { doc: CHAPTER, from: 1 });
    expect(out.ok).toBe(true);
    expect(out.text).toContain("已截断");
    expect(out.text).toContain("from=");
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
});

describe("propose_bible（2026-11-20：模型提出新设定，等用户批准）", () => {
  const args = {
    type: "character",
    title: "阿雾",
    content: "雾里出现的摆渡人，说话像潮水。",
    why: "第七章要她开口，设定库里还没有她。"
  };

  it("生成一条设定提案并交回调，回执说明「还没写进设定库」", async () => {
    const out = await host().call("propose_bible", args);
    expect(out.ok).toBe(true);
    expect(out.text).toContain("等待用户批准");
    expect(out.text).toContain("人物");
    expect(bibleCollected).toHaveLength(1);
    expect(bibleCollected[0]).toMatchObject({
      type: "character",
      title: "阿雾",
      content: args.content,
      why: args.why
    });
    // 设定提案不碰正文：正文那条收集器必须空着。
    expect(collected).toEqual([]);
  });

  it("只读档也能提（提案不落盘），但通道没接上时给中文拒绝", async () => {
    mode = "read-only";
    const out = await host().call("propose_bible", args);
    expect(out.ok).toBe(true);
    const bare = host(false);
    const denied = await bare.call("propose_bible", args);
    expect(denied.ok).toBe(false);
    expect(denied.text).toContain("设定提案通道");
  });

  it("类型不在三类里、标题或理由为空都当场拒绝", async () => {
    const badType = await host().call("propose_bible", { ...args, type: "item" });
    expect(badType.ok).toBe(false);
    expect(badType.text).toContain("人物");
    const noTitle = await host().call("propose_bible", { ...args, title: "  " });
    expect(noTitle.ok).toBe(false);
    const noWhy = await host().call("propose_bible", { ...args, why: "" });
    expect(noWhy.ok).toBe(false);
    expect(bibleCollected).toEqual([]);
  });
});
