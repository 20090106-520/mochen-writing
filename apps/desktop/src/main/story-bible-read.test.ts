import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readStoryBibleEntries } from "./story-bible-read.js";

/**
 * W-01 的降级线：设定库读不出来时，这一轮生成照常走。
 *
 * 这里覆盖四种"读不出来"：没文件（还没建设定，正常）、JSON 坏、形状不认、
 * 同名路径是个目录（读操作抛非 ENOENT）。四种都必须回空表，绝不许把异常抛给对话链路。
 */

const roots: string[] = [];

async function bookRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "mochen-bible-"));
  roots.push(root);
  return root;
}

async function writeBible(root: string, content: string): Promise<void> {
  const dir = path.join(root, ".mochen", "data");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "story-bible.json"), content, "utf8");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("readStoryBibleEntries · 坏文件一律降级成空表", () => {
  it("还没有 story-bible.json：空表，不是报错", async () => {
    expect(await readStoryBibleEntries(await bookRoot())).toEqual([]);
  });

  it("JSON 损坏（半截文件）：空表", async () => {
    const root = await bookRoot();
    await writeBible(root, '[{"id":"c1","type":"char');
    expect(await readStoryBibleEntries(root)).toEqual([]);
  });

  it("形状不认（对象而不是条目表）：空表", async () => {
    const root = await bookRoot();
    await writeBible(root, '{"entries":[]}');
    expect(await readStoryBibleEntries(root)).toEqual([]);
  });

  it("这一格是目录而不是文件（读操作会抛非 ENOENT）：空表", async () => {
    const root = await bookRoot();
    await mkdir(path.join(root, ".mochen", "data", "story-bible.json"), { recursive: true });
    expect(await readStoryBibleEntries(root)).toEqual([]);
  });

  it("合法文件：按 contracts 的同一份规则读回来", async () => {
    const root = await bookRoot();
    await writeBible(
      root,
      JSON.stringify([
        {
          id: "c1",
          type: "character",
          title: "林夜",
          content: "码头守夜人",
          aliases: ["夜哥"],
          createdAt: 1,
          updatedAt: 2,
          tags: []
        }
      ])
    );
    const entries = await readStoryBibleEntries(root);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "c1",
      type: "character",
      title: "林夜",
      aliases: ["夜哥"],
      archived: false
    });
  });
});
