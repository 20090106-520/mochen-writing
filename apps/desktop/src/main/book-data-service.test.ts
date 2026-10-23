import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_PERMISSION_MODE,
  IPC_CHANNELS,
  type BookDataReadResult,
  type BookDataWriteResult
} from "@mochen/contracts";
import { defaultAtomicFs, type AtomicWriteFs } from "@mochen/fs-store";

import { createBookService, registerBookIpc, type BookService } from "./book-service.js";
// 来源闸（P1-7）：夹具只造事件形状，判据仍只在 ipc-guard 一份。
import { trustedRendererEvent } from "./ipc-trust-fixture.js";

/**
 * 设定数据走主进程落盘（2026-10-09 扫描总单 P0-7·主进程这一层）。
 *
 * 这一层要钉的三件事，全都关于「不许把话说圆」：
 * ① 没开书时读数回 `no-book` 而不是 `json:null`——后者会被渲染层当成「这本书是空的」，
 *    于是把上一本书的 localStorage 内容迁进当前书；
 * ② 键白名单在主进程判，不在渲染层判：递 `"../book.json"` 这种形状必须当场挡下，
 *    而且挡下之后 book.json 在盘上一字未变；
 * ③ 换一本书就读不到上一本的设定（串台是这一波的病名，也是这一条用例的验收标准）。
 */

async function makeBookRoot(tag: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), `mochen-bookdata-${tag}-`));
  await mkdir(path.join(root, "chapters"), { recursive: true });
  await writeFile(path.join(root, "chapters", "01-a.md"), "正文\n");
  await writeFile(
    path.join(root, "book.json"),
    JSON.stringify(
      {
        id: `b-${tag}`,
        title: `测试书${tag}`,
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
  return root;
}

/** 从联合类型里取 `ok:false` 那一支的 reason；形状不对时当场失败，而不是 `!` 蒙过去。 */
function readReason(got: BookDataReadResult): string {
  expect(got.ok).toBe(false);
  if (got.ok) return "ok";
  return got.reason;
}
function writeReason(got: BookDataWriteResult): string {
  expect(got.ok).toBe(false);
  if (got.ok) return "ok";
  return got.reason;
}

let rootA = "";
let rootB = "";

beforeAll(async () => {
  rootA = await makeBookRoot("a");
  rootB = await makeBookRoot("b");
});

afterAll(async () => {
  await rm(rootA, { recursive: true, force: true });
  await rm(rootB, { recursive: true, force: true });
});

function serviceWith(fs?: AtomicWriteFs): BookService {
  return createBookService({
    retention: () => ({ maxCount: 50, maxBytes: 32 * 1024 * 1024 }),
    ...(fs === undefined ? {} : { fs })
  });
}

describe("book-data：没开书与非法键", () => {
  it("没打开作品目录：读回 no-book，绝不是 json:null", async () => {
    const service = serviceWith();
    const got = await service.readData("notes");
    expect(readReason(got)).toBe("no-book");
    expect(writeReason(await service.writeData("notes", "[]"))).toBe("no-book");
  });

  it("白名单外的键一律 invalid-key，连 book.json 都不许被当成数据键写掉", async () => {
    const service = serviceWith();
    await service.open(rootA);
    const before = await readFile(path.join(rootA, "book.json"), "utf8");
    for (const bad of ["../book.json", "book.json", "notes.json", "", "../../outside"]) {
      expect(readReason(await service.readData(bad)), `读 ${bad} 竟然放行了`).toBe("invalid-key");
      expect(writeReason(await service.writeData(bad, "{}")), `写 ${bad} 竟然放行了`).toBe(
        "invalid-key"
      );
    }
    // 挡下之后盘上那份 book.json 一个字都没动——「拒绝了」与「拒绝了但顺手写了」的差别就在这行。
    expect(await readFile(path.join(rootA, "book.json"), "utf8")).toBe(before);
  });

  it("非字符串的 json 同样拒收（结构化克隆挡不住 undefined 与对象）", async () => {
    const service = serviceWith();
    await service.open(rootA);
    expect(writeReason(await service.writeData("notes", undefined))).toBe("not-json");
    expect(writeReason(await service.writeData("notes", { a: 1 }))).toBe("not-json");
  });
});

describe("book-data：读写落在当前这本书里", () => {
  it("写进去再读回来是同一份，且文件真在 .mochen/data/notes.json", async () => {
    const service = serviceWith();
    await service.open(rootA);
    const json = JSON.stringify([{ id: "n1", content: "海雾" }]);
    expect(await service.writeData("notes", json)).toEqual({ ok: true });
    expect(await service.readData("notes")).toEqual({ ok: true, json });
    const onDisk = await readFile(path.join(rootA, ".mochen", "data", "notes.json"), "utf8");
    expect(onDisk).toBe(json);
  });

  it("换一本书就读不到上一本的设定（串台是这一波的病名）", async () => {
    const service = serviceWith();
    await service.open(rootA);
    await service.writeData("story-bible", JSON.stringify([{ id: "c1", title: "林夜" }]));
    await service.close();
    await service.open(rootB);
    expect(await service.readData("story-bible")).toEqual({ ok: true, json: null });
  });

  it("产品装配把 deps.fs 传到了设定写盘那一步：坏 rename ⇒ write-failed 且旧内容完好", async () => {
    const brokenRename: AtomicWriteFs = {
      ...defaultAtomicFs,
      rename: async () => {
        throw Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM" });
      }
    };
    const good = JSON.stringify([{ id: "n1" }]);
    const opener = serviceWith();
    await opener.open(rootA);
    await opener.writeData("notes", good);
    // 同一个 root、同一个键，换一份「只坏 rename」的 fs 再开一次：注入点没接线的服务会照样写成功。
    const service = serviceWith(brokenRename);
    await service.open(rootA);
    expect(
      writeReason(await service.writeData("notes", JSON.stringify([{ id: "n1" }, { id: "n2" }])))
    ).toBe("write-failed");
    expect(await service.readData("notes")).toEqual({ ok: true, json: good });
  });
});

describe("book-data：IPC 注册", () => {
  it("两条频道都注册了，且 handler 原样转给 service（不在 ipc 层另写一套判定）", async () => {
    const service = serviceWith();
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    registerBookIpc({ handle: (c, fn) => handlers.set(c, fn) }, service);
    const read = handlers.get(IPC_CHANNELS.bookDataRead);
    const write = handlers.get(IPC_CHANNELS.bookDataWrite);
    expect(read, "book-data:read 没注册").toBeTypeOf("function");
    expect(write, "book-data:write 没注册").toBeTypeOf("function");
    if (typeof read !== "function" || typeof write !== "function") return;

    await service.open(rootA);
    // handler 的第一枚实参是 Electron 的 event，渲染层递来的参数从第二枚起——
    // 这里若少递一位，键就会落到 event 位上，下面的断言当场红。
    expect(
      await write(trustedRendererEvent(), "writing-goal", JSON.stringify({ goal: 1 }))
    ).toEqual({
      ok: true
    });
    expect(await read(trustedRendererEvent(), "writing-goal")).toEqual({
      ok: true,
      json: JSON.stringify({ goal: 1 })
    });
    // 跨进程来的东西一律当不可信：频道这层也要挡住非法键。
    expect(
      readReason((await read(trustedRendererEvent(), "../book.json")) as BookDataReadResult)
    ).toBe("invalid-key");
  });

  it("book:open 的回执等记账回调落地（作品库镜像不会读到旧清单）", async () => {
    // 2026-10-22 窄窗走查撞出：此前 onOpened 是同步 void、由装配处 fire-and-forget，
    // 渲染层拿到回执后立刻读 book:recent，可能读到记账写完之前的旧文件
    // ⇒ 刚打开的这一本不进作品库，要等重启才补上。判据：记账没落地，回执不许先发。
    const service = serviceWith();
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    registerBookIpc({ handle: (c, fn) => handlers.set(c, fn) }, service, {
      onOpened: async () => {
        await gate;
      }
    });
    const open = handlers.get(IPC_CHANNELS.bookOpen);
    expect(open, "book:open 没注册").toBeTypeOf("function");
    if (typeof open !== "function") return;

    let replied = false;
    const opening = Promise.resolve(open(trustedRendererEvent(), rootA)).then(() => {
      replied = true;
    });
    // 留一拍给 service.open 自己跑完：它跑完之后回调还在 gate 上等着。
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(replied, "记账还没落地，回执就已经发出去了").toBe(false);
    release();
    await opening;
  });
});
