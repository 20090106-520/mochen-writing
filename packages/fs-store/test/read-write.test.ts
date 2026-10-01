import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeFingerprint } from "../src/fingerprint.js";
import { readDocFile, writeDocFile } from "../src/read-write.js";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "abyss-rw-"));
  await mkdir(path.join(root, "chapters"), { recursive: true });
  await writeFile(path.join(root, "chapters", "01-a.md"), "原稿\n");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("writeDocFile", () => {
  it("指纹相符时写盘并备份原稿", async () => {
    const fp = makeFingerprint("原稿\n");
    const result = await writeDocFile(root, "chapters/01-a.md", "新稿\n", fp);
    expect(result.ok).toBe(true);
    expect(await readFile(path.join(root, "chapters/01-a.md"), "utf8")).toBe("新稿\n");
    if (!result.ok) throw new Error("不该走到这里");
    expect(result.backupRelPath).toMatch(/^\.abyss\/changes\/.+\/chapters\/01-a\.md\.bak$/);
    if (result.backupRelPath === null) throw new Error("备份路径不该为空");
    expect(await readFile(path.join(root, result.backupRelPath), "utf8")).toBe("原稿\n");
    expect(result.fingerprint).toBe(makeFingerprint("新稿\n"));
  });

  it("指纹不符时拒绝写入且文件一字不变", async () => {
    await writeFile(path.join(root, "chapters/01-a.md"), "外部改过\n");
    const before = await readFile(path.join(root, "chapters/01-a.md"), "utf8");
    const result = await writeDocFile(
      root,
      "chapters/01-a.md",
      "覆盖它\n",
      makeFingerprint("旧指纹")
    );
    expect(result).toEqual({
      ok: false,
      reason: "stale",
      currentFingerprint: makeFingerprint("外部改过\n")
    });
    expect(await readFile(path.join(root, "chapters/01-a.md"), "utf8")).toBe(before);
  });

  it("穿越路径被拒绝，书目录外没多出文件", async () => {
    const result = await writeDocFile(root, "../evil.md", "x", makeFingerprint(""));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("不该走到这里");
    expect(result.reason).toBe("outside-book");
    const { readdir } = await import("node:fs/promises");
    expect(await readdir(path.dirname(root))).not.toContain("evil.md");
  });

  it("新建文件时没有备份但父目录自动创建", async () => {
    const result = await writeDocFile(root, "characters/新人物.md", "卡\n", makeFingerprint(""));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("不该走到这里");
    expect(result.backupRelPath).toBeNull();
    expect(await readFile(path.join(root, "characters/新人物.md"), "utf8")).toBe("卡\n");
  });

  it("readDocFile 报缺失文件", async () => {
    await expect(readDocFile(root, "chapters/不存在.md")).rejects.toThrow();
  });
});
