import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { scanBook } from "@mochen/fs-store";
import type { DocRef } from "@mochen/contracts";
import { createDocToolHost } from "./doc-tools-host.js";

/**
 * search_docs 的检索档位（2026-10-22 从 doc-tools-host.test.ts 拆出来）。
 *
 * 拆的理由是行数门禁：主文件已经贴着 800 行，kind / group / limit 三枚新参数的用例
 * 再塞进去就超了。这里只保留检索需要的三篇文稿（两章 + 一张人物卡），
 * 别的宿主能力（提案、联网、AI 味闸）一概不搭——那些仍由主文件覆盖。
 */
const CHAPTER = "chapters/01-开局.md";
const SECOND = "chapters/02-潮信.md";
const CHAPTER_TEXT = "第一段\n雾从海面涌上来。\n第三段\n雾又从海面涌上来。\n";

let root = "";
let docs: DocRef[] = [];

function host() {
  return createDocToolHost({
    root: () => root,
    docs: () => docs,
    context: () => ({ docRelPath: CHAPTER, permissionMode: "read-only", workMode: "act" }),
    onProposal: () => {},
    newId: () => "p1",
    now: () => "2026-10-01T08:00:00.000Z",
    webSearch: async () => ({
      sourceId: "test",
      sourceLabel: "测试源",
      results: [],
      attempted: 0,
      skipped: [],
      deduped: 0
    }),
    webRead: async () => {
      throw new Error("检索用例不该走 web_read");
    }
  });
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mochen-search-"));
  await mkdir(path.join(root, "chapters"), { recursive: true });
  await mkdir(path.join(root, "characters"), { recursive: true });
  docs = await scanBook(root);
});

beforeEach(async () => {
  await writeFile(path.join(root, CHAPTER), CHAPTER_TEXT, "utf8");
  await writeFile(path.join(root, SECOND), "潮信还没到。\n", "utf8");
  await writeFile(path.join(root, "characters", "李深.md"), "身份：守闸人\n", "utf8");
  docs = await scanBook(root);
});

describe("search_docs · 逐行档", () => {
  it("给出行号", async () => {
    const out = await host().call("search_docs", { query: "守闸人" });
    expect(out.ok).toBe(true);
    expect(out.text).toContain("characters/李深.md:1:");
  });

  it("query 是空串时拒绝，而不是拿空串去全书逐行匹配", async () => {
    // 空串 line.includes("") 恒真：少了这条守卫，回执会变成「命中 N 处」的全书倾倒。
    const out = await host().call("search_docs", { query: "" });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("非空");
    expect(out.proposals).toEqual([]);
  });

  it("精确零命中后按一字之差容错，并如实写明这是容错命中", async () => {
    // 盘上是「守闸人」，query 差一个字：精确匹配零命中，第二轮容错兜底。
    const out = await host().call("search_docs", { query: "守闸入" });
    expect(out.ok).toBe(true);
    expect(out.text).toContain("容错命中");
    expect(out.text).toContain("characters/李深.md:1:");
  });

  it("精确命中时不跑容错轮；确实不存在时回「没有命中」且不提容错", async () => {
    const exact = await host().call("search_docs", { query: "守闸人" });
    expect(exact.text).not.toContain("容错");
    const miss = await host().call("search_docs", { query: "绝不会出现的词" });
    expect(miss.ok).toBe(true);
    expect(miss.text).toContain("没有命中");
    expect(miss.text).not.toContain("容错");
  });

  it("limit 截断逐行档并说明只列了前几条", async () => {
    const out = await host().call("search_docs", { query: "雾", limit: 1 });
    expect(out.text).toContain("只列前 1 条");
    expect(out.text.match(/chapters\/01-开局\.md:\d+:/g)).toHaveLength(1);
  });
});

describe("search_docs · kind 限定与按篇聚合", () => {
  it("kind 限定文稿类型并在回执里点名；认不出的类型拒绝而不是悄悄退回全书", async () => {
    const inCharacter = await host().call("search_docs", { query: "守闸人", kind: "character" });
    expect(inCharacter.text).toContain("characters/李深.md:1:");
    expect(inCharacter.text).toContain("只搜了 character 类文稿");
    const inChapter = await host().call("search_docs", { query: "守闸人", kind: "chapter" });
    expect(inChapter.text).toContain("没有命中");
    const unknown = await host().call("search_docs", { query: "守闸人", kind: "场景" });
    expect(unknown.ok).toBe(false);
    expect(unknown.text).toContain("不认识的文稿类型");
  });

  it("group=doc 按篇聚合：只报哪些篇提到它、各几处、首处在第几行", async () => {
    const grouped = await host().call("search_docs", { query: "雾", group: "doc" });
    expect(grouped.text).toContain("分布在 1 篇");
    expect(grouped.text).toContain("chapters/01-开局.md · ");
    expect(grouped.text).toContain("（命中 2 处，首处第 2 行：");
    // 聚合档不再逐行倾倒
    expect(grouped.text).not.toContain("chapters/01-开局.md:2:");
  });
});
