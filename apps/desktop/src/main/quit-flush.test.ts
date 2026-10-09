import { describe, expect, it } from "vitest";
import {
  installQuitFlush,
  QUIT_FLUSH_TIMEOUT_MS,
  type FlushQuitReply,
  type QuitFlushDeps
} from "./quit-flush.js";

/**
 * 退出前的落盘握手（2026-10-09 全仓扫描 P0-6 的最后一环）。
 *
 * 渲染层已经有 `flushAllForQuit()`——它能逐篇落盘、一处失败不中断其余——但**主进程从来没人调它**：
 * 用户点关闭时，窗口直接销毁，那份兜底能力一行都没跑过。这里钉的就是那条回程：
 * 主进程拦一次 → 让渲染层把字落盘 → 落成了才走 → 落不下去就先问人 → 全程不许把退出卡死。
 */
function makeDeps(overrides: Partial<QuitFlushDeps> = {}) {
  const log: string[] = [];
  const sent: number[] = [];
  const quits: number[] = [];
  const prevented: number[] = [];
  const timers: { ms: number; onElapsed: () => void; cancelled: boolean }[] = [];
  const replies: ((reply: FlushQuitReply) => void)[] = [];
  let beforeQuit: ((event: { preventDefault(): void }) => void) | null = null;
  const deps: QuitFlushDeps = {
    onBeforeQuit: (handler) => {
      beforeQuit = handler;
    },
    onFlushReply: (handler) => {
      replies.push(handler);
    },
    sendFlushRequest: () => {
      sent.push(Date.now());
    },
    hasWindow: () => true,
    askUser: () => "quit",
    after: (ms, onElapsed) => {
      const timer = { ms, onElapsed, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    log: (line) => {
      log.push(line);
    },
    quit: () => {
      quits.push(1);
    },
    ...overrides
  };
  return {
    deps,
    log,
    sent,
    quits,
    prevented,
    timers,
    /** 用户点关闭：主进程收到 before-quit。 */
    close: () => {
      if (beforeQuit === null) throw new Error("必须挂上 before-quit");
      beforeQuit({
        preventDefault: () => {
          prevented.push(1);
        }
      });
    },
    /** 渲染层把结果递回来（走 app:flush-done）。 */
    reply: (reply: FlushQuitReply) => {
      replies.at(-1)?.(reply);
    },
    /** 假时钟：让挂着的计时器到点。 */
    fireTimer: () => {
      timers.at(-1)?.onElapsed();
    }
  };
}

describe("installQuitFlush", () => {
  it("有窗口时先拦一次：preventDefault 恰好一次、请求发一次，此刻绝不 quit", () => {
    const h = makeDeps();
    installQuitFlush(h.deps);
    h.close();
    expect(h.prevented).toHaveLength(1);
    expect(h.sent).toHaveLength(1);
    expect(h.quits).toHaveLength(0);
  });

  it("渲染层回「全落成了」＝取消计时器并放行退出", () => {
    const h = makeDeps();
    installQuitFlush(h.deps);
    h.close();
    h.reply({ ok: true, blocked: [] });
    expect(h.quits).toHaveLength(1);
    expect(h.timers.at(-1)?.cancelled).toBe(true);
  });

  it("等话期间再来的 before-quit 不许再拦：拦第二次就是 app.quit() 自己把自己卡死", () => {
    const h = makeDeps();
    installQuitFlush(h.deps);
    h.close();
    h.close();
    expect(h.prevented).toHaveLength(1);
    expect(h.sent).toHaveLength(1);
  });

  it("渲染层不回话（白屏、监听没挂上）＝到点放行退出并留痕，绝不能把退出拦死", () => {
    const h = makeDeps();
    installQuitFlush(h.deps);
    h.close();
    expect(h.timers.at(-1)?.ms).toBe(QUIT_FLUSH_TIMEOUT_MS);
    h.fireTimer();
    expect(h.quits).toHaveLength(1);
    expect(h.log.join("\n")).toContain("没能等到");
  });

  it("有篇落不下去且用户选留下＝不 quit、点名是哪一篇，并且下次关闭还能再拦一次", () => {
    const asked: string[] = [];
    const h = makeDeps({
      askUser: (summary) => {
        asked.push(summary);
        return "stay";
      }
    });
    installQuitFlush(h.deps);
    h.close();
    h.reply({ ok: false, blocked: [{ relPath: "chapters/01-开局.md", message: "EPERM" }] });
    expect(h.quits).toHaveLength(0);
    expect(asked[0]).toContain("chapters/01-开局.md");
    expect(asked[0]).toContain("EPERM");
    // 重新武装：用户这一趟选择留下，下次点关闭还得再救一次稿子。
    h.close();
    expect(h.prevented).toHaveLength(2);
  });

  it("落不下去但用户仍要退出＝放行，不再自作主张地拦着", () => {
    const h = makeDeps({ askUser: () => "quit" });
    installQuitFlush(h.deps);
    h.close();
    h.reply({ ok: false, blocked: [{ relPath: "a.md", message: "盘满" }] });
    expect(h.quits).toHaveLength(1);
  });

  it("没有窗口＝根本不拦：那时既没有脏稿可救，也没有回程可等", () => {
    const h = makeDeps({ hasWindow: () => false });
    installQuitFlush(h.deps);
    h.close();
    expect(h.prevented).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
  });

  it("回程形状不对（缺字段、blocked 不是数组）＝按「没能确认」放行并留痕，不许卡在应用里", () => {
    const h = makeDeps();
    installQuitFlush(h.deps, 4000);
    h.close();
    h.reply({ ok: "yes", blocked: "全部" } as unknown as FlushQuitReply);
    expect(h.quits).toHaveLength(1);
    expect(h.log.join("\n")).toContain("形状");
  });

  it("超时放行之后迟到的回程＝忽略，不许二次 quit 也不许二次拦", () => {
    const h = makeDeps();
    installQuitFlush(h.deps);
    h.close();
    h.fireTimer();
    h.reply({ ok: true, blocked: [] });
    expect(h.quits).toHaveLength(1);
  });

  it("放行之后真 Electron 重发的 before-quit＝直接通过：quit 拦自己就是死循环", () => {
    const h = makeDeps();
    installQuitFlush(h.deps);
    h.close();
    h.reply({ ok: true, blocked: [] });
    // app.quit() 在真进程里会再发一次 before-quit，这一趟必须放行到底。
    h.close();
    expect(h.prevented).toHaveLength(1);
    expect(h.quits).toHaveLength(1);
  });
});
