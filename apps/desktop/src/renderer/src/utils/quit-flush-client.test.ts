import { describe, expect, it, vi } from "vitest";
import type { FlushQuitReply } from "@mochen/contracts";
import {
  installQuitFlushListener,
  quitReplyOf,
  replyQuitFlush,
  type QuitFlushTarget
} from "./quit-flush-client";
import type { FlushAllResult } from "./draft-flush";

/**
 * 退出握手的渲染层接线（2026-10-09 全仓扫描 P0-6）。
 *
 * 判定与落盘都已经有真身（`draft-flush` 的 `flushAllBeforeQuit`），这里只管三件事：
 * 该不该跑兜底、把结果换算成契约里那两句形状、以及**回程发不出去时不许把异常带出去**——
 * 主进程那时已经在退出路上了，一个未处理的 rejection 换不回任何字，只会污染日志。
 */
function makeTarget(
  rootPath: string | null,
  flush: () => Promise<FlushAllResult> = async (): Promise<FlushAllResult> => ({ ok: true })
): QuitFlushTarget {
  return { rootPath, flushAllForQuit: vi.fn(flush) };
}

function makeApi(opts: { failReply?: boolean } = {}) {
  const sent: FlushQuitReply[] = [];
  const off = vi.fn();
  const listeners: (() => void)[] = [];
  const api = {
    onQuitFlushRequest: vi.fn((listener: () => void) => {
      listeners.push(listener);
      return off;
    }),
    quitFlushDone: vi.fn(async (input: FlushQuitReply) => {
      sent.push(input);
      // 真身里这条通道会在主进程退出时断开并抛错：用例用它验「不许留未处理 rejection」。
      if (opts.failReply === true) throw new Error("IPC 通道已关：主进程已经在退出路上");
    })
  };
  return { api, sent, listeners, off };
}

describe("quitReplyOf", () => {
  it("兜底全写成＝{ ok: true, blocked: [] }：blocked 必须是空数组而不是缺字段", () => {
    expect(quitReplyOf({ ok: true })).toEqual({ ok: true, blocked: [] });
  });

  it("有篇没写成＝逐篇点名，relPath 与 message 原样带过去，主进程据此问人", () => {
    const reply = quitReplyOf({
      ok: false,
      blocked: [{ relPath: "chapters/01-开局.md", message: "EPERM: 磁盘忙" }]
    });
    expect(reply).toEqual({
      ok: false,
      blocked: [{ relPath: "chapters/01-开局.md", message: "EPERM: 磁盘忙" }]
    });
  });
});

describe("replyQuitFlush", () => {
  it("书没打开（一篇可落的都没有）＝不跑兜底，直接回 ok，别让主进程白等超时", async () => {
    const target = makeTarget(null);
    const { api, sent } = makeApi();
    await replyQuitFlush(target, api);
    expect(target.flushAllForQuit).not.toHaveBeenCalled();
    expect(sent).toEqual([{ ok: true, blocked: [] }]);
  });

  it("开着书＝先跑兜底再答话：顺序反了就是「说已保存但其实没写」", async () => {
    const order: string[] = [];
    const target: QuitFlushTarget = {
      rootPath: "/book",
      flushAllForQuit: vi.fn(async (): Promise<FlushAllResult> => {
        order.push("flush");
        return { ok: true };
      })
    };
    const api = {
      onQuitFlushRequest: vi.fn(() => () => {}),
      quitFlushDone: vi.fn(async () => {
        order.push("reply");
      })
    };
    await replyQuitFlush(target, api);
    expect(order).toEqual(["flush", "reply"]);
  });

  it("落不下去的那一篇照样进回程：ok:false + 点名，而不是含糊地报成安全", async () => {
    const target = makeTarget("/book", async () => ({
      ok: false,
      blocked: [{ relPath: "chapters/02-潮信.md", message: "写盘被拦下" }]
    }));
    const { api, sent } = makeApi();
    await replyQuitFlush(target, api);
    expect(sent[0]).toEqual({
      ok: false,
      blocked: [{ relPath: "chapters/02-潮信.md", message: "写盘被拦下" }]
    });
  });

  it("回程本身抛错（主进程已在退出路上）＝收住，不许留一个未处理 rejection", async () => {
    const target = makeTarget("/book");
    const { api, sent } = makeApi({ failReply: true });
    await expect(replyQuitFlush(target, api)).resolves.toBeUndefined();
    // 照样试过一次：不是「发现会抛就干脆不发」。
    expect(sent).toHaveLength(1);
  });
});

describe("installQuitFlushListener", () => {
  it("订阅上的监听器一被点火就跑兜底并答话；返回的取消函数把订阅撤掉", async () => {
    const target = makeTarget("/book");
    const { api, listeners, sent, off } = makeApi();
    const dispose = installQuitFlushListener(target, api);
    expect(listeners).toHaveLength(1);
    listeners[0]?.();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(target.flushAllForQuit).toHaveBeenCalledTimes(1);
    dispose();
    expect(off).toHaveBeenCalledTimes(1);
  });
});
