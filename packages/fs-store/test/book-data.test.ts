import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BOOK_DATA_FILENAMES,
  bookDataPath,
  isBookDataKey,
  readBookData,
  writeBookData
} from "../src/book-data.js";
import { fsBrokenAt } from "./atomic-write-fixture.js";

/**
 * 设定与笔记的**读书通路**（2026-10-09 扫描总单 P0-7）。
 *
 * 病根：笔记、故事圣经、写作目标三个 store 只住 `localStorage`，键还不带书标识
 * （`mochen.notes.v1` 等）⇒ ① 两本书的人物设定互相串台；② 清缓存 / 换电脑 / 重装系统
 * 就把设定整批丢掉，而正文安全地躺在盘上——用户在里的观感是「软件删了我的心血」。
 *
 * 这一层要守的三件事，用例逐条对得上：
 * ① **路径由主进程拼**：渲染层只递一枚白名单里的键（与技能市场、插件同一条铁律，
 *    传路径等于让渲染层决定读写哪）；
 * ② **写下去的必须是能读回来的 JSON**：坏数据不许盖在好数据上；
 * ③ **写失败就是失败**：沿用 P0-1 那套原子写，半截文件与「静默成功」都不接受。
 */

async function freshRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "mochen-book-data-"));
}

/** 列出目录里的文件名（用来证明临时文件没留在盘上）。 */
async function namesIn(dir: string): Promise<string[]> {
  return (await readdir(dir, { withFileTypes: true })).map((e) => e.name).sort();
}

describe("book-data：键白名单", () => {
  it("三枚键各自登记在 .mochen/data/ 下，文件名固定", () => {
    // 这枚表是「书里到底有哪几份设定数据」的唯一事实源：加第四枚必须在这里加，
    // 而不是在某个 store 里顺手拼一个路径。
    expect(Object.keys(BOOK_DATA_FILENAMES).sort()).toEqual(
      ["notes", "story-bible", "writing-goal"].sort()
    );
    expect(BOOK_DATA_FILENAMES.notes).toBe("notes.json");
    expect(BOOK_DATA_FILENAMES["story-bible"]).toBe("story-bible.json");
    expect(BOOK_DATA_FILENAMES["writing-goal"]).toBe("writing-goal.json");
  });

  it("拼出来的路径全在 .mochen/data/ 里，且 .mochen 不会被书目扫描认成正文", () => {
    const p = bookDataPath("/book", "notes");
    expect(p.startsWith(path.join("/book", ".mochen", "data"))).toBe(true);
    expect(p.split(path.sep).join("/")).toBe("/book/.mochen/data/notes.json");
  });

  it("白名单外的『键』一律不认：路径穿越、真实文件名、空串、非字符串都不行", () => {
    expect(isBookDataKey("../book.json")).toBe(false);
    expect(isBookDataKey("notes.json")).toBe(false);
    expect(isBookDataKey("")).toBe(false);
    expect(isBookDataKey("../../../etc/passwd")).toBe(false);
    expect(isBookDataKey(undefined)).toBe(false);
    expect(isBookDataKey({ key: "notes" })).toBe(false);
    // 原型链上的名字不许冒充键：`Object.hasOwn` 而不是 `in`。
    expect(isBookDataKey("toString")).toBe(false);
    expect(isBookDataKey("constructor")).toBe(false);
  });
});

describe("book-data：读", () => {
  it("没有文件＝这本书还没有设定，是正常状态而不是错误", async () => {
    const root = await freshRoot();
    const got = await readBookData(root, "notes");
    expect(got).toEqual({ ok: true, json: null });
  });

  it("写进去再读回来是同一份字节（一个字符都不许多、也不许少）", async () => {
    const root = await freshRoot();
    const json = JSON.stringify([{ id: "n1", content: "海雾" }]);
    const written = await writeBookData(root, "notes", json);
    expect(written).toEqual({ ok: true });
    const got = await readBookData(root, "notes");
    expect(got).toEqual({ ok: true, json });
    expect(await readFile(bookDataPath(root, "notes"), "utf8")).toBe(json);
  });

  it("那一枚是个目录（形状不对）⇒ unreadable，绝不退化成「没有」", async () => {
    // 退化成 null 会把用户的设定读成空库：下一次保存就写一份空的盖在目录上（或直接失败），
    // 而屏上毫无异样。报 unreadable 让调用方**不敢**继续写。
    const root = await freshRoot();
    await mkdir(bookDataPath(root, "story-bible"), { recursive: true });
    const got = await readBookData(root, "story-bible");
    expect(got.ok).toBe(false);
    if (got.ok === false) expect(got.reason).toBe("unreadable");
  });
});

describe("book-data：写", () => {
  it("首写把 .mochen/data/ 建出来（新书的设定目录本来就不存在）", async () => {
    const root = await freshRoot();
    const written = await writeBookData(root, "writing-goal", JSON.stringify({ goal: 1 }));
    expect(written).toEqual({ ok: true });
    expect(await namesIn(path.join(root, ".mochen", "data"))).toEqual(["writing-goal.json"]);
  });

  it("读不回 JSON 的字符串不许盖在好数据上：写被拒、旧内容一字未变", async () => {
    const root = await freshRoot();
    const good = JSON.stringify([{ id: "n1" }]);
    await writeBookData(root, "notes", good);
    const bad = await writeBookData(root, "notes", "{半截");
    expect(bad.ok).toBe(false);
    if (bad.ok === false) expect(bad.reason).toBe("not-json");
    expect(await readBookData(root, "notes")).toEqual({ ok: true, json: good });
  });

  it("空串与纯空白同样拒收（它们会被『读成空库』那条路吃掉）", async () => {
    const root = await freshRoot();
    await mkdir(path.dirname(bookDataPath(root, "notes")), { recursive: true });
    await writeFile(bookDataPath(root, "notes"), '{"keep":1}', "utf8");
    expect((await writeBookData(root, "notes", "")).ok).toBe(false);
    expect((await writeBookData(root, "notes", "   ")).ok).toBe(false);
    expect(await readBookData(root, "notes")).toEqual({ ok: true, json: '{"keep":1}' });
  });

  it("rename 那一步抛错：报 write-failed、旧内容完好、临时文件不留", async () => {
    const root = await freshRoot();
    const good = JSON.stringify([{ id: "n1" }]);
    await writeBookData(root, "notes", good);
    const broken = await writeBookData(
      root,
      "notes",
      JSON.stringify([{ id: "n1" }, { id: "n2" }]),
      fsBrokenAt("rename", "EPERM 被占用", "EPERM")
    );
    expect(broken.ok).toBe(false);
    if (broken.ok === false) expect(broken.reason).toBe("write-failed");
    // 这三条各守一个后果：① 数据没半截；② 调用方拿得到失败、界面能报；③ 不留垃圾。
    expect(await readBookData(root, "notes")).toEqual({ ok: true, json: good });
    expect(await namesIn(path.join(root, ".mochen", "data"))).toEqual(["notes.json"]);
  });

  it("同一枚键连写两次，盘上始终只有一份", async () => {
    const root = await freshRoot();
    await writeBookData(root, "notes", "[1]");
    await writeBookData(root, "notes", "[1,2]");
    expect(await namesIn(path.join(root, ".mochen", "data"))).toEqual(["notes.json"]);
    expect(await readBookData(root, "notes")).toEqual({ ok: true, json: "[1,2]" });
  });
});
