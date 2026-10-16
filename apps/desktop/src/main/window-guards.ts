/// <reference types="node" />
/**
 * 窗口侧的两道闸（2026-10-10 全仓扫描 P1-8；2026-10-16 台账第九十四节从 `ipc-guard.ts` 拆出）。
 *
 * 【为什么搬出来】`ipc-guard.ts` 在 HEAD 是 799 行——距 800 行预算只剩 1 行，下一次小改必先撞红
 * `tools/check-source-line-budget.mjs`。窗口侧这一族（`WindowGuardDeps` + `installWindowGuards`）
 * 与来源闸 / 形状闸 / realpath 闸**不共享状态**：它只调 `isSameRendererOrigin` 与装配好的那枚
 * trust，自己一个模块级变量都不持。拆法照 `channel-trust.ts`、`prompt-assembly.ts` 同一先例。
 *
 * 【判据只有一份——铁律 6】「什么叫我们自己的页面」的真身仍是 `ipc-guard.ts` 的
 * `isSameRendererOrigin`（本文件只 import，不重写第二份）；外链可开性用 `web-source-link.ts`
 * 那一份 http/https 白名单。本文件只负责「把闸装到窗口上」。
 *
 * 【挡得住什么】
 *   - 主窗口被导航走：`will-navigate` 只许继续停在我们那一份页面上（重载、HMR 整页重载、带
 *     query/hash 都放行），其余一律 `preventDefault()`。拦不住的话 preload 会把整套
 *     `window.mochen` 注给外部页面——那是 P1-7 那条链的前半段。
 *   - `window.open` 开新窗口：`setWindowOpenHandler` 一律 `deny`（这产品没有第二扇窗），
 *     要出外部链接就交给系统浏览器，而**只有** http/https 才交（白名单复用上面那一份）。
 *
 * 【挡不住什么】同源页内被注入的脚本：那一帧的 URL 与来源完全合法，本节两道闸认不出来。
 * 真正拦这件事的是 CSP（`renderer-csp.ts`）与 fs-store 的写盘闸，不是这里。
 *
 * 【局限，说清楚】拦下导航时用户看到的是系统通知＋主进程日志，**不是应用内的一条横幅**：
 * 本轮不能动 `renderer/src/**`，而主进程→渲染层现有的推送通道只有 `agentEvent` 与退出握手
 * 两条，往里塞新事件类型要改渲染层。真机上如果这条通知因权限/设置不弹，就只有 console 里那句。
 */

import { installedRendererTrust, isSameRendererOrigin, type RendererTrust } from "./ipc-guard.js";
// 外部链接能不能交给系统浏览器，用的是仓里既有那一份协议白名单（不重写第二份）。
import { isOpenableWebSource } from "./web-source-link.js";

/** 装配点递进来的最小窗口面：真身是 `win.webContents` 与 `shell`，用例里是三张表。 */
export interface WindowGuardDeps {
  onWillNavigate(handler: (details: { url: string; preventDefault(): void }) => void): void;
  setWindowOpenHandler(handler: (details: { url: string }) => { action: "deny" }): void;
  /** 真身是 `shell.openExternal`；只有 http/https 的链接才会被递进来。 */
  openExternal(url: string): void;
  /** 把拦下来的理由递到人面前（真身是系统通知＋主进程日志；见 index.ts 的说明）。 */
  notify(text: string): void;
}

/**
 * 装上窗口侧的两道闸。
 *
 * 【will-navigate】只允许继续停在我们自己的那一份页面上：重载、HMR 整页重载、带 query/hash 都放行；
 * 其它一律 `preventDefault()`。拦不住的话 preload 会把整套 `window.mochen` 注给外部页面——
 * 那是 P1-7 那条链的前半段。
 *
 * 【setWindowOpenHandler】一律 `deny`：这个产品没有第二扇窗口，`window.open` 出来的东西
 * 只会是一张带着全套能力、却不受我们那套 CSP 约束的生面孔。要出外部链接就交给系统浏览器，
 * 而**只有** http/https 才交（白名单复用 `web-source-link` 那一份，不重写第二份）。
 * `mailto:` 没放行：全仓 grep 过，现有代码里没有任何「打开邮件客户端」的需求，凭空加一条 scheme
 * 就是多开一个把参数交给别的应用的口子。
 *
 * 【局限，说清楚】拦下导航时用户看到的是系统通知＋主进程日志，**不是应用内的一条横幅**：
 * 本轮不能动 `renderer/src/**`，而主进程→渲染层现有的推送通道只有 `agentEvent` 与退出握手两条，
 * 往里塞新事件类型要改渲染层。真机上如果这条通知因权限/设置不弹，就只有 crash.log 之外的 console 里那句。
 */
export function installWindowGuards(deps: WindowGuardDeps, trust?: RendererTrust | null): void {
  const policy = trust === undefined ? installedRendererTrust() : trust;

  deps.onWillNavigate((details) => {
    const url = typeof details?.url === "string" ? details.url : "";
    const allowed = policy !== null && policy !== undefined && isSameRendererOrigin(url, policy);
    if (allowed) return;
    try {
      details.preventDefault();
    } catch {
      // 事件对象已经不带 preventDefault 了（导航这一趟早就结束）：拦不动就只留痕。
    }
    const missing = policy === null || policy === undefined ? "来源判定没装上，" : "";
    const text =
      `${missing}已经拦下一次窗口跳转：${url === "" ? "（没给地址）" : url} 不是这个应用自己的页面。` +
      "如果这是你在界面上点出来的正常操作，请把这句原样反馈出来。";
    console.warn(`[导航闸] ${text}`);
    try {
      deps.notify(text);
    } catch {
      // 通知发不出去（没窗口、系统设置不许多通知）不改变「已经拦住了」这件事。
    }
  });

  deps.setWindowOpenHandler((details) => {
    const url = typeof details?.url === "string" ? details.url : "";
    if (url !== "" && isOpenableWebSource(url)) {
      try {
        deps.openExternal(url);
      } catch (error) {
        console.warn(
          `[新窗口闸] 交给系统浏览器失败：${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    return { action: "deny" };
  });
}
