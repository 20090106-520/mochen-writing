import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CSP_META_HTTP_EQUIV,
  buildRendererCsp,
  cspMetaTag,
  rendererCspPlugin,
  serializeCsp
} from "./renderer-csp.js";

/**
 * 扫描总单 P1-8 里剩下那一条：CSP。
 *
 * 修之前的样子是「三件叠成一条链」——IPC 裸信渲染层（P1-7，已由 `ipc-guard.ts` 装上）、
 * 窗口没有导航闸（同已由 `installWindowGuards` 装上）、**页面本身没有 CSP**。
 * 前两条挡的是「别人家的帧发指令」与「页面被导航走」，第三条挡的是「我们自己的页面里
 * 被注入了一段脚本」：那一帧的 URL 合法、来源合法，`isTrustedSender` 认它，
 * 于是能不能执行外部脚本、能不能把话发到远端，只剩 CSP 这一道。
 *
 * 这一层的判据只许有一份，住在 `renderer-csp.ts`；`index.html` 里**不写死**策略，
 * 因为开发态（vite 的 ws 与 eval）与打包态（一律不许）必须不同，写死在 html 里就只能二选一——
 * 而两条 CSP meta 同时存在时浏览器取交集，开发态会直接白屏。
 */

const here = path.dirname(fileURLToPath(import.meta.url));

const PACKAGED = buildRendererCsp({ mode: "packaged" });
const DEV = buildRendererCsp({ mode: "dev", devServer: { host: "127.0.0.1", port: 5173 } });

/** 把一条策略按指令名拆开，便于逐条断言（而不是整串 grep 到一个词就算过）。 */
function directives(policy: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of policy.split(";")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const space = trimmed.indexOf(" ");
    const name = space === -1 ? trimmed : trimmed.slice(0, space);
    map.set(name, trimmed);
  }
  return map;
}

describe("渲染层 CSP 策略（P1-8）", () => {
  it("打包态：脚本只认自己，且禁 eval / 禁行内 script——注入进来的远端脚本一律不许跑", () => {
    const d = directives(PACKAGED);
    expect(d.get("script-src")).toBe("script-src 'self'");
    expect(PACKAGED).not.toContain("'unsafe-eval'");
    // 行内脚本与行内样式是两回事：皮肤靠 style 属性写 CSS 变量，禁掉行内样式＝界面当场散架。
    // 这里钉的是「script-src 里不许出现 unsafe-inline」，而不是整条策略里没这个词。
    expect(d.get("script-src")).not.toContain("'unsafe-inline'");
    expect(d.get("style-src")).toBe("style-src 'self' 'unsafe-inline'");
  });

  it("打包态：策略里不出现任何具体远程主机——要连外网的事都不在渲染层做", () => {
    // 已知反例：粒子挂件把 draco 解码器默认指向 gstatic。那枚远程口子不许写进 CSP，
    // 否则「脚本白名单」就变成「谁都能挂一个域名」。
    expect(PACKAGED).not.toMatch(/https?:\/\//);
    expect(PACKAGED).not.toContain("gstatic");
  });

  it("加固指令一条都不许漏：嵌套帧、插件对象、基址、表单各有其主", () => {
    const d = directives(PACKAGED);
    expect(d.get("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(d.get("object-src")).toBe("object-src 'none'");
    expect(d.get("base-uri")).toBe("base-uri 'none'");
    expect(d.get("form-action")).toBe("form-action 'none'");
    expect(d.get("default-src")).toBe("default-src 'self'");
  });

  it("开发态：vite HMR 要的 eval 与 ws 只在这里出现，且 ws 锁到那台 dev server", () => {
    expect(DEV).toContain("'unsafe-eval'");
    expect(DEV).toContain("ws://127.0.0.1:5173");
    expect(DEV).toContain("http://127.0.0.1:5173");
    // 开发态放宽的只有这两项，加固指令照旧在位——不许写成「开发态整条不设防」。
    expect(directives(DEV).get("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directives(DEV).get("object-src")).toBe("object-src 'none'");
  });

  it("开发态缺 dev server 信息时退回本机 localhost 与常见端口区间，而不是拼出一条坏策略", () => {
    const fallback = buildRendererCsp({ mode: "dev" });
    const d = directives(fallback);
    expect(d.get("connect-src")).toBeDefined();
    expect(fallback).toContain("ws://localhost");
    expect(fallback.match(/connect-src/g)?.length).toBe(1);
  });

  it("每条指令只出现一次：出现两次时浏览器只认前一份，重复＝静默改判据", () => {
    expect(() =>
      serializeCsp([
        { directive: "script-src", sources: "'self'" },
        { directive: "script-src", sources: "'unsafe-eval'" }
      ])
    ).toThrow(/重复/);
  });

  it("拼错的指令名当场报错：CSP 对不认识的指令是**静默忽略**，安全闸会整条失效", () => {
    expect(() => serializeCsp([{ directive: "connec-src", sources: "'self'" }])).toThrow(
      /不认识.*指令/
    );
    // 大小写也一样：`Script-src` 在 CSP 里不生效，写成这样等于没写。
    expect(() => serializeCsp([{ directive: "Script-src", sources: "'self'" }])).toThrow(
      /不认识.*指令/
    );
  });

  it("来源为空串时不许拼出「指令名后光秃秃」的坏策略——那在 CSP 里等于禁掉该指令", () => {
    expect(() => serializeCsp([{ directive: "img-src", sources: "  " }])).toThrow(/空/);
  });

  it("meta 标签形状：http-equiv 与 content 都在，且策略里出现双引号直接拒（属性会被截断）", () => {
    const tag = cspMetaTag(PACKAGED);
    expect(tag).toContain(`http-equiv="${CSP_META_HTTP_EQUIV}"`);
    expect(tag).toContain(`content="${PACKAGED}"`);
    expect(() => cspMetaTag(`script-src "self"`)).toThrow(/双引号/);
  });
});

describe("渲染层 CSP 的 vite 接线", () => {
  it("html 里只插一枚 CSP meta，插完仍是完整文档（不是把 head 拼坏）", () => {
    const plugin = rendererCspPlugin();
    const transform = plugin.transformIndexHtml;
    expect(typeof transform).toBe("function");
    if (typeof transform !== "function") return;
    const html = "<!doctype html>\n<html><head><title>t</title></head><body></body></html>";
    const out = transform(html, { filename: "/index.html", server: undefined });
    const metaCount = (String(out).match(/Content-Security-Policy/g) ?? []).length;
    expect(metaCount).toBe(1);
    expect(String(out)).toContain("<title>t</title>");
    // 插的位置要在 charset 之后：CSP 那条 meta 排在前面会把编码声明挤到 1024 字节以外。
    const withCharset =
      '<!doctype html>\n<html><head><meta charset="UTF-8"><title>t</title></head><body></body></html>';
    const placed = String(transform(withCharset, { filename: "/index.html", server: undefined }));
    expect(placed.indexOf("Content-Security-Policy")).toBeGreaterThan(
      placed.indexOf('charset="UTF-8"')
    );
    // 没有 head 可插＝这份 html 不是我们的页面，宁可当场炸，也不发一份「以为有 CSP 其实没有」的产物。
    expect(() =>
      transform("<html></html>", { filename: "/index.html", server: undefined })
    ).toThrow();
  });

  it("构建态插的是打包策略，开发态插的是开发策略——两态各一份，不共用", async () => {
    const build = rendererCspPlugin();
    const serve = rendererCspPlugin();
    const resolve = (p: ReturnType<typeof rendererCspPlugin>) => {
      const hook = p.configResolved;
      expect(typeof hook).toBe("function");
      if (typeof hook !== "function") throw new Error("configResolved 不是函数");
      return hook;
    };
    // 用最小形状喂 configResolved：这一层只认 command 与 server 里的 host/port。
    resolve(build)({ command: "build", server: {} } as never);
    resolve(serve)({
      command: "serve",
      server: { host: "localhost", port: 5199 }
    } as never);
    const buildHtml = String(
      (build.transformIndexHtml as (h: string) => string)("<html><head></head></html>")
    );
    const serveHtml = String(
      (serve.transformIndexHtml as (h: string) => string)("<html><head></head></html>")
    );
    expect(buildHtml).toContain(PACKAGED);
    expect(serveHtml).toContain("ws://localhost:5199");
    expect(serveHtml).toContain("'unsafe-eval'");
    expect(buildHtml).not.toContain("'unsafe-eval'");
  });

  it("index.html 里不写死策略，判据只有 renderer-csp.ts 那一份", () => {
    const html = readFileSync(path.join(here, "../renderer/index.html"), "utf8");
    expect(html).not.toContain("Content-Security-Policy");
  });

  it("装配点确实把插件装上了（electron.vite.config.ts 的 renderer.plugins 里有它）", () => {
    const config = readFileSync(path.join(here, "../../electron.vite.config.ts"), "utf8");
    expect(config).toContain("rendererCspPlugin");
    expect(config).toMatch(/plugins:\s*\[[^\]]*rendererCspPlugin/);
  });
});
