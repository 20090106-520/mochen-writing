import { describe, expect, it } from "vitest";
import {
  BACKUP_NAME_RE,
  backupCreatedAtLabel,
  backupDirOf,
  backupNameFor,
  createBookBackupService,
  type BackupFs
} from "./book-backup.js";

/**
 * 整书备份（2026-10-10）。真实现绑 node:fs/promises，这里全走内存件——
 * 判定（daily 去重、保留上限、恢复落点与盖写防线）是本模块的本体，必须一条条钉。
 */

interface MemNode {
  kind: "file" | "dir";
  data?: Uint8Array;
  children?: Map<string, MemNode>;
}

function memFs(): { fs: BackupFs; root: Map<string, MemNode> } {
  const root: Map<string, MemNode> = new Map();
  const nodeAt = (p: string): MemNode | null => {
    const parts = p.split(/[\\/]+/).filter((s) => s !== "" && s !== ".");
    let node: MemNode | null = null;
    let level = root;
    for (const part of parts) {
      node = level.get(part) ?? null;
      if (node === null) return null;
      level = node.children ?? new Map();
    }
    return node;
  };
  const parentOf = (p: string): { level: Map<string, MemNode>; name: string } | null => {
    const parts = p.split(/[\\/]+/).filter((s) => s !== "" && s !== ".");
    const name = parts[parts.length - 1];
    if (name === undefined) return null;
    let level = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const node = level.get(parts[i]!);
      if (node?.children === undefined) return null;
      level = node.children;
    }
    return { level, name };
  };
  const fs: BackupFs = {
    async mkdir(dir) {
      const parts = dir.split(/[\\/]+/).filter((s) => s !== "" && s !== ".");
      let level = root;
      for (const part of parts) {
        const existing = level.get(part);
        if (existing === undefined) {
          const node: MemNode = { kind: "dir", children: new Map() };
          level.set(part, node);
          level = node.children!;
        } else {
          level = existing.children!;
        }
      }
    },
    async readdir(dir) {
      const node = nodeAt(dir);
      if (node?.children === undefined) throw new Error(`ENOTDIR ${dir}`);
      return [...node.children.keys()];
    },
    async readFile(p) {
      const node = nodeAt(p);
      if (node?.kind !== "file") throw new Error(`ENOENT ${p}`);
      return node.data!;
    },
    async writeFile(p, data) {
      const parent = parentOf(p);
      if (parent === null) throw new Error(`ENOENT ${p}`);
      parent.level.set(parent.name, { kind: "file", data });
    },
    async rm(p, opts) {
      const node = nodeAt(p);
      if (node === null) {
        if (opts.force) return;
        throw new Error(`ENOENT ${p}`);
      }
      const parent = parentOf(p);
      parent?.level.delete(parent.name);
    },
    async exists(p) {
      return nodeAt(p) !== null;
    }
  };
  return { fs, root };
}

/** 造一本最小书：chapters/ 一篇 + book.json + .mochen/ 一样东西。 */
async function seedBook(fs: BackupFs, root: string): Promise<void> {
  await fs.mkdir(`${root}/chapters`, { recursive: true });
  await fs.mkdir(`${root}/.mochen/trash`, { recursive: true });
  await fs.writeFile(`${root}/book.json`, new TextEncoder().encode('{"title":"书"}'));
  await fs.writeFile(`${root}/chapters/第一章.md`, new TextEncoder().encode("正文一"));
  await fs.writeFile(`${root}/.mochen/trash/x.md`, new TextEncoder().encode("废稿"));
}

function serviceWith(root: string, clock: Date[], retain?: number) {
  const { fs } = memFs();
  let tick = 0;
  return {
    service: createBookBackupService({
      bookRoot: () => root,
      fs,
      now: () => clock[Math.min(tick++, clock.length - 1)]!,
      ...(retain === undefined ? {} : { retain })
    }),
    fs
  };
}

const T0 = new Date(2026, 9, 10, 19, 52, 30);
const T1 = new Date(2026, 9, 10, 20, 0, 0);
const T2 = new Date(2026, 9, 11, 8, 0, 0);

describe("book-backup：名与目录的真身", () => {
  it("备份目录在 <书>/.mochen/backups（与回收站同一口径：扫描器不进的运行时格）", () => {
    expect(backupDirOf("C:/书")).toContain(".mochen");
    expect(backupDirOf("C:/书")).toContain("backups");
  });

  it("名字形状 book-yyyy-MM-dd-HH-mm-ss-mmm；旧备份（秒精度）与人话时间照旧认", () => {
    expect(backupNameFor(T0)).toBe("book-2026-10-10-19-52-30-000");
    expect(BACKUP_NAME_RE.test("book-2026-10-10-19-52-30-000")).toBe(true);
    // 旧形状（秒精度）必须继续认：用户盘上已经躺着的那批备份不许失联。
    expect(BACKUP_NAME_RE.test("book-2026-10-10-19-52-30")).toBe(true);
    expect(BACKUP_NAME_RE.test("book-2026-10-10")).toBe(false);
    expect(backupCreatedAtLabel("book-2026-10-10-19-52-30-000")).toBe("2026-10-10 19:52:30");
    expect(backupCreatedAtLabel("book-2026-10-10-19-52-30")).toBe("2026-10-10 19:52:30");
    expect(backupCreatedAtLabel("something-else")).toBe("");
  });
});

describe("create：复制什么、何时跳过", () => {
  it("manual 档整本书抄进去，.mochen 一根手指都不碰", async () => {
    const { service, fs } = serviceWith("C:/书", [T0]);
    await seedBook(fs, "C:/书");
    const result = await service.create("manual");
    expect(result).toEqual({ ok: true, name: "book-2026-10-10-19-52-30-000", fileCount: 2 });
    expect(
      new TextDecoder().decode(
        await fs.readFile("C:/书/.mochen/backups/book-2026-10-10-19-52-30-000/chapters/第一章.md")
      )
    ).toBe("正文一");
    expect(await fs.exists("C:/书/.mochen/backups/book-2026-10-10-19-52-30-000/.mochen")).toBe(
      false
    );
  });

  it("原子写的半成品既不进备份也不进计数（2026-10-11 真机：备份里躺过 .mochen-tmp-xxxx）", async () => {
    const { service, fs } = serviceWith("C:/书", [T0]);
    await seedBook(fs, "C:/书");
    // 半成品只在「写完、改名之前」那几十毫秒里存在：这里就停在那一刻。
    await fs.writeFile(
      "C:/书/chapters/第一章.md.mochen-tmp-9e4a8d8c",
      new TextEncoder().encode("写到一半")
    );
    const result = await service.create("manual");
    // 计数仍只有 book.json + 正文那两件。
    expect(result).toEqual({ ok: true, name: "book-2026-10-10-19-52-30-000", fileCount: 2 });
    expect(await fs.readdir("C:/书/.mochen/backups/book-2026-10-10-19-52-30-000/chapters")).toEqual(
      ["第一章.md"]
    );
    // 还原走同一个 copyTree：旧备份里躺着的半成品也不许被放生到书旁的新目录。
    await fs.writeFile(
      "C:/书/.mochen/backups/book-2026-10-10-19-52-30-000/chapters/第一章.md.mochen-tmp-deadbeef",
      new TextEncoder().encode("写到一半")
    );
    expect(await service.restore("book-2026-10-10-19-52-30-000")).toEqual({
      ok: true,
      destName: "书-恢复自备份-2026-10-10-19-52-30-000"
    });
    expect(await fs.readdir("C:/书-恢复自备份-2026-10-10-19-52-30-000/chapters")).toEqual([
      "第一章.md"
    ]);
  });

  it("daily 档今天已备过就什么都不做（name: null 是正常结果不是失败）", async () => {
    const { service, fs } = serviceWith("C:/书", [T0, T1]);
    await seedBook(fs, "C:/书");
    expect(await service.create("daily")).toEqual({
      ok: true,
      name: "book-2026-10-10-19-52-30-000",
      fileCount: 2
    });
    expect(await service.create("daily")).toEqual({ ok: true, name: null, fileCount: 0 });
    // manual 档同一天照样再备一份：手动按钮不许被去重挡住。
    const again = await service.create("manual");
    expect(again).toEqual({ ok: true, name: "book-2026-10-10-20-00-00-000", fileCount: 2 });
  });

  it("跨天 daily 再备一份（去重键是「哪一天」，不是「有没有备过」）", async () => {
    const { service, fs } = serviceWith("C:/书", [T0, T2]);
    await seedBook(fs, "C:/书");
    await service.create("daily");
    const next = await service.create("daily");
    expect(next).toEqual({ ok: true, name: "book-2026-10-11-08-00-00-000", fileCount: 2 });
  });

  it("没开书回 no-book；半途失败拆掉半成品目录", async () => {
    // 没开书的句柄单独造：serviceWith 那只永远有书。
    const none = createBookBackupService({ bookRoot: () => null, fs: memFs().fs, now: () => T0 });
    expect(await none.create("manual")).toEqual({
      ok: false,
      reason: "no-book",
      message: expect.stringContaining("还没打开作品")
    });
    // 半途失败用例只要 fs：serviceWith 那只服务先备好一份合法书，再把写盘掰断。
    const { fs } = serviceWith("C:/书", [T0]);
    await seedBook(fs, "C:/书");
    // 先种好一本能读的书，再把 writeFile 掰断 ⇒ copyTree 半途炸。
    fs.writeFile = async () => {
      throw new Error("盘满");
    };
    const bad = createBookBackupService({ bookRoot: () => "C:/书", fs, now: () => T0 });
    const failed = await bad.create("manual");
    expect(failed).toEqual({
      ok: false,
      reason: "io-error",
      message: expect.stringContaining("盘满")
    });
    // 半成品拆干净（mkdir 建出的 backups 外壳留着没关系，里面不能有半份备份）。
    const leftovers = await fs.readdir("C:/书/.mochen/backups");
    expect(leftovers).toEqual([]);
  });
});

describe("list 与保留上限", () => {
  it("列表新的在前，人话时间跟着名字走", async () => {
    const { service, fs } = serviceWith("C:/书", [T0, T1]);
    await seedBook(fs, "C:/书");
    await service.create("manual");
    await service.create("manual");
    const list = await service.list();
    expect(list.ok && list.entries.map((e) => e.name)).toEqual([
      "book-2026-10-10-20-00-00-000",
      "book-2026-10-10-19-52-30-000"
    ]);
  });

  it("保留上限：超限清最旧的，backups 里外来目录不碰", async () => {
    const { service, fs } = serviceWith("C:/书", [T0, T1, T2], 2);
    await seedBook(fs, "C:/书");
    await fs.mkdir("C:/书/.mochen/backups/我的手工备份", { recursive: true });
    await service.create("manual");
    await service.create("manual");
    await service.create("manual");
    const list = await service.list();
    expect(list.ok && list.entries.map((e) => e.name)).toEqual([
      "book-2026-10-11-08-00-00-000",
      "book-2026-10-10-20-00-00-000"
    ]);
    expect(await fs.exists("C:/书/.mochen/backups/我的手工备份")).toBe(true);
  });
});

describe("restore：落点与盖写防线", () => {
  it("恢复到书旁新目录，不碰当前打开的书", async () => {
    const { service, fs } = serviceWith("C:/书", [T0]);
    await seedBook(fs, "C:/书");
    await service.create("manual");
    const result = await service.restore("book-2026-10-10-19-52-30-000");
    expect(result).toEqual({ ok: true, destName: "书-恢复自备份-2026-10-10-19-52-30-000" });
    expect(
      new TextDecoder().decode(
        await fs.readFile("C:/书-恢复自备份-2026-10-10-19-52-30-000/chapters/第一章.md")
      )
    ).toBe("正文一");
    // 原书原样还在（恢复期间它保持可写）。
    expect(new TextDecoder().decode(await fs.readFile("C:/书/chapters/第一章.md"))).toBe("正文一");
  });

  it("目标目录已存在时顺位加号，绝不盖写", async () => {
    const { service, fs } = serviceWith("C:/书", [T0]);
    await seedBook(fs, "C:/书");
    await service.create("manual");
    await fs.mkdir("C:/书-恢复自备份-2026-10-10-19-52-30-000", { recursive: true });
    await fs.writeFile(
      "C:/书-恢复自备份-2026-10-10-19-52-30-000/旧文件.txt",
      new TextEncoder().encode("别动我")
    );
    const result = await service.restore("book-2026-10-10-19-52-30-000");
    expect(result).toEqual({ ok: true, destName: "书-恢复自备份-2026-10-10-19-52-30-000-2" });
    expect(
      new TextDecoder().decode(
        await fs.readFile("C:/书-恢复自备份-2026-10-10-19-52-30-000/旧文件.txt")
      )
    ).toBe("别动我");
  });

  it("名字不合形状（带路径分隔符、随便一串）与不存在的备份都回 not-found", async () => {
    const { service, fs } = serviceWith("C:/书", [T0]);
    await seedBook(fs, "C:/书");
    await service.create("manual");
    for (const bad of [
      "..",
      "book-2026-10-10-19-52-30-000/../../etc",
      "随便",
      "book-2026-13-99-00-00-00"
    ]) {
      expect(await service.restore(bad)).toEqual({
        ok: false,
        reason: "not-found",
        message: expect.any(String)
      });
    }
    expect(await service.restore("book-2020-01-01-00-00-00")).toEqual({
      ok: false,
      reason: "not-found",
      message: expect.stringContaining("没有这一份")
    });
  });
});
