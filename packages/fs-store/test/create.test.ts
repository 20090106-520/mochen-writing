import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BookMeta } from "@mochen/contracts";
import { createBookSkeleton, createDocFile, docTemplate } from "../src/create.js";
import { fsBrokenAt } from "./atomic-write-fixture.js";
import { makeFingerprint } from "../src/fingerprint.js";

let root = "";

const meta: BookMeta = {
  id: "b-1",
  title: "测试之书",
  schemaVersion: 1,
  stages: [{ id: "draft", name: "正文" }],
  activeStage: "draft",
  permissionMode: "read-only",
  chapterOrder: []
};

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mochen-create-"));
  await writeFile(path.join(root, "book.json"), JSON.stringify(meta), "utf8");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("createDocFile", () => {
  it("新文档落盘：frontmatter 模板 + 返回新内容指纹", async () => {
    const result = await createDocFile(root, "chapters/第二章.md", "第二章");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("不该走到这里");
    const content = await readFile(path.join(root, "chapters/第二章.md"), "utf8");
    expect(content).toBe(docTemplate("第二章"));
    expect(result.fingerprint).toBe(makeFingerprint(content));
  });

  it("目录还不存在时顺路建出（materials 子目录同理）", async () => {
    const result = await createDocFile(root, "materials/种族/海怪.md", "海怪");
    expect(result.ok).toBe(true);
    expect(await readFile(path.join(root, "materials/种族/海怪.md"), "utf8")).toBe(
      docTemplate("海怪")
    );
  });

  it("同名文件已存在：拒绝且原文件一字不动", async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(root, "outline"), { recursive: true });
    await writeFile(path.join(root, "outline/主线.md"), "原来的大纲\n", "utf8");
    const result = await createDocFile(root, "outline/主线.md", "主线");
    expect(result).toEqual({ ok: false, reason: "already-exists", message: expect.any(String) });
    expect(await readFile(path.join(root, "outline/主线.md"), "utf8")).toBe("原来的大纲\n");
  });

  it("五个分组目录之外一律拒绝（book.json 级别的路径不归这条通道）", async () => {
    const result = await createDocFile(root, "book.json", "x");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("不该走到这里");
    expect(result.reason).toBe("not-doc-dir");
  });

  it("越界路径被拒绝，书目录外没多出文件", async () => {
    const result = await createDocFile(root, "../evil.md", "evil");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("不该走到这里");
    expect(result.reason).toBe("outside-book");
    await expect(readdir(path.resolve(root, ".."))).resolves.toContain(path.basename(root));
  });
});

describe("createBookSkeleton", () => {
  it("空目录：建出 book.json 与五个分组目录", async () => {
    const dir = path.join(root, "new-book");
    const result = await createBookSkeleton(dir, { ...meta, id: "b-2" });
    expect(result.ok).toBe(true);
    const entries = await readdir(dir);
    expect(entries).toEqual(
      expect.arrayContaining([
        "book.json",
        "chapters",
        "outline",
        "characters",
        "plot",
        "materials"
      ])
    );
    const written = JSON.parse(await readFile(path.join(dir, "book.json"), "utf8"));
    expect(written).toMatchObject({ id: "b-2", title: "测试之书", schemaVersion: 1 });
  });

  it("目录里已有 book.json：拒绝（那是打开就能用的书，不是新建）", async () => {
    const result = await createBookSkeleton(root, meta);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("不该走到这里");
    expect(result.message).toContain("不是空的");
  });

  it("目录里哪怕只有别的一个文件也拒绝：绝不往用户没点头的目录里盖东西", async () => {
    const dir = path.join(root, "not-empty");
    await stat(dir).catch(async () => {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(dir);
    });
    await writeFile(path.join(dir, "随手放的.txt"), "别动我", "utf8");
    const result = await createBookSkeleton(dir, { ...meta, id: "b-3" });
    expect(result.ok).toBe(false);
    expect(await readFile(path.join(dir, "随手放的.txt"), "utf8")).toBe("别动我");
  });

  it("非法 meta（activeStage 不在 stages）被 zod 拒掉，盘上一个字没写", async () => {
    const dir = path.join(root, "bad-meta");
    const bad = { ...meta, id: "b-4", activeStage: "不存在的阶段" };
    await expect(createBookSkeleton(dir, bad as BookMeta)).rejects.toThrow();
    await expect(stat(dir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("book.json 写失败时不许留下半截 JSON——那等于这本书再也打不开（P0-1）", async () => {
    // 裸 `writeFile` 是「先截断再写」：半途而废就留下一份解析不了的 book.json，
    // 正文全在盘上，`open()` 却在 parse 那一步抛——用户看到的是「书丢了」。
    // 坏在「改名落定」这一步：真写到最后一寸才失败，才量得出中间那份临时文件有没有藏好。
    const dir = path.join(root, "half-book");
    await expect(
      createBookSkeleton(dir, { ...meta, id: "b-5" }, fsBrokenAt("rename", "ENOSPC", "ENOSPC"))
    ).rejects.toThrow(/ENOSPC/);
    await expect(stat(path.join(dir, "book.json"))).rejects.toMatchObject({ code: "ENOENT" });
    const all = ((await readdir(dir, { recursive: true })) as string[]).join("|");
    expect(all).not.toContain("mochen-tmp");
  });
});
