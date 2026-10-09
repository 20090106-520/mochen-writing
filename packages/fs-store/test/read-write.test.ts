import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeFingerprint } from "../src/fingerprint.js";
import { readDocFile, writeDocFile } from "../src/read-write.js";
import { fsBrokenAt, realAtomicFs } from "./atomic-write-fixture.js";

let root = "";

/** 每一条「写失败」用例都要一棵干净的书目录，不能共用上面那棵（备份目录会互相踩）。 */
async function scratchRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "mochen-rw-atomic-"));
}

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

// P0-1（2026-10-09 全仓扫描）：正文写盘必须是原子写。这一组用例钉的是「写失败之后盘上到底是什么」。
describe("writeDocFile 的写失败", () => {
  it("改名那一步失败时，旧稿一字不变、报 io-error、且不留临时文件残渣", async () => {
    const dir = await scratchRoot();
    await mkdir(path.join(dir, "chapters"), { recursive: true });
    await writeFile(path.join(dir, "chapters", "01.md"), "旧稿全文\n", "utf8");

    const result = await writeDocFile(
      dir,
      "chapters/01.md",
      "新稿全文\n",
      makeFingerprint("旧稿全文\n"),
      null,
      fsBrokenAt("rename", "EPERM: operation not permitted", "EPERM")
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("改名失败绝不能报称写成功了");
    if (result.reason !== "io-error")
      throw new Error(`写失败必须报 io-error，实际报了 ${result.reason}`);
    expect(result.message).toContain("EPERM");
    // 这一条才是本体：盘上仍是**完整的旧稿**，不是半截新稿。
    expect(await readFile(path.join(dir, "chapters", "01.md"), "utf8")).toBe("旧稿全文\n");
    const left = await readdir(path.join(dir, "chapters"));
    expect(left).toEqual(["01.md"]);
  });

  it("写临时文件那一步失败时同样保住旧稿，且不许留下半截正文", async () => {
    const dir = await scratchRoot();
    await mkdir(path.join(dir, "chapters"), { recursive: true });
    await writeFile(path.join(dir, "chapters", "01.md"), "旧稿全文\n", "utf8");

    const result = await writeDocFile(
      dir,
      "chapters/01.md",
      "新稿全文\n",
      makeFingerprint("旧稿全文\n"),
      null,
      fsBrokenAt("writeFile", "ENOSPC: no space left on device", "ENOSPC")
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("写 tmp 失败绝不能报成功");
    expect(await readFile(path.join(dir, "chapters", "01.md"), "utf8")).toBe("旧稿全文\n");
    const all = ((await readdir(dir, { recursive: true })) as string[]).join("|");
    expect(all).not.toContain("mochen-tmp");
  });

  it("成功路径照旧：内容写进去、留下备份、报出新指纹", async () => {
    const dir = await scratchRoot();
    await mkdir(path.join(dir, "chapters"), { recursive: true });
    await writeFile(path.join(dir, "chapters", "01.md"), "旧稿\n", "utf8");

    const result = await writeDocFile(
      dir,
      "chapters/01.md",
      "新稿\n",
      makeFingerprint("旧稿\n"),
      null,
      realAtomicFs
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("不该走到这里");
    expect(result.fingerprint).toBe(makeFingerprint("新稿\n"));
    expect(await readFile(path.join(dir, "chapters", "01.md"), "utf8")).toBe("新稿\n");
    expect(result.backupRelPath).toMatch(/^\.mochen\/changes\/.+\/chapters\/01\.md\.bak$/);
  });
});
