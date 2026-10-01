import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanBook, sortChapters } from "../src/scan.js";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "abyss-scan-"));
  await mkdir(path.join(root, "chapters"), { recursive: true });
  await mkdir(path.join(root, "characters"), { recursive: true });
  await mkdir(path.join(root, "outline"), { recursive: true });
  await mkdir(path.join(root, "plot"), { recursive: true });
  await mkdir(path.join(root, "materials", "意象"), { recursive: true });
  await mkdir(path.join(root, "materials", "node_modules", "脏包"), { recursive: true });
  await mkdir(path.join(root, ".abyss", "sessions"), { recursive: true });
  await writeFile(path.join(root, "materials", "node_modules", "脏包", "混进来.md"), "不应出现\n");
  await writeFile(path.join(root, "chapters", "02-潮汐.md"), "---\ntitle: 潮汐\n---\n第二段\n");
  await writeFile(path.join(root, "chapters", "10-深渊之下.md"), "正文\n");
  await writeFile(path.join(root, "chapters", "01-开局.md"), "正文\n");
  await writeFile(path.join(root, "characters", "李深.md"), "---\ntitle: 李深\n---\n人物\n");
  await writeFile(path.join(root, "outline", "三幕.md"), "---\ntitle: 三幕\n---\n大纲\n");
  await writeFile(path.join(root, "plot", "主线.md"), "剧情\n");
  await writeFile(path.join(root, "materials", "意象", "雾.md"), "素材\n");
  await writeFile(path.join(root, ".abyss", "sessions", "leak.md"), "不应出现\n");
  await writeFile(path.join(root, "README.md"), "不应出现\n");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("scanBook", () => {
  it("按目录归类且跳过 .abyss 与根文件", async () => {
    const docs = await scanBook(root);
    expect(docs.map((d) => d.relPath).sort()).toEqual([
      "chapters/01-开局.md",
      "chapters/02-潮汐.md",
      "chapters/10-深渊之下.md",
      "characters/李深.md",
      "materials/意象/雾.md",
      "outline/三幕.md",
      "plot/主线.md"
    ]);
  });

  it("五类文稿各位归其类——少一类左栏就少一栏", async () => {
    const docs = await scanBook(root);
    const kindByPath = Object.fromEntries(docs.map((d) => [d.relPath, d.kind]));
    expect(kindByPath).toMatchObject({
      "chapters/01-开局.md": "chapter",
      "characters/李深.md": "character",
      "outline/三幕.md": "outline",
      "plot/主线.md": "plot",
      "materials/意象/雾.md": "material"
    });
  });

  it("素材目录下的 node_modules 被跳过（这条只有 SKIPPED_DIRS 挡得住）", async () => {
    const docs = await scanBook(root);
    expect(docs.map((d) => d.relPath)).not.toContain("materials/node_modules/混进来.md");
  });

  it("标题优先取 frontmatter title，其次取文件名", async () => {
    const docs = await scanBook(root);
    expect(docs.find((d) => d.relPath === "chapters/02-潮汐.md")?.title).toBe("潮汐");
    expect(docs.find((d) => d.relPath === "chapters/10-深渊之下.md")?.title).toBe("深渊之下");
  });
});

describe("sortChapters", () => {
  it("按 chapterOrder 优先排序，未登记的序号补在末尾", async () => {
    const docs = await scanBook(root);
    const sorted = sortChapters(
      docs.filter((d) => d.kind === "chapter"),
      ["chapters/10-深渊之下.md", "chapters/01-开局.md"]
    );
    expect(sorted.map((d) => d.relPath)).toEqual([
      "chapters/10-深渊之下.md",
      "chapters/01-开局.md",
      "chapters/02-潮汐.md"
    ]);
  });
});
