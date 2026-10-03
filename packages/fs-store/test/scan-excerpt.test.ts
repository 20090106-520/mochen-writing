import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { DocRef } from "@mochen/contracts";
import { scanBook } from "../src/scan.js";

// readFile 换成「转发真实实现」的 spy：仍然真读盘（下面的正文断言靠它），同时可数调用次数证明没多加一次 IO。
// 其余导出（readdir/mkdtemp…）用 importOriginal 原样透出，readFile 用 as 保持重载签名，避免 tsc 在 test 目录报类型不符。
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) as typeof actual.readFile };
});
const readFileMock = readFile as unknown as Mock;

let root = "";
/** 按 relPath 取扫描结果里那一篇。 */
function find(docs: DocRef[], relPath: string): DocRef {
  const hit = docs.find((doc) => doc.relPath === relPath);
  if (!hit) throw new Error(`扫描结果里没有 ${relPath}`);
  return hit;
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mochen-excerpt-"));
  await mkdir(path.join(root, "chapters"), { recursive: true });
  await writeFile(path.join(root, "chapters", "正常.md"), "夜色沉下去，海雾从崖底涌上来。\n");
  await writeFile(
    path.join(root, "chapters", "仅元数据.md"),
    "---\ntitle: 只有一行元数据\n---\n\n"
  );
  await writeFile(path.join(root, "chapters", "超长.md"), `${"深渊之下海雾翻涌".repeat(20)}\n`);
  await writeFile(
    path.join(root, "chapters", "带记号.md"),
    "---\ntitle: 意象\n---\n# 世界观\n\n海是**深蓝**的，雾*很*浓。\n"
  );
  await writeFile(path.join(root, "chapters", "表情符.md"), `${"字".repeat(79)}\u{1F409}尾巴\n`);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("scanBook · excerpt 顺路带出第一段", () => {
  it("正常段落 ⇒ 带出第一段纯文本（变异 W5 靶）", async () => {
    const docs = await scanBook(root);
    expect(find(docs, "chapters/正常.md").excerpt).toBe("夜色沉下去，海雾从崖底涌上来。");
  });

  it("只有 frontmatter、正文为空 ⇒ excerpt 是空串而不是 undefined", async () => {
    const docs = await scanBook(root);
    expect(find(docs, "chapters/仅元数据.md").excerpt).toBe("");
  });

  it("markdown 记号与标题行被剥掉，只留正文", async () => {
    const docs = await scanBook(root);
    expect(find(docs, "chapters/带记号.md").excerpt).toBe("海是深蓝的，雾很浓。");
  });

  it("超长段落按码点截 80 并在末尾加一个省略号", async () => {
    const docs = await scanBook(root);
    const excerpt = find(docs, "chapters/超长.md").excerpt ?? "";
    expect(excerpt).toBe(`${"深渊之下海雾翻涌".repeat(10)}…`);
    expect(Array.from(excerpt).length).toBe(81); // 80 码点 + 1 省略号
  });

  it("截断按码点不按 UTF-16 码元：代理对要么整留要么整去", async () => {
    const docs = await scanBook(root);
    const excerpt = find(docs, "chapters/表情符.md").excerpt ?? "";
    // 前 79 个「字」+ 1 枚龙 emoji（代理对）正好占满 80 码点，再加省略号。
    expect(excerpt).toBe(`${"字".repeat(79)}\u{1F409}…`);
    // 反向保护：绝不留孤立高代理（slice(0,80) 按码元切就会劈开 emoji，留下半个代理对）。
    expect(excerpt).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it("不加盘 IO：readFile 次数恰等于扫出的文稿数（titleOf→docMetaOf 一次读取）", async () => {
    readFileMock.mockClear();
    const docs = await scanBook(root);
    expect(docs.length).toBe(5);
    expect(readFileMock.mock.calls.length).toBe(docs.length); // 若多读一次会变成 10 ⇒ 红
  });
});
