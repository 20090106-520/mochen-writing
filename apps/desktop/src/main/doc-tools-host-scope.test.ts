/**
 * 档案写入范围与续写追加（P0-1）——从 doc-tools-host.test.ts 拆出来（800 行预算）。
 * 判据只有 doc-tools-host.ts 的 scopeDenial / appendOnlyDenial* 一处，这里只钉行为面。
 */
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { scanBook } from "@mochen/fs-store";
import {
  findProfile,
  type AgentProfile,
  type DocRef,
  type EditProposal,
  type PermissionMode
} from "@mochen/contracts";
import { createDocToolHost } from "./doc-tools-host.js";
import type { WebReadOutcome } from "./web-read.js";

let root = "";
let docs: DocRef[] = [];
const CHAPTER = "chapters/01-开局.md";
const CHAPTER_TEXT = "第一段\n雾从海面涌上来。\n第三段\n雾又从海面涌上来。\n";
let collected: EditProposal[] = [];
let mode: PermissionMode = "read-only";
let profile: AgentProfile | null = null;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mochen-scope-"));
  await mkdir(path.join(root, "chapters"), { recursive: true });
  await writeFile(path.join(root, CHAPTER), CHAPTER_TEXT, "utf8");
  docs = await scanBook(root);
});
beforeEach(async () => {
  await writeFile(path.join(root, ...CHAPTER.split("/")), CHAPTER_TEXT, "utf8");
  collected = [];
  mode = "read-only";
  profile = null;
});

function host() {
  return createDocToolHost({
    root: () => root,
    docs: () => docs,
    context: () => ({
      docRelPath: CHAPTER,
      permissionMode: mode,
      workMode: "act",
      ...(profile === null ? {} : { profile })
    }),
    onProposal: (proposal) => {
      collected.push(proposal);
    },
    newId: (() => {
      let n = 0;
      return () => `p${(n += 1)}`;
    })(),
    now: () => "2026-10-01T08:00:00.000Z",
    // 这组只验写盘闸，联网工具不会被调到。
    webSearch: async () => ({
      sourceId: "test",
      sourceLabel: "测试源",
      results: [],
      attempted: 1,
      skipped: [],
      deduped: 0
    }),
    webRead: async () => ({}) as WebReadOutcome
  });
}

describe("档案写入范围与续写追加（P0-1）", () => {
  const chapterPath = () => path.join(root, ...CHAPTER.split("/"));

  it("审稿档案：write_doc 被拒，文件一字未动，零提案", async () => {
    profile = findProfile("reviewer")!;
    mode = "full-access";
    const before = await readFile(chapterPath(), "utf8");
    const out = await host().call("write_doc", {
      doc: CHAPTER,
      content: "审稿直接重写全文",
      why: "审稿想直接改正文"
    });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("只出批注式提案");
    expect(collected).toEqual([]);
    expect(await readFile(chapterPath(), "utf8")).toBe(before);
  });

  it("审稿档案：propose_patch 仍是它唯一的出口", async () => {
    profile = findProfile("reviewer")!;
    const out = await host().call("propose_patch", {
      doc: CHAPTER,
      anchor: "第一段",
      replace: "第一段改",
      why: "口吻走形，给一条批注提案"
    });
    expect(out.ok, out.text).toBe(true);
    expect(collected).toHaveLength(1);
  });

  it("世界档案：提案不能落到正文（范围只有 material、outline）", async () => {
    profile = findProfile("world")!;
    const out = await host().call("propose_patch", {
      doc: CHAPTER,
      anchor: "第一段",
      replace: "第一段改",
      why: "顺手改正文"
    });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("写入范围是仅 material、outline");
    expect(collected).toEqual([]);
  });

  it("续写档案：文末追加放行", async () => {
    profile = findProfile("continuer")!;
    const tail = "雾又从海面涌上来。";
    const out = await host().call("propose_patch", {
      doc: CHAPTER,
      anchor: tail,
      replace: `${tail}\n新的段落。`,
      why: "往下接一段"
    });
    expect(out.ok, out.text).toBe(true);
    expect(collected).toHaveLength(1);
  });

  it("续写档案：改前文被拒，零提案", async () => {
    profile = findProfile("continuer")!;
    const out = await host().call("propose_patch", {
      doc: CHAPTER,
      anchor: "第一段",
      replace: "第一段改",
      why: "想润色开头"
    });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("只允许改文末");
    expect(collected).toEqual([]);
  });

  it("续写档案：整篇 write_doc 不是净追加就拒", async () => {
    profile = findProfile("continuer")!;
    mode = "full-access";
    const out = await host().call("write_doc", {
      doc: CHAPTER,
      content: "整篇重写，抹掉旧文",
      why: "整篇重写"
    });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("只能把新文字接在文末");
    expect(collected).toEqual([]);
  });

  it("续写档案：净追加的 write_doc 放行", async () => {
    profile = findProfile("continuer")!;
    mode = "full-access";
    const out = await host().call("write_doc", {
      doc: CHAPTER,
      content: `${CHAPTER_TEXT}新的段落。\n`,
      why: "接在文末"
    });
    expect(out.ok, out.text).toBe(true);
    expect(collected).toHaveLength(1);
  });
});
