/// <reference types="node" />
/**
 * 窗口自愈（2026-11-20 审计 R-3）。
 *
 * 【为什么需要】这个产品只有一扇窗，也没有托盘/多窗口可退：渲染进程一旦退出，用户面前
 * 只剩一个白框，能做的只有强杀进程。原先主进程对此**没有任何监听**，`loadFile` 的拒绝
 * 也只落进 crash-guard 的通用崩溃弹窗——用户看不出是「界面没加载出来」。
 *
 * 【判据只有这一份】什么时候救、救几次、提示怎么写，全住在这里；`index.ts` 只做接线。
 * 限次是必须的：崩溃 → 重载 → 再崩 的死循环比白屏更糟，会把 CPU 打满。
 */

export interface RenderProcessGoneDetails {
  /** Electron 给的值形如 crashed / oom / killed / launch-failed；缺了就按未知原因处理。 */
  reason?: string;
}

export interface WindowRecoveryDeps {
  /** 装监听。Electron 的 `(event, details)` 由装配层收成一参，这里不认识 Electron。 */
  onRenderProcessGone(handler: (details: RenderProcessGoneDetails) => void): void;
  reload(): void;
  log(line: string): void;
  notify(title: string, detail: string): void;
}

/** 自动重载的最大次数：一次。第二次起只报不救。 */
export const MAX_AUTO_RELOADS = 1;

function reasonText(details: RenderProcessGoneDetails): string {
  const reason = details.reason;
  return typeof reason === "string" && reason.trim() !== "" ? reason : "未知原因";
}

export function installWindowRecovery(
  deps: WindowRecoveryDeps,
  maxReloads = MAX_AUTO_RELOADS
): void {
  let reloads = 0;
  deps.onRenderProcessGone((details) => {
    const reason = reasonText(details);
    deps.log(`[窗口] 渲染进程退出：${reason}`);
    if (reloads >= maxReloads) {
      deps.notify(
        "墨宸 AI · 界面进程反复退出",
        `界面进程已经退出 ${reloads + 1} 次（最近一次：${reason}）。已停止自动重载，请重启应用；没落盘的文字可能丢失。`
      );
      return;
    }
    reloads += 1;
    deps.notify(
      "墨宸 AI · 界面进程退出了",
      `界面进程刚退出了一次（${reason}），正在自动重新载入。没落盘的文字可能丢失。`
    );
    try {
      deps.reload();
    } catch (error) {
      // 窗口可能已经销毁（用户正在退出）：自愈这条路上任何异常都不许再往外抛。
      deps.log(`[窗口] 自动重载失败：${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

/** 加载失败那一句人话。调用方负责落日志与弹窗（主进程里那两件事在同一处装配）。 */
export function loadFailureText(target: string, error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return `界面没有加载出来（${target}）：${reason}。请重试一次；仍然不行就重启应用。`;
}
