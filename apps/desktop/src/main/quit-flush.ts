/**
 * 退出前的落盘握手（2026-10-09 全仓扫描 P0-6 的最后一环）。
 *
 * 渲染层那侧早就有了 `flushAllForQuit()`：逐篇落盘、一处失败不中断其余。缺的是**主进程没人调它**——
 * 用户点关闭时窗口直接销毁，那份兜底能力一行都没跑过。这个模块补的就是那条回程。
 *
 * 三条规矩，都是「拦一次」这件事最容易做错的地方：
 * ① **只拦一次，并且放行之后不再拦**。真 Electron 里 `app.quit()` 会重发一次 `before-quit`；
 *   如果放行那次还拦，就是 quit 拦 quit＝死循环，用户从此关不掉应用。
 * ② **等话必须有尽头**。渲染层白屏、监听没挂上、IPC 半路丢——任何一种都不能把退出卡死，
 *   所以计时器到点就按原样放行，并留一行痕。
 * ③ **落不下去时由人拍板**。这里不自作主张「保住数据所以不让走」，也不自作主张「算了直接走」：
 *   点名是哪一篇、为什么，然后问。用户选留下就重新武装，下次关闭再救一次。
 */

import type { FlushQuitBlocked, FlushQuitReply } from "@mochen/contracts";

// 类型的唯一真身在契约层（渲染层落盘那侧共用同一份）；这里原样转出去，免得用例另立一份。
export type { FlushQuitBlocked, FlushQuitReply } from "@mochen/contracts";

/** 等渲染层回话的上限：够慢盘写完几篇，又不至于让人以为「点了关闭没反应」。 */
export const QUIT_FLUSH_TIMEOUT_MS = 4000;

export interface QuitFlushDeps {
  /** 真身是窗口的 `close`（用户点关闭）与 `app.on("before-quit")`（程序主动退出）——两个事件交同一个 handler，接线理由见 `index.ts`。 */
  onBeforeQuit(handler: (event: { preventDefault(): void }) => void): void;
  /** 真身是 `ipcMain.handle(IPC_CHANNELS.appFlushDone, …)` 里把 payload 递给本模块那一步。 */
  onFlushReply(handler: (reply: FlushQuitReply) => void): void;
  /** 向渲染进程发一次「先把稿子落盘」。 */
  sendFlushRequest(): void;
  /** 现在有没有可用窗口：没有窗口就没有脏稿可救，也没有回程可等。 */
  hasWindow(): boolean;
  /** 有稿子落不下去时问人：仍退出还是留下。 */
  askUser(blockedSummary: string): "quit" | "stay";
  /** 计时器：装配层给 `setTimeout`，用例给假时钟。返回取消函数。 */
  after(ms: number, onElapsed: () => void): () => void;
  /** 留痕：与崩溃日志同一个落点，由装配层决定写哪儿。 */
  log(line: string): void;
  /** 放行退出：真身是 `app.quit()`。 */
  quit(): void;
}

/** 回程是跨进程来的，字段类型一律当不可信：形状不对就按「没能确认」处理。 */
function replyIsSane(raw: FlushQuitReply): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  if (typeof raw.ok !== "boolean" || !Array.isArray(raw.blocked)) return false;
  return raw.blocked.every(
    (one) =>
      typeof one === "object" &&
      one !== null &&
      typeof one.relPath === "string" &&
      typeof one.message === "string"
  );
}

function blockedSummary(blocked: FlushQuitBlocked[]): string {
  return blocked.map((one) => `「${one.relPath}」：${one.message}`).join("\n");
}

/**
 * 装上握手。`timeoutMs` 留给用例改小；产品侧用默认的 {@link QUIT_FLUSH_TIMEOUT_MS}。
 */
export function installQuitFlush(deps: QuitFlushDeps, timeoutMs: number = QUIT_FLUSH_TIMEOUT_MS) {
  // waiting：已经拦下、正在等渲染层回话。released：这一趟已经放行，之后不再插手。
  let waiting = false;
  let released = false;
  let cancelTimer: (() => void) | null = null;

  const settle = (): void => {
    waiting = false;
    if (cancelTimer !== null) {
      cancelTimer();
      cancelTimer = null;
    }
  };

  deps.onBeforeQuit((event) => {
    if (released || waiting) return;
    if (!deps.hasWindow()) return;
    waiting = true;
    event.preventDefault();
    deps.sendFlushRequest();
    cancelTimer = deps.after(timeoutMs, () => {
      if (!waiting) return;
      settle();
      released = true;
      deps.log("退出握手：没能等到渲染层的落盘回话，按原样放行退出。");
      deps.quit();
    });
  });

  deps.onFlushReply((raw) => {
    // 只认「正拦着」这一趟的回程：超时放行之后的迟到回话（以及任何重复投递）都在这里止步。
    if (!waiting) return;
    settle();
    if (!replyIsSane(raw)) {
      released = true;
      deps.log("退出握手：渲染层的回话形状不对，按「没能确认落盘」放行退出。");
      deps.quit();
      return;
    }
    if (raw.ok) {
      released = true;
      deps.quit();
      return;
    }
    if (deps.askUser(blockedSummary(raw.blocked)) === "quit") {
      released = true;
      deps.quit();
      return;
    }
    // 用户选择留下：不 released，下次点关闭再拦一次、再救一次。
    deps.log("退出握手：有稿子没能落盘，用户选择留下。下次关闭会再救一次。");
  });
}
