import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 退出握手的**接线**契约（2026-10-11 真机探针量出来的那条 P0）。
 *
 * 【要钉住的事故】`installQuitFlush` 的状态机（`quit-flush.ts`）一直是对的，红的全在装配那两行：
 * 它只挂在 `app.on("before-quit")` 上，而 Windows 上用户「点关闭」根本不是这么走的。
 * 用 Electron 42.5.0 本机实测（探针 `scratch/quit-order-probe/probe.js`，日志同目录）：
 *   · 现在的接线：`win 'close'` → `'closed'`（窗口已销毁）→ `window-all-closed` →
 *     **没有 before-quit**，进程 3 秒后**还活着**（Electron 文档自己写了「默认会 app.quit()，
 *     但有一个已知 bug 让它不生效」，这里实测到的就是那个 bug）；等探针再补一次 `app.quit()`，
 *     `before-quit` 才来，那时 `hasWindow()` 已是 false ⇒ `quit-flush.ts:79` 直接 return。
 *     **结论：用户点关闭时，落盘握手一步都不会跑，稿子留在内存里跟着窗口一起没了。**
 *   · 改成 `win.on("close", handler)` + 保留 `app.on("before-quit", handler)`：
 *     close 被拦下时 `window alive=true`，request 发得出去、回话等得到，回话后 `deps.quit()`
 *     → `app.quit()` → 窗口销毁 → `will-quit` → 进程干净退出（退出码 0）。
 *
 * 【为什么不补 `window-all-closed` 兜底】拦下 close 之后，每一次关窗都必经握手，
 * 而握手要么放行退出、要么超时放行——不存在「窗口没了而进程还留着」的那条路；
 * 全仓也没有任何 `.destroy()` 绕过 close（`new BrowserWindow` 只有 index.ts 一处）。
 * 给不会发生的场景加通路，就是本仓反复清理的那类假控件。
 *
 * 【为什么读源码而不是运行时】`main/index.ts` 是装配文件、直接 import electron，没有单测入口——
 * 同一处境已有先例 `ipc-guard-coverage.test.ts`。注释一律先剥：注释里写着 needle 不等于真做了。
 */

const here = path.dirname(fileURLToPath(import.meta.url));

function stripComments(body: string): string {
  return body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const indexSource = stripComments(readFileSync(path.join(here, "index.ts"), "utf8"));
const quitFlushSource = stripComments(readFileSync(path.join(here, "quit-flush.ts"), "utf8"));

/** 取 `installQuitFlush({ … })` 里某个属性的源码片段，直到下一个顶层属性名为止。 */
function armProperty(name: "onBeforeQuit" | "hasWindow"): string {
  const start = indexSource.indexOf(`${name}:`);
  if (start < 0) return "";
  const rest = indexSource.slice(start + name.length);
  const next = rest.search(/\n {4}[A-Za-z]+:/);
  return next < 0 ? rest : rest.slice(0, next);
}

describe("退出握手的接线（点关闭 = 唯一真实的退出路径）", () => {
  it("握手必须挂在窗口的 close 上：那一刻窗口还活着，request 才发得出去", () => {
    expect(armProperty("onBeforeQuit")).toMatch(/win\.on\(\s*"close"\s*,/);
  });

  it("`app.quit()` 那条路也还得拦（将来的自动更新重启、崩溃前的主动退出都不经窗口 close）", () => {
    expect(armProperty("onBeforeQuit")).toMatch(/app\.on\(\s*"before-quit"\s*,/);
  });

  it("close 与 before-quit 都交给同一个 handler：状态机只许有一份，两份迟早分叉", () => {
    const arm = armProperty("onBeforeQuit");
    const passed: string[] = [];
    for (const one of arm.matchAll(
      /(?:win\.on\(\s*"close"\s*,|app\.on\(\s*"before-quit"\s*,)\s*([\w$]+)\s*\)/g
    )) {
      const name = one[1];
      if (typeof name === "string") passed.push(name);
    }
    expect(passed).toHaveLength(2);
    expect(new Set(passed).size).toBe(1);
  });

  it("`hasWindow` 不许被改成常量来糊弄上面两条：真身只能是窗口没销毁", () => {
    expect(armProperty("hasWindow")).toMatch(/!\s*win\.isDestroyed\(\)/);
  });

  it("装配处只许调用一次 installQuitFlush：装两次就是两条握手抢同一次关闭", () => {
    const calls = indexSource.match(/installQuitFlush\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it("waiting / released 这套状态机的真身在 quit-flush.ts，不许有人抄进装配文件", () => {
    expect(quitFlushSource).toMatch(/let waiting/);
    expect(indexSource).not.toMatch(/\bwaiting\s*=\s*(true|false)/);
    expect(indexSource).not.toMatch(/\breleased\s*=\s*(true|false)/);
  });

  it("`onBeforeQuit` 的字段注释必须同时点名两个事件：只指 before-quit 就是把半个接线写成全部", () => {
    const raw = readFileSync(path.join(here, "quit-flush.ts"), "utf8");
    const at = raw.indexOf("  onBeforeQuit(");
    expect(at).toBeGreaterThanOrEqual(0);
    const before = raw.slice(0, at);
    const doc = before.slice(before.lastIndexOf("/**"));
    expect(doc).toMatch(/close/);
    expect(doc).toMatch(/before-quit/);
  });
});
