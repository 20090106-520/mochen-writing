import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CHANGE_RETENTION, DEFAULT_PERMISSION_MODE } from "@mochen/contracts";
import { defaultAtomicFs, makeFingerprint, type AtomicWriteFs } from "@mochen/fs-store";

import { createBookService } from "./book-service.js";

/**
 * 只坏 `rename` 那一步的 fs：临时文件写得进去、改名失败。
 *
 * 刻意挑 rename 而不是 writeFile：产品里「先 writeFile 到本体」的旧写法根本不经过 rename，
 * 于是注入一个坏 rename 的 fs 时旧代码会照样写成功——用例才有鉴别力（能红），而不是注入谁都能红。
 */
const brokenRenameFs: AtomicWriteFs = {
  ...defaultAtomicFs,
  rename: async () => {
    throw Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM" });
  }
};

let root = "";
let other = "";

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mochen-svc-"));
  other = await mkdtemp(path.join(tmpdir(), "mochen-svc2-"));
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
  // —— 删除作品（2026-11-24）：整本书目录移进系统回收站 ——
  describe("trash", () => {
    it("递给回收站通路的正是书根；删的不是当前书时快照原样不动", async () => {
      const trashed: string[] = [];
      const service = createBookService({
        retention: () => DEFAULT_CHANGE_RETENTION,
        trashItem: async (target) => {
          trashed.push(target);
        }
      });
      await service.open(root);
      const result = await service.trash(other);
      expect(result).toEqual({ ok: true });
      expect(trashed).toEqual([other]);
      // 当前书没被删：快照还活着，读写照常。
      expect(service.current()?.root).toBe(root);
      await service.close();
    });

    it("删的是当前打开的书：先关快照再删——回收站写盘期间没有半套状态", async () => {
      const events: string[] = [];
      const service = createBookService({
        retention: () => DEFAULT_CHANGE_RETENTION,
        trashItem: async () => {
          // 通路面板里取证：走到这里时快照必须已经关了。
          events.push(`current=${service.current()?.root ?? "null"}`);
        }
      });
      await service.open(root);
      const result = await service.trash(root);
      expect(result).toEqual({ ok: true });
      expect(events).toEqual(["current=null"]);
      await service.close();
    });

    it("回收站写入失败：回中文人话；当前书不假装没删过（快照保持关闭）", async () => {
      const service = createBookService({
        retention: () => DEFAULT_CHANGE_RETENTION,
        trashItem: async () => {
          throw new Error("EBUSY: resource busy");
        }
      });
      await service.open(root);
      const result = await service.trash(root);
      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.message).toContain("没能把这本书移进回收站");
      expect(service.current()).toBeNull();
      await service.close();
    });

    it("没接回收站通路（装配点忘传）⇒ 明确拒绝，绝不降级成直删", async () => {
      const service = createBookService({ retention: () => DEFAULT_CHANGE_RETENTION });
      const result = await service.trash(root);
      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.message).toContain("回收站通路没有接上");
      await service.close();
    });

    it("空路径 ⇒ 一句中文，一个盘上路径都不碰", async () => {
      const trashed: string[] = [];
      const service = createBookService({
        retention: () => DEFAULT_CHANGE_RETENTION,
        trashItem: async (target) => {
          trashed.push(target);
        }
      });
      const result = await service.trash("   ");
      expect(result.ok).toBe(false);
      expect(trashed).toEqual([]);
      await service.close();
    });
  });

  it("open 返回 meta 与按 chapterOrder 排好的文档列表", async () => {
    const service = createBookService({ retention: () => DEFAULT_CHANGE_RETENTION });
    const opened = await service.open(root);
    expect(opened.rootPath).toBe(root);
    expect(opened.meta.title).toBe("测试书");
    expect(opened.docs.map((d) => d.relPath)).toEqual(["chapters/01-a.md"]);
    await service.close();
  });

  it("book.json 非法时 open 抛中文可读错误", async () => {
    await writeFile(path.join(other, "book.json"), "{ not json");
    const service = createBookService({ retention: () => DEFAULT_CHANGE_RETENTION });
    await expect(service.open(other)).rejects.toThrow(/book\.json/);
    await service.close();
  });

  it("未打开书时 writeDoc 返回 io-error 且不崩", async () => {
    const service = createBookService({ retention: () => DEFAULT_CHANGE_RETENTION });
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
    const service = createBookService({ retention: () => DEFAULT_CHANGE_RETENTION });
    await expect(service.open(other)).rejects.toThrow(/activeStage/);
    await service.close();
  });

  it("saveMeta 写失败时：盘上仍是完整可读的旧 book.json，快照也不许刷新（P0-1）", async () => {
    const service = createBookService({
      retention: () => DEFAULT_CHANGE_RETENTION,
      fs: brokenRenameFs
    });
    const opened = await service.open(root);
    const before = await readFile(path.join(root, "book.json"), "utf8");

    await expect(service.saveMeta({ ...opened.meta, title: "改了一半的书名" })).rejects.toThrow();

    // 本体：book.json 是这本书的门牌，半截 JSON 会让「正文一篇没丢」变成「书打不开」。
    const onDisk = await readFile(path.join(root, "book.json"), "utf8");
    expect(onDisk).toBe(before);
    expect(() => JSON.parse(onDisk)).not.toThrow();
    // 失败后不许留临时文件残渣：否则每次改设置失败都在书目录里多一个 `.mochen-tmp-xxxx`。
    const entries = await readdir(root);
    expect(entries.filter((name) => name.includes("mochen-tmp"))).toEqual([]);
    // 没写成就不许刷新快照：否则界面上显示新书名、盘上还是旧的，权限档也跟着分家。
    expect(service.current()?.meta.title).toBe(opened.meta.title);
    await service.close();
  });

  it("mergeRecaps 只并这一格：用户刚存的书名不会被摘要回滚（审计 R-4）", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mochen-recap-"));
    await mkdir(path.join(dir, "chapters"), { recursive: true });
    await writeFile(path.join(dir, "chapters", "01-a.md"), "正文\n");
    await writeFile(
      path.join(dir, "book.json"),
      JSON.stringify({
        id: "b1",
        title: "旧书名",
        schemaVersion: 1,
        stages: [{ id: "draft", name: "正文" }],
        activeStage: "draft",
        permissionMode: DEFAULT_PERMISSION_MODE,
        chapterOrder: []
      })
    );
    const service = createBookService({ retention: () => DEFAULT_CHANGE_RETENTION });
    const opened = await service.open(dir);

    // 顺序就是事故顺序：摘要在生成期间用户改了书名，摘要随后才落盘。
    await service.saveMeta({ ...opened.meta, title: "用户改过的书名" });
    await service.mergeRecaps("chapters/01-a.md", "林夜拿到船票。");

    expect(service.current()?.meta.title).toBe("用户改过的书名");
    expect(service.current()?.meta.recaps?.["chapters/01-a.md"]).toBe("林夜拿到船票。");
    // 盘上也必须是同一份，否则重启后摘要没了、书名又被回滚。
    const onDisk = JSON.parse(await readFile(path.join(dir, "book.json"), "utf8")) as {
      title: string;
      recaps?: Record<string, string>;
    };
    expect(onDisk.title).toBe("用户改过的书名");
    expect(onDisk.recaps?.["chapters/01-a.md"]).toBe("林夜拿到船票。");

    await service.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("writeDoc 走的是装配进来的那份 fs（不传下去就等于原子写没接上）", async () => {
    const service = createBookService({
      retention: () => DEFAULT_CHANGE_RETENTION,
      fs: brokenRenameFs
    });
    await service.open(root);
    const fp = makeFingerprint("正文\n");

    const result = await service.writeDoc("chapters/01-a.md", "覆盖它\n", fp);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("改名失败绝不能报称写成功了");
    expect(result.reason).toBe("io-error");
    expect(await readFile(path.join(root, "chapters", "01-a.md"), "utf8")).toBe("正文\n");
    await service.close();
  });

  it("未打开书时 readDoc 与 saveMeta 抛「尚未打开作品目录」", async () => {
    const service = createBookService({ retention: () => DEFAULT_CHANGE_RETENTION });
    await expect(service.readDoc("chapters/01-a.md")).rejects.toThrow("尚未打开作品目录");
    await expect(service.saveMeta({} as never)).rejects.toThrow("尚未打开作品目录");
  });

  it("saveMeta 刷新 current().meta，权限档改了审批时立刻查得到", async () => {
    const service = createBookService({ retention: () => DEFAULT_CHANGE_RETENTION });
    const opened = await service.open(root);
    const before = service.current();
    if (before === null) throw new Error("打开后必须有快照");
    expect(before.root).toBe(root);
    expect(before.meta.title).toBe(opened.meta.title);
    expect(before.docs.map((doc) => doc.relPath)).toEqual(["chapters/01-a.md"]);
    await service.saveMeta({ ...before.meta, permissionMode: "chapter-write" });
    expect(service.current()?.meta.permissionMode).toBe("chapter-write");
    await service.close();
    expect(service.current()).toBeNull();
  });

  it("writeDoc 走指纹冲突：外部改动后拒绝", async () => {
    const service = createBookService({ retention: () => DEFAULT_CHANGE_RETENTION });
    await service.open(root);
    const first = await service.readDoc("chapters/01-a.md");
    await writeFile(path.join(root, "chapters/01-a.md"), "外部改过\n");
    const result = await service.writeDoc("chapters/01-a.md", "覆盖\n", first.fingerprint);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("不该走到这里");
    expect(result.reason).toBe("stale");
    await service.close();
  });

  it("createDoc 建出新文档且快照 docs 立刻含它（不用重开书）", async () => {
    const service = createBookService({ retention: () => DEFAULT_CHANGE_RETENTION });
    await service.open(root);
    const result = await service.createDoc("chapters/02-新章.md", "02-新章");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("不该走到这里");
    expect(service.current()?.docs.map((doc) => doc.relPath)).toContain("chapters/02-新章.md");
    const opened = service.current();
    const title = opened?.docs.find((doc) => doc.relPath === "chapters/02-新章.md")?.title;
    expect(title).toBe("02-新章");
    await service.close();
  });

  it("createDoc 同名已存在被拒且带人话理由", async () => {
    const service = createBookService({ retention: () => DEFAULT_CHANGE_RETENTION });
    await service.open(root);
    const again = await service.createDoc("chapters/02-新章.md", "02-新章");
    expect(again.ok).toBe(false);
    if (again.ok) throw new Error("不该走到这里");
    expect(again.reason).toBe("already-exists");
    expect(again.message).toContain("已经存在");
    await service.close();
  });

  it("未打开书时 createDoc 报 no-book", async () => {
    const service = createBookService({ retention: () => DEFAULT_CHANGE_RETENTION });
    const result = await service.createDoc("chapters/x.md", "x");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("不该走到这里");
    expect(result.reason).toBe("no-book");
  });

  it("createBook 在空目录建出骨架并直接返回 open 结果", async () => {
    const service = createBookService({ retention: () => DEFAULT_CHANGE_RETENTION });
    const empty = await mkdtemp(path.join(tmpdir(), "mochen-new-"));
    const result = await service.createBook({ directory: empty, title: "全新作品" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("不该走到这里");
    expect(result.book.meta.title).toBe("全新作品");
    expect(result.book.rootPath).toBe(empty);
    // 建完即开：current() 指向新书。
    expect(service.current()?.root).toBe(empty);
    await service.close();
    await rm(empty, { recursive: true, force: true });
  });

  it("新书默认档位跟 contracts 的裁定走，且真的落进 book.json", async () => {
    const service = createBookService({ retention: () => DEFAULT_CHANGE_RETENTION });
    const empty = await mkdtemp(path.join(tmpdir(), "mochen-default-"));
    const result = await service.createBook({ directory: empty, title: "默认档" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("不该走到这里");
    // 用户裁定「新书默认全开」写在 contracts；主进程不许自己捏一个档位名。
    expect(result.book.meta.permissionMode).toBe(DEFAULT_PERMISSION_MODE);
    // 只看返回值不够：写盘的那份也得是同一档，否则重启后档位会跳。
    const onDisk = JSON.parse(await readFile(path.join(empty, "book.json"), "utf8")) as {
      permissionMode: string;
    };
    expect(onDisk.permissionMode).toBe(DEFAULT_PERMISSION_MODE);
    await service.close();
    await rm(empty, { recursive: true, force: true });
  });

  it("createBook 把立项写进 book.json，并生成「创作约定」初稿", async () => {
    const service = createBookService({ retention: () => DEFAULT_CHANGE_RETENTION });
    const empty = await mkdtemp(path.join(tmpdir(), "mochen-project-"));
    const result = await service.createBook({
      directory: empty,
      title: "立项书",
      // 跨进程来的形状不可信：首尾空白由主进程的 normalizeBookProject 收掉，空串不落盘。
      project: { genre: " 都市异能 ", taboos: "", pitch: "小人物掀翻旧秩序" }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("不该走到这里");
    expect(result.book.meta.project).toEqual({ genre: "都市异能", pitch: "小人物掀翻旧秩序" });
    // 返回值与盘上必须是同一份，重启后立项不许跳。
    const onDisk = JSON.parse(await readFile(path.join(empty, "book.json"), "utf8")) as {
      project?: Record<string, string>;
    };
    expect(onDisk.project).toEqual({ genre: "都市异能", pitch: "小人物掀翻旧秩序" });
    // 「创作约定」真的建出来了，而且建完即扫到文稿树里。
    const convention = await readFile(path.join(empty, "outline/创作约定.md"), "utf8");
    expect(convention).toContain("**题材 / 频道**：都市异能");
    expect(result.book.docs.some((doc) => doc.relPath === "outline/创作约定.md")).toBe(true);
    await service.close();
    await rm(empty, { recursive: true, force: true });
  });

  it("createBook 不传立项时不写这一格、不生成创作约定（旧调用方逐字不变）", async () => {
    const service = createBookService({ retention: () => DEFAULT_CHANGE_RETENTION });
    const empty = await mkdtemp(path.join(tmpdir(), "mochen-no-project-"));
    const result = await service.createBook({ directory: empty, title: "不立项" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("不该走到这里");
    expect(result.book.meta.project).toBeUndefined();
    const onDisk = JSON.parse(await readFile(path.join(empty, "book.json"), "utf8")) as {
      project?: unknown;
    };
    expect(onDisk.project).toBeUndefined();
    await expect(readdir(path.join(empty, "outline"))).resolves.toEqual([]);
    await service.close();
    await rm(empty, { recursive: true, force: true });
  });

  it("createBook 拒绝非空目录与空书名", async () => {
    const service = createBookService({ retention: () => DEFAULT_CHANGE_RETENTION });
    const occupied = await service.createBook({ directory: root, title: "想盖到别人头上" });
    expect(occupied.ok).toBe(false);
    if (occupied.ok) throw new Error("不该走到这里");
    expect(occupied.message).toContain("不是空的");
    const noTitle = await service.createBook({ directory: root, title: "   " });
    expect(noTitle.ok).toBe(false);
    await service.close();
  });

  it("renameDoc 真的改名，并迁移 chapterOrder 与 recaps 的键（2026-11-20）", async () => {
    const service = createBookService({ retention: () => DEFAULT_CHANGE_RETENTION });
    await service.open(root);
    await service.createDoc("chapters/90-旧名.md", "90-旧名");
    const meta = service.current()?.meta;
    if (meta === undefined) throw new Error("书该开着");
    await service.saveMeta({
      ...meta,
      chapterOrder: ["chapters/90-旧名.md"],
      recaps: { "chapters/90-旧名.md": "旧摘要" }
    });
    // 2026-11-20 P0：会话文件的章节归属在首行 meta 的 docRelPath（文件名只有日期与 sessionId）。
    // 预埋一条这一章的会话，改名后首行必须跟着换成新路径，否则这一章的 AI 历史成孤儿。
    const sessionDir = path.join(root, ".mochen", "sessions", "2026", "11", "20");
    await mkdir(sessionDir, { recursive: true });
    const sessionFile = path.join(sessionDir, "rollout-20261120-120000-s1.jsonl");
    await writeFile(
      sessionFile,
      `${JSON.stringify({
        type: "session-meta",
        sessionId: "s1",
        docRelPath: "chapters/90-旧名.md",
        stageId: "draft",
        model: "test-model",
        startedAt: "2026-11-20T12:00:00.000Z"
      })}\n${JSON.stringify({ type: "user-message", id: "e1", turnId: "t1", ts: "2026-11-20T12:00:01.000Z", text: "开场" })}\n`
    );
    const result = await service.renameDoc("chapters/90-旧名.md", "91-新名");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("不该走到这里");
    expect(result.relPath).toBe("chapters/91-新名.md");
    expect(result.meta.chapterOrder).toEqual(["chapters/91-新名.md"]);
    expect(result.meta.recaps?.["chapters/91-新名.md"]).toBe("旧摘要");
    expect(result.meta.recaps?.["chapters/90-旧名.md"]).toBeUndefined();
    const files = await readdir(path.join(root, "chapters"));
    expect(files).toContain("91-新名.md");
    expect(files).not.toContain("90-旧名.md");
    // 只看回执不够：重开一份也要读到迁移后的键，否则「排序/摘要丢了」只在下次启动暴露。
    const onDisk = JSON.parse(await readFile(path.join(root, "book.json"), "utf8")) as {
      chapterOrder: string[];
      recaps: Record<string, string>;
    };
    expect(onDisk.chapterOrder).toEqual(["chapters/91-新名.md"]);
    expect(onDisk.recaps["chapters/91-新名.md"]).toBe("旧摘要");
    // 会话首行同样要看盘上真身（2026-11-20 P0）：回执 ok 不代表首行真换了，只换内存会两头分家。
    expect(result.sessionWarning).toBeNull();
    const sessionLines = (await readFile(sessionFile, "utf8")).split("\n");
    const migratedMeta = JSON.parse(sessionLines[0] ?? "") as { docRelPath: string };
    expect(migratedMeta.docRelPath).toBe("chapters/91-新名.md");
    // 首行之后的事件一个字都不能动：迁移只换归属，不碰历史内容。
    expect(sessionLines[1]).toContain('"开场"');
    // 收尾：把这一轮造的排序/摘要清掉，别让后跑的用例读到。
    await service.saveMeta({ ...service.current()!.meta, chapterOrder: [], recaps: {} });
    await rm(path.join(root, "chapters", "91-新名.md"), { force: true });
    await rm(path.join(root, ".mochen"), { recursive: true, force: true });
    await service.close();
  });

  it("renameDoc 目标已存在时拒绝，两篇都不动", async () => {
    const service = createBookService({ retention: () => DEFAULT_CHANGE_RETENTION });
    await service.open(root);
    await service.createDoc("chapters/92-甲.md", "92-甲");
    await service.createDoc("chapters/93-乙.md", "93-乙");
    const result = await service.renameDoc("chapters/92-甲.md", "93-乙");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("不该走到这里");
    expect(result.reason).toBe("exists");
    expect(result.message).toContain("没有覆盖");
    const files = await readdir(path.join(root, "chapters"));
    expect(files).toContain("92-甲.md");
    expect(files).toContain("93-乙.md");
    await rm(path.join(root, "chapters", "92-甲.md"), { force: true });
    await rm(path.join(root, "chapters", "93-乙.md"), { force: true });
    await service.close();
  });

  it("renameDoc 的保留名与未开书各自给对理由", async () => {
    const idle = createBookService({ retention: () => DEFAULT_CHANGE_RETENTION });
    const noBook = await idle.renameDoc("chapters/01-a.md", "新名");
    expect(noBook.ok).toBe(false);
    if (noBook.ok) throw new Error("不该走到这里");
    expect(noBook.reason).toBe("no-book");

    const service = createBookService({ retention: () => DEFAULT_CHANGE_RETENTION });
    await service.open(root);
    const reserved = await service.renameDoc("chapters/01-a.md", "CON");
    expect(reserved.ok).toBe(false);
    if (reserved.ok) throw new Error("不该走到这里");
    expect(reserved.reason).toBe("invalid-path");
    expect(reserved.message).toContain("CON");
    await service.close();
  });
});
