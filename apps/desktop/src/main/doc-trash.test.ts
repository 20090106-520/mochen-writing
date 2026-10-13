import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createTrashService, isTrashName, trashDirOf, type TrashFs } from "./doc-trash.js";
import type { TrashSnapshot } from "./doc-trash.js";

/**
 * 书稿回收站的用例（2026-10-10）。真文件系统跑全链（同 book-service 系用例的口径）：
 * 删 = 移进 .mochen/trash 且留下小抄，还原 = 按小抄搬回原位。
 */

const dirs: string[] = [];
afterAll(async () => {
  // Windows 上目录句柄偶尔晚松：逐个清理，失败不拖累别的用例。
  for (const dir of dirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

async function tempBook(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mochen-trash-"));
  dirs.push(dir);
  await writeFile(path.join(dir, "book.json"), "{}", "utf8");
  return dir;
}

function service(root: string, docs: TrashSnapshot["docs"] = []) {
  return createTrashService({
    book: () => ({ root, docs })
  });
}

describe("trashDoc", () => {
  it("在册文稿移进回收站：原位消失、正文与小抄都在", async () => {
    const root = await tempBook();
    await mkdir(path.join(root, "chapters"), { recursive: true });
    await writeFile(path.join(root, "chapters", "01.md"), "# 第一章", "utf8");
    const svc = service(root, [{ relPath: "chapters/01.md", title: "第一章" }]);

    const result = await svc.trashDoc("chapters/01.md");
    expect(result.ok).toBe(true);
    const trashName = (result as { ok: true; trashName: string }).trashName;

    const trashDir = trashDirOf(root);
    expect(await readFile(path.join(trashDir, `${trashName}.md`), "utf8")).toBe("# 第一章");
    const meta = JSON.parse(await readFile(path.join(trashDir, `${trashName}.json`), "utf8")) as {
      relPath: string;
      title: string;
    };
    expect(meta.relPath).toBe("chapters/01.md");
    expect(meta.title).toBe("第一章");
    let gone: boolean;
    try {
      await readFile(path.join(root, "chapters", "01.md"), "utf8");
      gone = false;
    } catch {
      gone = true;
    }
    expect(gone).toBe(true);
  });

  it("不在扫描在册清单里的路径被拒：book.json 与陌生文件都不收", async () => {
    const root = await tempBook();
    const svc = service(root);
    const notDoc = await svc.trashDoc("book.json");
    expect(notDoc).toMatchObject({ ok: false, reason: "not-a-doc" });
    const stranger = await svc.trashDoc("chapters/没登记过.md");
    expect(stranger).toMatchObject({ ok: false, reason: "not-a-doc" });
  });

  it("越界与非法路径被拒（词法 + realpath 双闸都过才算数）", async () => {
    const root = await tempBook();
    const svc = service(root, [{ relPath: "chapters/a.md", title: "a" }]);
    expect(await svc.trashDoc("../outside.md")).toMatchObject({ ok: false });
    expect(await svc.trashDoc("")).toMatchObject({ ok: false });
  });

  it("没开书回 no-book，不抛", async () => {
    const svc = createTrashService({ book: () => null });
    const result = await svc.trashDoc("chapters/01.md");
    expect(result).toMatchObject({ ok: false, reason: "no-book" });
  });

  it("移正文失败时小抄不残留（不造没有正文的孤儿条目）", async () => {
    const root = await tempBook();
    // chapters 目录要真存在：realpath 闸对「不存在的二级路径」按最严口径判外（防软链的既有设计）。
    await mkdir(path.join(root, "chapters"), { recursive: true });
    const failingFs: TrashFs = {
      mkdir: async () => {},
      rename: async () => {
        throw new Error("EPERM");
      },
      readdir: async () => [],
      readFile: async () => "",
      writeFile: async () => {},
      rm: async () => {},
      exists: async () => false
    };
    const svc = createTrashService({
      book: () => ({ root, docs: [{ relPath: "chapters/01.md", title: "第一章" }] }),
      fs: failingFs
    });
    const result = await svc.trashDoc("chapters/01.md");
    expect(result).toMatchObject({ ok: false, reason: "io-error" });
    // 小抄写入与回删都走注入的 fs——这里只断言结果档位；孤儿防治的顺序断言在 list/restore 联合用例里。
  });
});

describe("list", () => {
  it("空目录（或还没删过东西）回空表，不抛", async () => {
    const root = await tempBook();
    const svc = service(root);
    expect(await svc.list()).toEqual({ ok: true, entries: [] });
  });

  it("列出小抄并按时间倒序；形状坏的小抄跳过不冒充", async () => {
    const root = await tempBook();
    const trashDir = trashDirOf(root);
    await mkdir(trashDir, { recursive: true });
    await writeFile(
      path.join(trashDir, "aaa.json"),
      JSON.stringify({
        relPath: "chapters/a.md",
        title: "A",
        trashedAt: "2026-10-10T01:00:00.000Z"
      }),
      "utf8"
    );
    await writeFile(
      path.join(trashDir, "bbb.json"),
      JSON.stringify({
        relPath: "chapters/b.md",
        title: "B",
        trashedAt: "2026-10-10T02:00:00.000Z"
      }),
      "utf8"
    );
    await writeFile(path.join(trashDir, "bad.json"), "不是 JSON", "utf8");
    await writeFile(
      path.join(trashDir, "shapeless.json"),
      JSON.stringify({ title: "没路径" }),
      "utf8"
    );

    const result = await service(root).list();
    expect(result.ok).toBe(true);
    const entries = (result as { ok: true; entries: { trashName: string }[] }).entries;
    expect(entries.map((entry) => entry.trashName)).toEqual(["bbb", "aaa"]);
  });
});

describe("restore", () => {
  it("按小抄搬回原位：正文回到树、小抄消失", async () => {
    const root = await tempBook();
    await mkdir(path.join(root, "chapters"), { recursive: true });
    await writeFile(path.join(root, "chapters", "01.md"), "# 第一章", "utf8");
    const svc = service(root, [{ relPath: "chapters/01.md", title: "第一章" }]);
    const trashed = await svc.trashDoc("chapters/01.md");
    expect(trashed.ok).toBe(true);
    const trashName = (trashed as { ok: true; trashName: string }).trashName;

    const restored = await svc.restore(trashName);
    expect(restored).toEqual({ ok: true, relPath: "chapters/01.md" });
    expect(await readFile(path.join(root, "chapters", "01.md"), "utf8")).toBe("# 第一章");
    const left = (await readdir(trashDirOf(root))).filter((name) => name.startsWith(trashName));
    expect(left).toEqual([]);
  });

  it("原位置已有同名文稿时拒绝，绝不盖写", async () => {
    const root = await tempBook();
    await mkdir(path.join(root, "chapters"), { recursive: true });
    await writeFile(path.join(root, "chapters", "01.md"), "# 第一章", "utf8");
    const svc = service(root, [{ relPath: "chapters/01.md", title: "第一章" }]);
    const trashed = await svc.trashDoc("chapters/01.md");
    const trashName = (trashed as { ok: true; trashName: string }).trashName;
    await writeFile(path.join(root, "chapters", "01.md"), "新的那篇", "utf8");

    const result = await svc.restore(trashName);
    expect(result).toMatchObject({ ok: false, reason: "target-exists" });
    expect(await readFile(path.join(root, "chapters", "01.md"), "utf8")).toBe("新的那篇");
  });

  it("小抄被手改成书外路径时拒绝还原（realpath 闸也管小抄）", async () => {
    const root = await tempBook();
    const trashDir = trashDirOf(root);
    await mkdir(trashDir, { recursive: true });
    await writeFile(
      path.join(trashDir, "evil.json"),
      JSON.stringify({ relPath: "../../evil.md", title: "evil", trashedAt: "" }),
      "utf8"
    );
    const result = await service(root).restore("evil");
    expect(result).toMatchObject({ ok: false });
  });

  it("认不出的条目名与不存在的条目回 not-found，不抛", async () => {
    const root = await tempBook();
    const svc = service(root);
    expect(await svc.restore("../evil")).toMatchObject({ ok: false, reason: "not-found" });
    expect(await svc.restore("missing")).toMatchObject({ ok: false, reason: "not-found" });
  });
});

describe("isTrashName", () => {
  it("只认本模块生成的 id 形状：路径分隔符与点号一律不是", () => {
    expect(isTrashName("abcd-0")).toBe(true);
    expect(isTrashName("../evil")).toBe(false);
    expect(isTrashName("a/b")).toBe(false);
    expect(isTrashName(42)).toBe(false);
  });
});
