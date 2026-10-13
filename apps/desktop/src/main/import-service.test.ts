import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createImportService, type ImportDialogLike } from "./import-service.js";
import { defaultAtomicFs } from "@mochen/fs-store";
import type { AtomicWriteFs } from "@mochen/fs-store";

/**
 * TXT 导入服务的用例（2026-10-11）。真文件系统跑全链（同 doc-trash 系用例的口径）：
 * 预览 = 弹框（假）→ 读盘（真）→ 探编码 → 切章；提交 = 走 createDocFile 既有守卫落盘。
 */

const dirs: string[] = [];
afterAll(async () => {
  // Windows 上目录句柄偶尔晚松：逐个清理，失败不拖累别的用例（已知 flaky，不算失败）。
  for (const dir of dirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

async function tempBook(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mochen-import-"));
  dirs.push(dir);
  return dir;
}

function dialogReturning(filePath: string | null): ImportDialogLike {
  return {
    showOpenDialog: async () =>
      filePath === null
        ? { canceled: true, filePaths: [] }
        : { canceled: false, filePaths: [filePath] }
  };
}

function serviceFor(
  root: string | null,
  dialog: ImportDialogLike,
  extra: { fs?: AtomicWriteFs; maxChapters?: number } = {}
) {
  return createImportService({
    book: () => (root === null ? null : { root, docRelPaths: [] }),
    dialog,
    ...extra
  });
}

describe("preview", () => {
  it("没开书直接拒：no-book，不弹选文件框", async () => {
    let asked = false;
    const svc = createImportService({
      book: () => null,
      dialog: {
        showOpenDialog: async () => {
          asked = true;
          return { canceled: true, filePaths: [] };
        }
      }
    });
    const result = await svc.preview();
    expect(result).toMatchObject({ ok: false, reason: "no-book" });
    expect(asked).toBe(false);
  });

  it("用户点取消回 canceled（正常操作，不是故障）", async () => {
    const svc = serviceFor(await tempBook(), dialogReturning(null));
    expect(await svc.preview()).toMatchObject({ ok: false, reason: "canceled" });
  });

  it("UTF-8 双章 txt：编码、章目、正文、字数一次带回；标题不混进正文", async () => {
    const root = await tempBook();
    const file = path.join(root, "样书.txt");
    await writeFile(file, "第一章 风起\n开头的段落。\n\n第二章 夜航\n另一章。", "utf8");
    const svc = serviceFor(root, dialogReturning(file));
    const result = await svc.preview();
    expect(result).toMatchObject({ ok: true, fileName: "样书", encoding: "utf-8" });
    if (!result.ok) return;
    expect(result.chapters).toHaveLength(2);
    expect(result.chapters[0]).toMatchObject({ title: "第一章 风起", content: "开头的段落。" });
    expect(result.chapters[1]!.chars).toBeGreaterThan(0);
  });

  it("GBK 稿件：判成 gbk 且正文不是乱码", async () => {
    const root = await tempBook();
    const file = path.join(root, "旧稿.txt");
    // 「第一章 甲\n正文。」的 GBK 字节（Buffer.from 按 gbk 编不出来，写死字节真身）。
    const gbk = Buffer.from([
      0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x20, 0xbc, 0xd7, 0x0d, 0x0a, 0xd5, 0xfd, 0xce, 0xc4
    ]);
    await writeFile(file, gbk);
    const svc = serviceFor(root, dialogReturning(file));
    const result = await svc.preview();
    expect(result).toMatchObject({ ok: true, encoding: "gbk" });
    if (!result.ok) return;
    expect(result.chapters[0]!.title).toBe("第一章 甲");
    expect(result.chapters[0]!.content).toBe("正文");
  });

  it("空文件回 empty，不说成功", async () => {
    const root = await tempBook();
    const file = path.join(root, "空.txt");
    await writeFile(file, "", "utf8");
    const svc = serviceFor(root, dialogReturning(file));
    expect(await svc.preview()).toMatchObject({ ok: false, reason: "empty" });
  });

  it("切出章数超上限回 too-large（多半是正文被误认成标题）", async () => {
    const root = await tempBook();
    const file = path.join(root, "碎.txt");
    await writeFile(
      file,
      Array.from({ length: 10 }, (_, i) => `第${i + 1}章 甲\nA`).join("\n"),
      "utf8"
    );
    const svc = createImportService({
      book: () => ({ root, docRelPaths: [] }),
      dialog: dialogReturning(file),
      maxChapters: 5
    });
    expect(await svc.preview()).toMatchObject({ ok: false, reason: "too-large" });
  });
});

describe("commit", () => {
  it("双章落盘：frontmatter 带标题、正文原样、返回 relPaths 供登记次序", async () => {
    const root = await tempBook();
    const svc = serviceFor(root, dialogReturning(null));
    const result = await svc.commit({
      chapters: [
        { title: "第一章 风起", content: "开头的段落。" },
        { title: "第二章 夜航", content: "另一章。" }
      ]
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.created).toEqual(["chapters/第一章 风起.md", "chapters/第二章 夜航.md"]);
    const first = await readFile(path.join(root, "chapters", "第一章 风起.md"), "utf8");
    expect(first).toContain("title: 第一章 风起");
    expect(first).toContain("开头的段落。");
  });

  it("没开书 / 空清单 / 形状不对：各自有话说，不抛裸错误", async () => {
    const svc = serviceFor(null, dialogReturning(null));
    expect(await svc.commit({ chapters: [{ title: "甲", content: "" }] })).toMatchObject({
      ok: false,
      reason: "no-book"
    });
    const root = await tempBook();
    const withBook = serviceFor(root, dialogReturning(null));
    expect(await withBook.commit({ chapters: [] })).toMatchObject({ ok: false, reason: "empty" });
    expect(await withBook.commit(null)).toMatchObject({ ok: false, reason: "empty" });
    expect(await withBook.commit({ chapters: [{ title: 3, content: "x" }] })).toMatchObject({
      ok: false,
      reason: "empty"
    });
  });

  it("标题非法或批内重名：整批一个字不写", async () => {
    const root = await tempBook();
    const svc = serviceFor(root, dialogReturning(null));
    const bad = await svc.commit({
      chapters: [
        { title: "第一章", content: "A" },
        { title: "CON", content: "B" }
      ]
    });
    expect(bad).toMatchObject({ ok: false, reason: "invalid-title" });
    const dup = await svc.commit({
      chapters: [
        { title: "第一章", content: "A" },
        { title: "第一章 ", content: "B" }
      ]
    });
    expect(dup).toMatchObject({ ok: false, reason: "name-conflict" });
    // 整批先查：盘上不该有任何新文件（readdir 由下面的 read 断言兜底）。
    await expect(readFile(path.join(root, "chapters", "第一章.md"), "utf8")).rejects.toThrow();
  });

  it("书里已有同名文稿（快照在册）：整批拦下并点名，绝不覆盖", async () => {
    const root = await tempBook();
    await mkdir(path.join(root, "chapters"), { recursive: true });
    await writeFile(path.join(root, "chapters", "第一章.md"), "已有的正文", "utf8");
    const svc = createImportService({
      book: () => ({ root, docRelPaths: ["chapters/第一章.md"] }),
      dialog: dialogReturning(null)
    });
    const result = await svc.commit({ chapters: [{ title: "第一章", content: "新的" }] });
    expect(result).toMatchObject({ ok: false, reason: "name-conflict" });
    expect(await readFile(path.join(root, "chapters", "第一章.md"), "utf8")).toBe("已有的正文");
  });

  it("快照没跟上、盘上真撞名：createDocFile 的 already-exists 兜底，已导的篇数如实说", async () => {
    const root = await tempBook();
    await mkdir(path.join(root, "chapters"), { recursive: true });
    await writeFile(path.join(root, "chapters", "第二章.md"), "占位", "utf8");
    const svc = createImportService({
      // 快照是空的：主进程快照与盘面脱节是常态，盘面才是真相。
      book: () => ({ root, docRelPaths: [] }),
      dialog: dialogReturning(null)
    });
    const result = await svc.commit({
      chapters: [
        { title: "第一章", content: "A" },
        { title: "第二章", content: "B" }
      ]
    });
    expect(result).toMatchObject({ ok: false, reason: "name-conflict" });
    // 第一章已落盘（不回滚——「已导入的不会重复」是承诺过的话），第二章原样未被覆盖。
    expect(await readFile(path.join(root, "chapters", "第一章.md"), "utf8")).toContain(
      "title: 第一章"
    );
    expect(await readFile(path.join(root, "chapters", "第二章.md"), "utf8")).toBe("占位");
  });

  it("写盘中途坏了（ENOSPC）：io-error 带上已写入篇数，且确实写进了前几篇", async () => {
    const root = await tempBook();
    // 第二次 writeFile（= 第二篇的临时件）才坏：第一篇放行。
    let calls = 0;
    const flakyFs: AtomicWriteFs = {
      ...defaultAtomicFs,
      writeFile: async (target: string, data: string) => {
        calls += 1;
        if (calls >= 2) throw Object.assign(new Error("磁盘满了"), { code: "ENOSPC" });
        return defaultAtomicFs.writeFile(target, data);
      }
    };
    const svc = createImportService({
      book: () => ({ root, docRelPaths: [] }),
      dialog: dialogReturning(null),
      fs: flakyFs
    });
    const result = await svc.commit({
      chapters: [
        { title: "第一章", content: "A" },
        { title: "第二章", content: "B" }
      ]
    });
    expect(result).toMatchObject({ ok: false, reason: "io-error" });
    if (result.ok) return;
    expect(result.message).toContain("前 1 篇");
    expect(await readFile(path.join(root, "chapters", "第一章.md"), "utf8")).toContain(
      "title: 第一章"
    );
  });
});
