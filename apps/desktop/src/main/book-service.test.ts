import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_PERMISSION_MODE } from "@abyss/contracts";
import { createBookService } from "./book-service.js";

let root = "";
let other = "";

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "abyss-svc-"));
  other = await mkdtemp(path.join(tmpdir(), "abyss-svc2-"));
  await mkdir(path.join(root, "chapters"), { recursive: true });
  await writeFile(path.join(root, "chapters", "01-a.md"), "正文\n");
  await writeFile(
    path.join(root, "book.json"),
    JSON.stringify(
      {
        id: "b1",
        title: "测试书",
        schemaVersion: 1,
        stages: [{ id: "draft", name: "正文" }],
        activeStage: "draft",
        permissionMode: DEFAULT_PERMISSION_MODE,
        chapterOrder: []
      },
      null,
      2
    )
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(other, { recursive: true, force: true });
});

describe("bookService", () => {
  it("open 返回 meta 与按 chapterOrder 排好的文档列表", async () => {
    const service = createBookService();
    const opened = await service.open(root);
    expect(opened.rootPath).toBe(root);
    expect(opened.meta.title).toBe("测试书");
    expect(opened.docs.map((d) => d.relPath)).toEqual(["chapters/01-a.md"]);
    await service.close();
  });

  it("book.json 非法时 open 抛中文可读错误", async () => {
    await writeFile(path.join(other, "book.json"), "{ not json");
    const service = createBookService();
    await expect(service.open(other)).rejects.toThrow(/book\.json/);
    await service.close();
  });

  it("未打开书时 writeDoc 返回 io-error 且不崩", async () => {
    const service = createBookService();
    const result = await service.writeDoc("chapters/01-a.md", "x", "fp");
    expect(result).toEqual({
      ok: false,
      reason: "io-error",
      message: expect.stringContaining("尚未打开作品目录")
    });
  });

  it("book.json 能解析但结构非法时 open 仍拒绝（schema 关卡单独生效）", async () => {
    await writeFile(
      path.join(other, "book.json"),
      JSON.stringify({
        id: "b1",
        title: "缺 activeStage",
        schemaVersion: 1,
        stages: [{ id: "draft", name: "正文" }],
        permissionMode: "read-only",
        chapterOrder: []
      })
    );
    const service = createBookService();
    await expect(service.open(other)).rejects.toThrow(/activeStage/);
    await service.close();
  });

  it("未打开书时 readDoc 与 saveMeta 抛「尚未打开作品目录」", async () => {
    const service = createBookService();
    await expect(service.readDoc("chapters/01-a.md")).rejects.toThrow("尚未打开作品目录");
    await expect(service.saveMeta({} as never)).rejects.toThrow("尚未打开作品目录");
  });

  it("writeDoc 走指纹冲突：外部改动后拒绝", async () => {
    const service = createBookService();
    await service.open(root);
    const first = await service.readDoc("chapters/01-a.md");
    await writeFile(path.join(root, "chapters/01-a.md"), "外部改过\n");
    const result = await service.writeDoc("chapters/01-a.md", "覆盖\n", first.fingerprint);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("不该走到这里");
    expect(result.reason).toBe("stale");
    await service.close();
  });
});
