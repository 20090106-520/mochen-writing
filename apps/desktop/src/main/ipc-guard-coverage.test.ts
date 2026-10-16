import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { IPC_CHANNELS } from "@mochen/contracts";
// CSP 的那一份判据（打包态 / 开发态两档）——下面钉的就是它，不是 html 里的字面量。
import { buildRendererCsp } from "./renderer-csp.js";

/**
 * 加固接线的源码契约普查（2026-10-10 全仓扫描 P1-7 / P1-8）。
 *
 * 【为什么用读源码而不是运行时】`main/index.ts` 是装配文件、直接 import electron，没有单测入口
 * ——仓里同一处境已有先例：`frameless-titlebar-wiring.test.ts` 与 `unbound-single-source.test.ts`
 * 都是按源码字面量钉「这条接线还在不在」。这里要回答的四个问题：
 *   ① 有没有哪条通道**绕过**了来源闸（漏一条＝这次没修）；
 *   ② 判据有没有长出第二份（两份迟早不一样，那是比没闸更坏的状态）；
 *   ③ 打包版的渲染层加载有没有重新直接读 env；
 *   ④ CSP meta 有没有被人当「碍事」删掉。
 * 注释一律先剥掉再断言：理由与 `vue-source-reader.ts` 一样——注释里写着 needle 不等于真做了这件事。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");

function stripComments(body: string): string {
  return body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** main 目录下的生产代码（`.test.ts` 之外全部纳入：新增文件自动被普查到）。 */
function mainSources(): { file: string; code: string }[] {
  return readdirSync(here)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => ({
      file: name,
      code: stripComments(readFileSync(path.join(here, name), "utf8"))
    }));
}

const sources = mainSources();
const indexSource = sources.find((one) => one.file === "index.ts");
if (indexSource === undefined) throw new Error("普查没读到 main/index.ts，路径漂了");

/** 主进程**收**的通道（invoke 方向）的**键名**；`agentEvent` 与 `appFlushQuitRequest` 是主进程推给渲染层的，不在内。 */
const RECEIVE_ONLY_EXCLUDED = new Set(["agentEvent", "appFlushQuitRequest"]);
// 注意比的是键名：注册点写的是 `IPC_CHANNELS.bookOpen`，而 `IPC_CHANNELS` 的**值**是 "book:open"。
// 原来这里拿值去比键名集合，47 条全判成「没注册」——红得毫无道理，也把这次真正要防的漏注册淹没了。
const expectedKeys = Object.keys(IPC_CHANNELS).filter((key) => !RECEIVE_ONLY_EXCLUDED.has(key));

describe("每条 IPC 通道都真的走来源闸", () => {
  it("契约里每一条要收的通道都在主进程被注册过（漏注册＝渲染层那条永远超时）", () => {
    expect(expectedKeys.length).toBeGreaterThan(40);
    const mentioned = new Set<string>();
    for (const one of sources) {
      for (const match of one.code.matchAll(/IPC_CHANNELS\.(\w+)/g)) mentioned.add(match[1]!);
    }
    const missing = expectedKeys.filter((key) => !mentioned.has(key));
    expect(missing).toEqual([]);
  });

  it("没有一处把 `handle(IPC_CHANNELS.x …)` 裸注册（必须写成 handleTrusted(handle, …)）", () => {
    const offenders: string[] = [];
    for (const one of sources) {
      if (one.file === "ipc-guard.ts") continue;
      for (const match of one.code.matchAll(/(?<![\w.])handle\(\s*IPC_CHANNELS\.(\w+)/g)) {
        offenders.push(`${one.file}: ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("直接写 `ipcMain.handle(IPC_CHANNELS.x …)` 的地方必须把 handler 交给 trustedHandler", () => {
    const offenders: string[] = [];
    for (const one of sources) {
      for (const match of one.code.matchAll(
        /ipcMain\.handle\(\s*IPC_CHANNELS\.(\w+)([\s\S]{0,400}?)=>/g
      )) {
        const between = match[2] ?? "";
        if (between.includes("trustedHandler(")) continue;
        offenders.push(`${one.file}: ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("事故点那两份文件确实从 ipc-guard 引了闸（原文里它们把整条来源丢掉）", () => {
    for (const name of ["book-service.ts", "agent-ipc.ts"]) {
      const one = sources.find((item) => item.file === name);
      expect(one, `${name} 必须存在`).toBeDefined();
      expect(one!.code).toMatch(/from "\.\/ipc-guard\.js"/);
      expect(one!.code).toContain("handleTrusted(");
    }
  });
});

describe("判据只许一份", () => {
  /**
   * `ipc-trust-fixture.ts` 是**测试夹具**（同 `atomic-write-fs-fixture.ts` 的先例）：它造事件形状，
   * 不做任何比较。豁免只给到「可以出现 senderFrame 这个词」这一条，下面那条断言钉住它没长出判据。
   */
  const SHAPE_ONLY = "ipc-trust-fixture.ts";

  it("`senderFrame` 只出现在 ipc-guard.ts（别处再比一次 URL 就是第二份判据）", () => {
    const hits = sources
      .filter((one) => one.file !== "ipc-guard.ts" && one.file !== SHAPE_ONLY)
      .filter((one) => one.code.includes("senderFrame"))
      .map((one) => one.file);
    expect(hits).toEqual([]);
  });

  it("夹具里不许长出第二份来源判定：它只准造形状，不准解析、不准比较", () => {
    const fixture = sources.find((one) => one.file === SHAPE_ONLY);
    expect(fixture, `${SHAPE_ONLY} 必须存在`).toBeDefined();
    const code = fixture!.code;
    expect(code).not.toMatch(/new URL\(/);
    expect(code).not.toMatch(/\.origin\b/);
    expect(code).not.toMatch(/startsWith\(|localeCompare|toLowerCase\(\)/);
    // 它可以读 `allowedUrl` 这个字段名（装配信任要用），但不许拿它做比较。
    expect(code).not.toMatch(/allowedUrl\s*(===|!==|==|!==)/);
  });

  it("来源判定、形状闸（ipc-guard.ts）与窗口闸（window-guards.ts）各自只有一处定义点", () => {
    // 窗口闸第九十四节从 ipc-guard.ts 拆到了 window-guards.ts——两份都是真身，多一处就是第二份判据。
    const definers = sources
      .filter((one) =>
        /export function (isTrustedSender|handleTrusted|trustedHandler|installWindowGuards)\s*\(/.test(
          one.code
        )
      )
      .map((one) => one.file)
      .sort();
    expect(definers).toEqual(["ipc-guard.ts", "window-guards.ts"]);
  });

  it("导航闸只有 window-guards.ts 一处（preventDefault 与 will-navigate 同框才算）", () => {
    const hits = sources
      .filter((one) => one.file !== "ipc-guard.ts" && one.file !== "window-guards.ts")
      .filter(
        (one) =>
          one.code.includes("preventDefault") && /will-navigate|setWindowOpenHandler/.test(one.code)
      )
      .map((one) => one.file);
    expect(hits).toEqual([]);
    // `quit-flush.ts` 里也有 preventDefault，挡的是「关窗要先落盘」（P0-2 那条握手），不是导航。
    // 原来这条断言只看词，把它也算成第二份导航闸——判据写得太宽，红的是测试而不是代码。
    // 反过来，装配层 `index.ts` 必须**只**调 installWindowGuards，不许自己拦导航：
    const assembly = sources.find((one) => one.file === "index.ts");
    expect(assembly!.code).not.toContain("preventDefault");
    expect(assembly!.code).toContain("installWindowGuards(");
  });
});

describe("装配接线：打包版不许再直接读 env", () => {
  it("加载哪一份页面由 resolveRendererLoad 决定，env 只作为它的入参", () => {
    expect(indexSource.code).toContain("resolveRendererLoad(");
    expect(indexSource.code).toContain("isPackaged: app.isPackaged");
    expect(indexSource.code).toMatch(
      /resolveRendererLoad\(\{[\s\S]{0,320}envRendererUrl: process\.env\.ELECTRON_RENDERER_URL/
    );
    // 旧写法（P1-8 的原文）：打包版也会照着 env 去 loadURL 远程地址
    expect(indexSource.code).not.toMatch(/const rendererUrl = process\.env\.ELECTRON_RENDERER_URL/);
    expect(indexSource.code).not.toMatch(/loadURL\(\s*process\.env\.ELECTRON_RENDERER_URL\s*\)/);
  });

  it("trust 与窗口闸都装上，且窗口闸装在任何加载动作之前（晚装＝这一趟导航没人管）", () => {
    expect(indexSource.code).toContain("installRendererTrust(");
    expect(indexSource.code).toContain("installWindowGuards(");
    expect(indexSource.code.indexOf("installWindowGuards(")).toBeLessThan(
      indexSource.code.indexOf("win.loadURL(")
    );
    expect(indexSource.code.indexOf("installWindowGuards(")).toBeLessThan(
      indexSource.code.indexOf("win.loadFile(")
    );
  });

  it("页面加载走 resolveRendererLoad 的返回值，不再自己拼", () => {
    expect(indexSource.code).toMatch(/win\.loadURL\(\s*\w+\.target\s*\)/);
    expect(indexSource.code).toMatch(/win\.loadFile\(\s*\w+\.target\s*\)/);
  });
});

describe("CSP 只有一份策略，住在 renderer-csp.ts（P1-8）", () => {
  /**
   * 原来这几条是从 `renderer/index.html` 里读那枚 meta 来断言的——那种写法有两个毛病：
   * ① 开发态与打包态必须不同（vite 的 HMR 要 eval 与 ws，打包态两样都不许），写死在 html 里只能二选一；
   * ② 两条 CSP meta 同时存在时浏览器取**交集**，所以「宽松那条也写在 html 里」等于开发态白屏、
   *    「严格那条也写在 html 里」等于打包态白装。
   * 于是策略搬进 `renderer-csp.ts`，由 vite 插件按当次 command 插进产物；这里改钉**那一份**判据。
   */
  const packaged = buildRendererCsp({ mode: "packaged" });
  const dev = buildRendererCsp({ mode: "dev", devServer: { host: "localhost", port: 5173 } });

  function directiveOf(policy: string, name: string): string {
    const hit = new RegExp(`(^|; )${name} ([^;]*)`).exec(policy);
    return hit === null ? "" : hit[2]!;
  }

  it("打包态 script-src 收紧到 'self'：不许 unsafe-inline / unsafe-eval（渲染层能执行脚本＝主进程任意代码执行的前半段）", () => {
    const scriptSrc = directiveOf(packaged, "script-src");
    expect(scriptSrc).toBe("'self'");
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).not.toContain("unsafe-eval");
  });

  it("打包态策略里没有任何远程主机：要出网的事一律不在渲染层做", () => {
    // 已知的一处诱惑：粒子挂件把 draco 解码器默认指向 https://www.gstatic.com/...
    // 给 CSP 开域名＝「白名单」变成「谁都能挂一个」，所以这里宁可判红也不放行。
    expect(packaged).not.toMatch(/https?:\/\//);
    expect(packaged).not.toContain("gstatic");
  });

  it("img-src 带 data: 与 blob:（皮肤是矢量与内联图，导出预览靠 blob）", () => {
    const imgSrc = directiveOf(packaged, "img-src");
    expect(imgSrc).toContain("data:");
    expect(imgSrc).toContain("blob:");
    // 刻意**不**开 file:：皮肤层本来就把「路径长进 CSS」判成非法（appearanceSkinVisual.ts），
    // CSP 再开一扇 file: 等于把那道拒绝作废。真机若量到某个图取不到，解法是素材落进产物，不是开 CSP。
    expect(imgSrc).not.toContain("file:");
  });

  it("开发态放行本机 vite 的 HMR；打包态同一枚指令里不许有 ws 与 eval", () => {
    expect(directiveOf(dev, "connect-src")).toMatch(/ws:\/\/localhost/);
    expect(dev).toContain("'unsafe-eval'");
    expect(directiveOf(packaged, "connect-src")).not.toMatch(/ws:/);
    expect(packaged).not.toContain("'unsafe-eval'");
  });

  it("object-src 'none' 与 base-uri / frame-ancestors 收口", () => {
    expect(packaged).toContain("object-src 'none'");
    // base-uri 取 'none' 而不是 'self'：这个 app 没有 <base>，允许同源也不带来任何功能。
    expect(packaged).toMatch(/base-uri\s+'none'/);
    expect(packaged).toMatch(/frame-ancestors\s+'none'/);
  });

  it("入口 html 里没有写死的策略，除 renderer-csp 之外也没有第二处拼 CSP", () => {
    const html = readFileSync(
      path.join(repoRoot, "apps", "desktop", "src", "renderer", "index.html"),
      "utf8"
    );
    expect(html).not.toContain("Content-Security-Policy");
    const writers = sources
      .filter((one) => one.file !== "renderer-csp.ts")
      .filter((one) => one.code.includes("Content-Security-Policy"))
      .map((one) => one.file);
    expect(writers).toEqual([]);
  });
});
