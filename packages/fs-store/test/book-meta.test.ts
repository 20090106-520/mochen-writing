import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseBookMeta, type BookMeta } from "@mochen/contracts";
import { bookMetaJson, writeBookMetaFile } from "../src/book-meta.js";
import { createBookSkeleton } from "../src/create.js";
import { fsBrokenAt } from "./atomic-write-fixture.js";

/**
 * `book.json` 的盘上形状与原子写（2026-10-09 全仓扫描 P0-1）。
 *
 * 这个文件是一本书的**门牌**：它半截了，正文一篇没丢却打不开这本书。
 * 所以「它长什么样」与「它怎么写」都只准有一份实现——建书骨架那条路与改设置那条路
 * 必须写出逐字相同的字节，否则同一本书会被两条路写出两种形状。
 */
let root = "";

const meta: BookMeta = {
  id: "b-1",
  title: "海雾手记",
  schemaVersion: 1,
  stages: [{ id: "draft", name: "正文" }],
  activeStage: "draft",
  permissionMode: "read-only",
  chapterOrder: []
};

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mochen-book-meta-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("bookMetaJson", () => {
  it("写出的是缩进两格、末尾带一个换行的 JSON", async () => {
    const body = bookMetaJson(meta);
    expect(body.endsWith("\n")).toBe(true);
    // 逐字比「缩进两格的 JSON」而不比键顺序：parseBookMeta 之后键序由 zod 说了算，
    // 拿原始对象的顺序去比会在无关改动时假红。
    expect(body).toBe(`${JSON.stringify(JSON.parse(body), null, 2)}\n`);
    expect(parseBookMeta(JSON.parse(body))).toEqual(parseBookMeta(meta));
  });
});

describe("writeBookMetaFile", () => {
  it("写成功后盘上就是那一串字节，且不留临时文件残渣", async () => {
    const dir = await mkdtemp(path.join(root, "ok-"));
    await writeBookMetaFile(dir, meta);

    expect(await readFile(path.join(dir, "book.json"), "utf8")).toBe(bookMetaJson(meta));
    const entries = await readdir(dir);
    expect(entries).toEqual(["book.json"]);
  });

  it("写失败时旧的那份必须原样留着——不许出现半截 JSON（这是「书打不开」的成因）", async () => {
    const dir = await mkdtemp(path.join(root, "fail-"));
    await writeFile(path.join(dir, "book.json"), bookMetaJson(meta), "utf8");

    const next: BookMeta = { ...meta, title: "改过的书名", permissionMode: "full-access" };
    await expect(
      writeBookMetaFile(dir, next, fsBrokenAt("rename", "ENOSPC", "ENOSPC"))
    ).rejects.toThrow(/ENOSPC/);

    // 本体：盘上仍是**完整可读的旧那份**，而不是一半新一半旧。
    const onDisk = await readFile(path.join(dir, "book.json"), "utf8");
    expect(onDisk).toBe(bookMetaJson(meta));
    expect(() => parseBookMeta(JSON.parse(onDisk))).not.toThrow();
    const entries = await readdir(dir);
    expect(entries).toEqual(["book.json"]);
  });

  it("目标目录不存在时先建出来（新建书就是这一档）", async () => {
    const dir = path.join(root, "made-on-the-way", "book");
    await writeBookMetaFile(dir, meta);
    expect(await stat(path.join(dir, "book.json"))).toBeTruthy();
  });

  it("技能策略随 book.json 一起落盘并原样读回（P0-4）", async () => {
    const dir = await mkdtemp(path.join(root, "skill-policy-"));
    const withPolicy: BookMeta = {
      ...meta,
      skillPolicy: { enabled: ["global:rhythm"], disabled: ["book:foreshadow"] }
    };
    await writeBookMetaFile(dir, withPolicy);
    const parsed = parseBookMeta(JSON.parse(await readFile(path.join(dir, "book.json"), "utf8")));
    expect(parsed.skillPolicy).toEqual(withPolicy.skillPolicy);
  });

  it("建书骨架与改设置写出的是**同一串字节**（不许有第二份 book.json 形状）", async () => {
    const built = await mkdtemp(path.join(root, "via-skeleton-"));
    const edited = await mkdtemp(path.join(root, "via-save-"));
    const fresh: BookMeta = { ...meta, id: "b-2" };

    const skeleton = await createBookSkeleton(path.join(built, "book"), fresh);
    expect(skeleton.ok).toBe(true);
    await writeBookMetaFile(edited, fresh);

    expect(await readFile(path.join(built, "book", "book.json"), "utf8")).toBe(
      await readFile(path.join(edited, "book.json"), "utf8")
    );
  });
});
