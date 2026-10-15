/**
 * 全书替换的循环（2026-10-15）。
 *
 * 这里钉的是**回执说真话**：扫了几篇、真正改了几篇、共几处、哪几篇没动各是什么理由。
 * 逐篇的写盘安全（指纹守卫、整篇备份、原子写）是 `writeDocFile` 自己的事，那边有用例；
 * 这一层只负责把它的成品**如实**汇总出来，尤其是「一处都没命中」与「改了 3 篇」不许长得一样。
 */
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BookReplaceResult, DocRef } from "@mochen/contracts";
import { describe, expect, it, vi } from "vitest";
import type { AtomicWriteFs } from "@mochen/fs-store";
import { replaceAcrossBook, type BookReplaceDeps } from "./book-replace.js";

/** 这一趟本该跑完；没跑完就直接把主进程那句真话抛出来，免得后面断言在一个失败档上乱猜。 */
function okOf(result: BookReplaceResult): Extract<BookReplaceResult, { ok: true }> {
  if (!result.ok)
    throw new Error(`这一趟本该跑完，却失败了（${result.reason}）：${result.message}`);
  return result;
}

async function makeBook(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "book-replace-"));
  for (const [rel, body] of Object.entries(files)) {
    const target = path.join(root, ...rel.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body, "utf8");
  }
  return root;
}

function docRef(relPath: string): DocRef {
  return { relPath, kind: "chapter", title: relPath };
}

function deps(root: string, relPaths: string[], fs?: AtomicWriteFs): BookReplaceDeps {
  return {
    root,
    docs: relPaths.map(docRef),
    retention: () => ({ maxCount: 50, maxBytes: 32 * 1024 * 1024 }),
    ...(fs === undefined ? {} : { fs })
  };
}

async function read(root: string, rel: string): Promise<string> {
  return readFile(path.join(root, ...rel.split("/")), "utf8");
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

describe("replaceAcrossBook", () => {
  it("换个名字：篇数、处数都对得上，盘上也真的换了", async () => {
    const root = await makeBook({
      "chapters/01.md": "小明来了。小明走了。",
      "chapters/02.md": "小明在。",
      "chapters/03.md": "这篇没提到。"
    });
    const result = await replaceAcrossBook(
      { query: "小明", replacement: "阿明" },
      deps(root, ["chapters/01.md", "chapters/02.md", "chapters/03.md"])
    );

    expect(result).toEqual({
      ok: true,
      scannedDocs: 3,
      changedDocs: 2,
      replacedCount: 3,
      skipped: []
    });
    expect(await read(root, "chapters/01.md")).toBe("阿明来了。阿明走了。");
    expect(await read(root, "chapters/02.md")).toBe("阿明在。");
    expect(await read(root, "chapters/03.md")).toBe("这篇没提到。");
  });

  it("一处都没命中就一个字都不动：不落盘、也不留一份假备份", async () => {
    const root = await makeBook({ "chapters/01.md": "这篇没提到。" });
    const result = await replaceAcrossBook(
      { query: "小明", replacement: "阿明" },
      deps(root, ["chapters/01.md"])
    );

    expect(result).toMatchObject({ ok: true, changedDocs: 0, replacedCount: 0, skipped: [] });
    expect(await read(root, "chapters/01.md")).toBe("这篇没提到。");
    // 没改动就不该有改稿历史那一坨（幂等短路那一档的盘上证据）。
    expect(await exists(path.join(root, ".mochen"))).toBe(false);
  });

  it("改前的原文整篇进改稿历史：出事能回滚，这是「全有全无」之外的交代", async () => {
    const root = await makeBook({ "chapters/01.md": "小明来了。" });
    await replaceAcrossBook({ query: "小明", replacement: "阿明" }, deps(root, ["chapters/01.md"]));

    const changesDir = path.join(root, ".mochen", "changes");
    const stamps = await readdir(changesDir);
    expect(stamps).toHaveLength(1);
    expect(await readFile(path.join(changesDir, stamps[0]!, "chapters", "01.md.bak"), "utf8")).toBe(
      "小明来了。"
    );
  });

  it("空查询一律拒：空模式会把每一篇切成无数段，那不是替换", async () => {
    const root = await makeBook({ "chapters/01.md": "小明来了。" });
    const result = await replaceAcrossBook(
      { query: "", replacement: "阿明" },
      deps(root, ["chapters/01.md"])
    );
    expect(result).toEqual({
      ok: false,
      reason: "invalid-input",
      message: "要找的内容是空的：空串会把每一篇切成无数段，这一条不做。"
    });
    expect(await read(root, "chapters/01.md")).toBe("小明来了。");
  });

  it("读不到的篇进 skipped（说得出是哪一篇、为什么），不把整趟拖垮", async () => {
    const root = await makeBook({ "chapters/01.md": "小明来了。" });
    const result = await replaceAcrossBook(
      { query: "小明", replacement: "阿明" },
      deps(root, ["chapters/01.md", "chapters/99-不存在.md"])
    );

    expect(result.ok).toBe(true);
    expect(okOf(result).changedDocs).toBe(1);
    expect(okOf(result).skipped).toEqual([
      {
        relPath: "chapters/99-不存在.md",
        title: "chapters/99-不存在.md",
        reason: "failed",
        message: expect.stringContaining("读不到这一篇") as unknown as string
      }
    ]);
  });

  it("某一篇写不下去时如实报 failed，其余篇照旧换完", async () => {
    const root = await makeBook({
      "chapters/01.md": "小明来了。",
      "chapters/02.md": "小明走了。"
    });
    // 「只坏一步」的 fs：改名永远失败（相当于 Windows 上那种改名被占用挡住、退避也过不去）。
    const failingRename: AtomicWriteFs = {
      writeFile: async () => undefined,
      rename: async () => {
        throw Object.assign(new Error("EBUSY: 一直被占用"), { code: "EBUSY" });
      },
      unlink: async () => undefined,
      mkdir: async () => undefined
    };
    const result = await replaceAcrossBook(
      { query: "小明", replacement: "阿明" },
      deps(root, ["chapters/01.md", "chapters/02.md"], failingRename)
    );

    expect(result.ok).toBe(true);
    expect(okOf(result).changedDocs).toBe(0);
    expect(okOf(result).skipped.map((s) => s.reason)).toEqual(["failed", "failed"]);
    // 写不出去 ⇒ 盘上还是原文（原子写本身保证的：没有半截正文）。
    expect(await read(root, "chapters/01.md")).toBe("小明来了。");
  });

  it("指纹对不上时跳过那一篇、一个字都不覆盖（这就是「谁也别盖掉别人刚写的字」）", async () => {
    const root = await makeBook({ "chapters/01.md": "小明来了。" });
    // 把「读到的那份字节」的指纹换成一个跟盘上对不上的值 —— 这正是
    // 「我读完这一篇之后有人改过它」那一档（真机上表现为另一路保存插进来）。
    vi.resetModules();
    vi.doMock("@mochen/fs-store", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@mochen/fs-store")>();
      return {
        ...actual,
        readDocFile: async (r: string, rel: string) => {
          const real = await actual.readDocFile(r, rel);
          return { content: real.content, fingerprint: "别人刚改过的指纹" };
        }
      };
    });
    try {
      const { replaceAcrossBook: fresh } = await import("./book-replace.js");
      const result = await fresh(
        { query: "小明", replacement: "阿明" },
        deps(root, ["chapters/01.md"])
      );

      expect(result.ok).toBe(true);
      expect(okOf(result).changedDocs).toBe(0);
      expect(okOf(result).skipped).toEqual([
        {
          relPath: "chapters/01.md",
          title: "chapters/01.md",
          reason: "stale",
          message: expect.stringContaining("没有覆盖") as unknown as string
        }
      ]);
      // 最要紧的一条：盘上一个字都没动，也没留备份（什么都没发生，就不该有痕迹）。
      expect(await read(root, "chapters/01.md")).toBe("小明来了。");
      expect(await exists(path.join(root, ".mochen"))).toBe(false);
    } finally {
      vi.doUnmock("@mochen/fs-store");
      vi.resetModules();
    }
  });
});
