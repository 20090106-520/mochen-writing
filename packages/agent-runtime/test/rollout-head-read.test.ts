// P1-5（2026-10-09 全仓扫描）：三个「只为拿首行/标题」的定位函数过去都把每个 .jsonl 整篇读进内存
// （`rollout.ts` 的 readFile + split("\n")[0]）。实测 200 条会话 × 60 事件 ⇒ 真读 6.13 MB 而只需 0.10 MB
// （59 倍）；500 条 × 200 事件 ⇒ 51.3 MB vs 0.26 MB（198 倍，首行定位 681 倍）——用得越久越慢。
// 本文件两件事：① 用确定性 IO 证明「读的字节不随会话长度增长」；② 证明改读头部之后与整篇读**同口径**
// （深处的首条 user-message、跨块的多字节汉字、超长首行、无尾换行、坏首行、读不到的文件都照旧）。
// IO 计量沿用仓里既有先例（fs-store/test/scan-excerpt.test.ts）：vi.mock 转发真实实现，仍然真读盘。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { open, readFile } from "node:fs/promises";
import type { SessionMeta } from "@mochen/contracts";
import {
  HEAD_CHUNK,
  SESSIONS_DIR,
  findLatestSession,
  findSessionById,
  listSessions
} from "../src/rollout.js";

/**
 * 头部读的记账：`reads` 记每次 `filehandle.read` 要的 (position, length)。
 * 用 vi.hoisted 是因为 vi.mock 的工厂会被提到模块顶层之前执行，直接引用 const 会撞 TDZ。
 */
const head = vi.hoisted(() => ({ reads: [] as { position: number; length: number }[] }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const counted: Record<string, unknown> = { ...actual };
  counted.readFile = vi.fn((...args: Parameters<typeof actual.readFile>) =>
    (actual.readFile as (...rest: unknown[]) => Promise<unknown>)(...args)
  );
  counted.open = vi.fn(async (...args: Parameters<typeof actual.open>) => {
    const handle = await (actual.open as (...rest: unknown[]) => Promise<unknown>)(...args);
    const real = handle as Awaited<ReturnType<typeof actual.open>>;
    const realRead = real.read.bind(real) as (
      buffer: Uint8Array,
      offset?: number,
      length?: number,
      position?: number | null
    ) => Promise<{ bytesRead: number; buffer: Uint8Array }>;
    // 把 read 换成「记下要了多少字节，再转给真实现」：判据要的是字节跨度，不是耗时（本机有 dev 在跑，计时必抖）。
    Object.defineProperty(real, "read", {
      configurable: true,
      writable: true,
      value: async (
        buffer: Uint8Array,
        offset = 0,
        length = buffer.byteLength - offset,
        position: number | null = 0
      ) => {
        head.reads.push({ position: position ?? 0, length });
        return realRead(buffer, offset, length, position);
      }
    });
    return real;
  });
  return counted;
});

const readFileMock = readFile as unknown as Mock;
const openMock = open as unknown as Mock;

const meta: SessionMeta = {
  type: "session-meta",
  sessionId: "s-head",
  docRelPath: "chapters/01-潮线.md",
  stageId: "draft",
  model: "test-model",
  startedAt: "2026-10-04T12:00:00.000Z"
};
const turn = { id: "e1", ts: "2026-10-04T12:00:01.000Z", turnId: "t1" };

/** 一条 assistant 行（~200 字节）：撑长度用，标题判据要跳过它们。 */
function messageLine(index: number): string {
  return JSON.stringify({
    ...turn,
    id: `m${index}`,
    type: "message",
    text: `第 ${index} 次回话：把雾的意象收掉三处，节奏放慢半拍，这一段留给你自己判断。`,
    interrupted: false
  });
}

function userLine(text: string, id = "u1"): string {
  return JSON.stringify({ ...turn, id, type: "user-message", text });
}

const relOf = (sessionId: string): string =>
  `${SESSIONS_DIR}/2026/10/04/rollout-20261004-120000-${sessionId}.jsonl`;

/** 直接落一份手写会话文件（createSession 管不了行内容与条数）。 */
async function writeSession(book: string, sessionId: string, lines: string[]): Promise<string> {
  const abs = path.join(book, ...relOf(sessionId).split("/"));
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, `${lines.join("\n")}\n`, "utf8");
  return relOf(sessionId);
}

/** 一次调用的 IO 足迹：读过的最高字节位置（position + length 的最大值）。 */
async function footprint<T>(call: () => Promise<T>): Promise<{ reached: number; result: T }> {
  head.reads.length = 0;
  const result = await call();
  const reached = head.reads.reduce((max, r) => Math.max(max, r.position + r.length), 0);
  return { reached, result };
}

let root = "";
let shortBook = "";
let longBook = "";

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mochen-head-"));
  // 两本书**首两行完全一致**，只差会话长度：短的一律 150 条事件，长的 1500 条。
  // 于是「读到的字节跨度」在两本书之间必须相等——不等就说明读得随长度增长（P1-5 的原形）。
  shortBook = await mkdtemp(path.join(root, "short-"));
  longBook = await mkdtemp(path.join(root, "long-"));
  for (const [book, events] of [
    [shortBook, 150],
    [longBook, 1500]
  ] as const) {
    const lines = [JSON.stringify(meta), userLine("把开头收紧，雾不要重复三次")];
    for (let i = 1; i <= events; i++) lines.push(messageLine(i));
    await writeSession(book, "s-head", lines);
  }
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("定位一条会话不再整篇读（P1-5）", () => {
  it("三个定位函数都不再发整篇 readFile", async () => {
    readFileMock.mockClear();
    openMock.mockClear();
    await findLatestSession(longBook, meta.docRelPath);
    await listSessions(longBook);
    await findSessionById(longBook, meta.docRelPath, meta.sessionId);
    expect(readFileMock.mock.calls.length).toBe(0);
    expect(openMock.mock.calls.length).toBe(3); // 每个函数各开一次那个文件
  });

  it("读过的字节跨度不随会话长度增长：150 条与 1500 条花的字节一模一样", async () => {
    const shortRun = await footprint(() => findLatestSession(shortBook, meta.docRelPath));
    const longRun = await footprint(() => findLatestSession(longBook, meta.docRelPath));
    expect(shortRun.result).toBe(relOf("s-head"));
    expect(longRun.result).toBe(relOf("s-head"));
    // 先证明「确实读过头部」，否则两个 0 相等是假绿。
    expect(longRun.reached).toBeGreaterThan(0);
    expect(longRun.reached).toBe(shortRun.reached);
    // 反向鉴别：整篇读时长文件要读完 ~300 KB 而短文件只有 ~30 KB，两者绝不可能相等。
    expect(longRun.reached).toBeLessThan(64 * 1024);
  });

  it("历史面板取标题同样只看头部：长会话的标题不靠读完整篇", async () => {
    const shortRun = await footprint(() => listSessions(shortBook));
    const longRun = await footprint(() => listSessions(longBook));
    expect(longRun.result[0]?.title).toBe("把开头收紧，雾不要重复三次");
    expect(longRun.reached).toBeGreaterThan(0);
    expect(longRun.reached).toBe(shortRun.reached);
  });

  it("按 id 定位那条线程也只读头部", async () => {
    const run = await footprint(() => findSessionById(longBook, meta.docRelPath, meta.sessionId));
    expect(run.result).toBe(relOf("s-head"));
    expect(run.reached).toBeGreaterThan(0);
    expect(run.reached).toBeLessThan(64 * 1024);
  });
});

describe("改读头部之后与整篇读同口径（等价性）", () => {
  it("首条 user-message 埋在几百行之后：仍一路读到它，标题取得到", async () => {
    const book = await mkdtemp(path.join(root, "deep-"));
    const lines = [JSON.stringify(meta)];
    for (let i = 1; i <= 600; i++) lines.push(messageLine(i));
    lines.push(userLine("这句在 120 KB 之后", "u-deep"));
    for (let i = 601; i <= 1200; i++) lines.push(messageLine(i));
    await writeSession(book, "s-deep", lines);

    const items = await listSessions(book);
    expect(items[0]?.title).toBe("这句在 120 KB 之后");
  });

  it("一行跨好几个读取块：照样拼成完整一行，标题取得到", async () => {
    const book = await mkdtemp(path.join(root, "cjk-"));
    // 16000 个汉字 ≈ 48 KB：这一行必然跨三个以上的块，累积逻辑错位一格就拿不到标题。
    const text = "深渊之下海雾翻涌潮线把灯影拖长一寸".repeat(1000);
    await writeSession(book, "s-cjk", [JSON.stringify(meta), userLine(text)]);
    const items = await listSessions(book);
    expect(items[0]?.title).toBe(text.slice(0, 60)); // TITLE_MAX 那条截断判据不变
  });

  it("块边界正好切进标题的头几个字中间：解码必须接上流，不许变形", async () => {
    const book = await mkdtemp(path.join(root, "edge-"));
    const text = "深渊之下海雾翻涌潮线把灯影拖长一寸".repeat(20);
    const user = userLine(text);
    const metaLine = JSON.stringify(meta);
    // 填充用 ASCII：每加一个 x 正好挪 1 个字节，块边界与 user 行正文的相对位置才遍历得到每一个余数
    // （用汉字填是 3 字节一跳，只会落在固定的同余类上，上面那道算术就可能永远凑不到 1~2）。
    const fillLine = (n: number): string =>
      JSON.stringify({
        ...turn,
        id: "fill",
        type: "message",
        text: "x".repeat(n),
        interrupted: false
      });
    /** 这条 user 行的 `"text":"` 之前的字节数：块边界要落在它之后 1~2 字节，才正好劈开第一个汉字。 */
    const headBytes = Buffer.byteLength(user.slice(0, user.indexOf('"text":"') + 8), "utf8");
    let placed = -1;
    for (let n = 1; n < 20000; n++) {
      const userStart = Buffer.byteLength(`${metaLine}\n${fillLine(n)}\n`, "utf8");
      const gap = HEAD_CHUNK - (userStart + headBytes);
      if (gap === 1 || gap === 2) {
        placed = n;
        break;
      }
    }
    // 填充行按 6 字节递增，余数总会轮到 1 或 2；找不到就是上面这道算术变了，宁可当场说话也不要空跑。
    expect(placed).toBeGreaterThan(-1);
    await writeSession(book, "s-edge", [metaLine, fillLine(placed), user]);

    const items = await listSessions(book);
    const title = items[0]?.title ?? "";
    // 反向鉴别：解码没接上流时，被劈开的那个汉字变成替换符，标题第一个字就错了。
    expect(title).toBe(text.slice(0, 60));
    expect(title).not.toContain("\uFFFD");
  });

  it("首行比一次读的窗口还长：照旧读到第一个换行为止，不半途而废", async () => {
    const book = await mkdtemp(path.join(root, "fat-"));
    // zod 对未知键是剥离而不是报错，所以能塞一条 200 KB 的合法首行：整篇读能行，只读一块不行 ⇒ 有鉴别力
    const fat = JSON.stringify({ ...meta, junk: "x".repeat(200_000) });
    await writeSession(book, "s-fat", [fat, userLine("首行两百万字节之后的标题")]);
    expect(await findLatestSession(book, meta.docRelPath)).toBe(relOf("s-fat"));
    expect(await findSessionById(book, meta.docRelPath, meta.sessionId)).toBe(relOf("s-fat"));
    expect((await listSessions(book))[0]?.title).toBe("首行两百万字节之后的标题");
  });

  it("没有尾换行的会话文件：首行照样解析，不报错也不跳过", async () => {
    const book = await mkdtemp(path.join(root, "nonl-"));
    const abs = path.join(book, ...relOf("s-nonl").split("/"));
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, `${JSON.stringify(meta)}\n${userLine("就这样")}`, "utf8");
    expect(await findLatestSession(book, meta.docRelPath)).toBe(relOf("s-nonl"));
    expect((await listSessions(book))[0]?.title).toBe("就这样");
  });

  it("空文件与只有首行的文件：跳过/空标题，都不抛（与整篇读同口径）", async () => {
    const book = await mkdtemp(path.join(root, "tiny-"));
    await writeSession(book, "s-empty", []);
    await writeSession(book, "s-meta-only", [
      JSON.stringify({ ...meta, sessionId: "s-meta-only" })
    ]);
    const items = await listSessions(book);
    expect(items.map((item) => item.sessionId)).toEqual(["s-meta-only"]);
    expect(items[0]?.title).toBe("");
    // 只有首行也够定位：这条判据本来就只看首行的 docRelPath。
    expect(await findLatestSession(book, meta.docRelPath)).toBe(relOf("s-meta-only"));
    expect(await findLatestSession(book, "chapters/没有这篇.md")).toBeNull();
  });

  it("坏首行只跳过这一条，别的一条不少", async () => {
    const book = await mkdtemp(path.join(root, "broken-"));
    await writeSession(book, "s-bad", ["{ not json", userLine("读不到")]);
    await writeSession(book, "s-good", [
      JSON.stringify({ ...meta, sessionId: "s-good" }),
      userLine("能用")
    ]);
    const items = await listSessions(book);
    expect(items.map((item) => item.sessionId)).toEqual(["s-good"]);
    expect(await findLatestSession(book, meta.docRelPath)).toBe(relOf("s-good"));
  });

  it("首行是空行、meta 在第二行：两条通路各按**自己原来的口径**办事，谁都不许被顺手统一", async () => {
    const book = await mkdtemp(path.join(root, "blank-first-"));
    await writeSession(book, "s-blank", [
      "",
      JSON.stringify({ ...meta, sessionId: "s-blank" }),
      userLine("这一句只有一条通路取得到")
    ]);
    // findLatestSession 的旧写法是 `readFile().split("\n")[0]`——**不滤空行**，首行就是那个空串，
    // safeParse 失败 ⇒ 这条会话跳过。改读头部后必须照样跳过；谁给 readFirstLine 加上滤空行，
    // 这一句就当场红（它会把第二行的 meta 当首行，于是「最近一条线程」凭空多出一条来）。
    expect(await findLatestSession(book, meta.docRelPath)).toBeNull();
    // listSessions 的旧写法是 `split("\n").filter(非空)`——**滤空行**，所以它认得出第二行的 meta，
    // 标题也照样取到。两处判据不一样是历史事实，不是这次改出来的；改读头部只改了「读多少」，
    // 没动「认哪一行」，所以这里两条断言的方向刻意相反，把这条差异钉在用例里。
    const items = await listSessions(book);
    expect(items.map((item) => item.sessionId)).toEqual(["s-blank"]);
    expect(items[0]?.title).toBe("这一句只有一条通路取得到");
  });
});
