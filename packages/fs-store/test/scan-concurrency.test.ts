// P1-4（2026-10-09 全仓扫描）：`scan.ts` 的 walk 把 `await` 放在 for 循环里——1000 篇就是 1000 次
// 排队的全量读，一篇读完才轮到下一篇。2026-10-10 实测 1000 章 × 3000 字 ⇒ 盘上 8.66 MB / 133–157 ms
// （0.13–0.16 ms/篇，空负载连跑两遍各 3 次的区间），开书与「新建一章」都付这笔钱。本文件两条守卫：
// ① 读盘不再串行（同时在途的读 > 1），且**篇数不变**——并发不是多读，是一起读；
// ② 单篇的 DocRef 与整本扫描走同一份判据（docRefFor 与 scanBook 对同一篇必须逐字相同），
//    否则「建章只补一篇」和「开书扫整本」会给出两种侧栏；
// ③ 单篇问「这一篇在不在」只发一次 stat——不 readdir 父目录（2026-10-10 用户点名：建一章不该
//    顺带把整章目录列一遍），readFile 也只发一次。
// IO 计量沿用仓里既有先例（test/scan-excerpt.test.ts）：vi.mock 转发真实实现，仍然真读盘。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { docRefFor, scanBook } from "../src/scan.js";

const io = vi.hoisted(() => ({
  inFlight: 0,
  maxInFlight: 0,
  calls: 0,
  stats: 0,
  readdir: 0
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: vi.fn(async (...args: Parameters<typeof actual.readFile>) => {
      io.calls += 1;
      io.inFlight += 1;
      io.maxInFlight = Math.max(io.maxInFlight, io.inFlight);
      try {
        return await (actual.readFile as (...rest: unknown[]) => Promise<unknown>)(...args);
      } finally {
        io.inFlight -= 1;
      }
    }),
    stat: vi.fn((...args: Parameters<typeof actual.stat>) => {
      io.stats += 1;
      return (actual.stat as (...rest: unknown[]) => Promise<unknown>)(...args);
    }),
    readdir: vi.fn((...args: Parameters<typeof actual.readdir>) => {
      io.readdir += 1;
      return (actual.readdir as (...rest: unknown[]) => Promise<unknown>)(...args);
    })
  };
});

let root = "";
const DOCS = 6;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mochen-concurrent-"));
  await mkdir(path.join(root, "chapters"), { recursive: true });
  await mkdir(path.join(root, "characters"), { recursive: true });
  for (let i = 1; i <= DOCS; i++) {
    await writeFile(
      path.join(root, "chapters", `0${i}-潮线.md`),
      `---\ntitle: 第${i}章\n---\n\n这一章的正文第${i}段。\n`,
      "utf8"
    );
  }
  // 不是文稿目录的一篇：scanBook 不收，docRefFor 也必须不收（同一份判据的另一个方向）。
  await mkdir(path.join(root, "notes"), { recursive: true });
  await writeFile(path.join(root, "notes", "备忘.md"), "不是文稿\n", "utf8");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("scanBook 的读盘不再一篇排一篇（P1-4）", () => {
  it("同时在途的读 > 1：串行时这个数恒为 1", async () => {
    io.maxInFlight = 0;
    io.calls = 0;
    io.inFlight = 0;
    const docs = await scanBook(root);
    expect(docs).toHaveLength(DOCS);
    // 反向鉴别：walk 里那句 await 放回 for 循环内 ⇒ maxInFlight 变回 1 ⇒ 红。
    expect(io.maxInFlight).toBeGreaterThan(1);
  });

  it("并发不是多读：readFile 次数恰等于文稿数，notes 那篇一次都不读", async () => {
    io.calls = 0;
    const docs = await scanBook(root);
    expect(io.calls).toBe(docs.length);
    expect(docs.map((doc) => doc.relPath)).toEqual([
      "chapters/01-潮线.md",
      "chapters/02-潮线.md",
      "chapters/03-潮线.md",
      "chapters/04-潮线.md",
      "chapters/05-潮线.md",
      "chapters/06-潮线.md"
    ]);
  });
});

describe("docRefFor：单篇与整本同一份判据", () => {
  it("同一篇文稿，单独算出来的 DocRef 与整本扫出来的逐字相同", async () => {
    const docs = await scanBook(root);
    const single = await docRefFor(root, "chapters/03-潮线.md");
    expect(single).toEqual(docs.find((doc) => doc.relPath === "chapters/03-潮线.md"));
    expect(single?.title).toBe("第3章");
    expect(single?.excerpt).toBe("这一章的正文第3段。");
    expect(single?.chars).toBe(10);
  });

  it("扫描器不认的目录回 null（建章那侧据此决定要不要往树上挂）", async () => {
    expect(await docRefFor(root, "notes/备忘.md")).toBeNull();
  });

  it("盘上没有这一篇时不抛错，回 null", async () => {
    expect(await docRefFor(root, "chapters/从没写过.md")).toBeNull();
  });

  it("问「这一篇在不在」只发一次 stat、一次 readdir 都不发，正文只读那一篇", async () => {
    io.stats = 0;
    io.readdir = 0;
    io.calls = 0;
    expect(await docRefFor(root, "chapters/04-潮线.md")).not.toBeNull();
    // 反向鉴别：存在性那道闸若写回「readdir 父目录再 includes」，这里 readdir 变 1 ⇒ 红
    // （建一章不该顺带把整章目录列一遍，2026-10-10 用户点名）。
    expect(io.readdir).toBe(0);
    expect(io.stats).toBe(1);
    expect(io.calls).toBe(1);
  });

  it("传进来的是目录而不是文稿：同样回 null，不把目录当一篇读", async () => {
    expect(await docRefFor(root, "chapters")).toBeNull();
  });
});
