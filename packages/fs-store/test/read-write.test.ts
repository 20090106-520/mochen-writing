import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeFingerprint } from "../src/fingerprint.js";
import { readDocFile, writeDocFile } from "../src/read-write.js";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mochen-rw-"));
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
    expect(result.backupRelPath).toMatch(/^\.mochen\/changes\/.+\/chapters\/01-a\.md\.bak$/);
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

  it("读失败但不是「不存在」（EISDIR）时判 io-error，绝不写成新稿也不留备份", async () => {
    // 目标是个目录：readFile 报 EISDIR。把它当成「文件不存在」就等于允许无备份盲写。
    const dir = path.join(root, "chapters", "占用中");
    await mkdir(dir, { recursive: true });
    const result = await writeDocFile(root, "chapters/占用中", "覆盖它\n", makeFingerprint(""));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("读目录失败绝不能当成「文件不存在」写下去");
    if (result.reason !== "io-error")
      throw new Error(`读失败必须报 io-error，实际报了 ${result.reason}`);
    expect(result.message).toContain("占用中");
    expect((await stat(dir)).isDirectory()).toBe(true);
    expect(await readdir(dir)).toEqual([]);
  });

  it("readDocFile 报缺失文件", async () => {
    await expect(readDocFile(root, "chapters/不存在.md")).rejects.toThrow();
  });
});
