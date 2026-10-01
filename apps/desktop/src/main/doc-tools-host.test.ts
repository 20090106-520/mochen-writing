import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { scanBook } from "@mochen/fs-store";
import type { DocRef, EditProposal, PermissionMode } from "@mochen/contracts";
import { createDocToolHost } from "./doc-tools-host.js";

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
});

function host() {
  return createDocToolHost({
    root: () => root,
    docs: () => docs,
    context: () => ({ docRelPath: CHAPTER, permissionMode: mode }),
    onProposal: (proposal, baseline) => {
      collected.push(proposal);
      baselines.push(baseline);
    },
    newId: (() => {
      let n = 0;
      return () => `p${(n += 1)}`;
    })(),
    now: () => "2026-10-01T08:00:00.000Z"
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
