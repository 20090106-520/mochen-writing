/// <reference types="node" />
/**
 * 渲染层的 CSP（2026-10-10 全仓扫描 P1-8 剩下那一条）。
 *
 * 【为什么单独立一个文件】P1-7（IPC 来源闸）与 P1-8 的窗口闸都挡「别人家的帧」，
 * 唯独挡不住「我们自己的页面里被塞进一段脚本」——那一帧 URL 合法、来源合法，
 * `ipc-guard.ts` 的 `isTrustedSender` 认它。能让外部脚本跑不起来、把话发不出远端的只有 CSP。
 * 判据只许这一份：原来 `index.html` 里一条都没有，而窗口侧的注释已经写着「真正拦这件事的是
 * `renderer/index.html` 的 meta」——注释跑到现实前面，比没闸更坏（铁律：不许有第二份口径，也不许有假口径）。
 *
 * 【为什么不在 html 里写死】开发态与打包态必须不同：vite 的 HMR 要 `'unsafe-eval'` 与一条 ws，
 * 打包态这两样都要禁掉。而**两条 CSP meta 同时存在时浏览器取交集**，
 * 把宽松那条写死进 html 等于开发态也严格（白屏），把严格那条写死等于打包态也宽松（白装）。
 * 所以策略住在这里，由 vite 插件按 `command` 选一份插进当次产物。
 *
 * 【这条策略挡不住什么——别当成已经 solved】
 *   - 同源页面里的合法脚本调 IPC：那是 `ipc-guard` + fs-store 写盘闸的地盘。
 *   - `sandbox: false` 仍在（本轮没动，见报告真机复验清单）。
 *   - 渲染层将来若要真去远端取素材，得先决定把素材落到本地，而不是给 CSP 开域名白名单——
 *     粒子挂件的 draco 解码器默认指向 `https://www.gstatic.com/...` 就是这么一处（仓里没有任何
 *     在用的 `.glb` 素材，grep 复验），所以打包态**不放行**该域名，接了远程域名的 CSP 就不再是白名单。
 */

/** meta 标签的 http-equiv 值；测试与装配点都引用这一枚，不各自拼字符串。 */
export const CSP_META_HTTP_EQUIV = "Content-Security-Policy";

/** 这一层认识的指令名（逐字小写）。不认识的必须报错，见 `serializeCsp` 的注释。 */
const KNOWN_DIRECTIVES = new Set([
  "default-src",
  "script-src",
  "script-src-elem",
  "style-src",
  "style-src-elem",
  "img-src",
  "font-src",
  "connect-src",
  "worker-src",
  "child-src",
  "frame-src",
  "object-src",
  "base-uri",
  "form-action",
  "frame-ancestors",
  "manifest-src",
  "media-src"
]);

export interface CspEntry {
  readonly directive: string;
  readonly sources: string;
}

/**
 * 把指令列表拼成一条策略，并且**当场**拦住三种「写了等于没写」的写法：
 * ① 指令名拼错——CSP 对不认识的指令是静默忽略，整条 `connect-src` 白装；
 * ② 同名指令出现两次——浏览器只认前一份，第二份是改了判据而没人知道；
 * ③ 来源写空——`img-src` 后面光秃秃在 CSP 里是「该类别一律禁止」，多半不是本意。
 */
export function serializeCsp(entries: readonly CspEntry[]): string {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!KNOWN_DIRECTIVES.has(entry.directive)) {
      throw new Error(
        `CSP 不认识这条指令：「${entry.directive}」（指令名必须逐字小写且拼对，写错会被浏览器静默忽略，整道闸等于没装）`
      );
    }
    if (seen.has(entry.directive)) {
      throw new Error(
        `CSP 指令重复：「${entry.directive}」出现两次——浏览器只认前一份，等于悄悄换了判据`
      );
    }
    seen.add(entry.directive);
    if (entry.sources.trim() === "") {
      throw new Error(
        `CSP 指令「${entry.directive}」的来源是空串——那在 CSP 里意思是全部禁止，多半是拼漏了`
      );
    }
  }
  return entries.map((entry) => `${entry.directive} ${entry.sources.trim()}`).join("; ");
}

export type CspMode = "packaged" | "dev";

export interface DevServerInfo {
  readonly host?: string;
  readonly port?: number;
}

/** 开发态要连的那台 dev server：把主机名凑全，端口缺省按「该主机任意端口」放行。 */
function devConnectSources(server: DevServerInfo): string {
  const rawHost = typeof server.host === "string" ? server.host.trim() : "";
  // vite 的 `server.host` 可以是 true / 0.0.0.0 这类「监听地址」，不是「浏览器里写的地址」，
  // 直接塞进 CSP 会放行一条永远匹配不上的来源，而真正要用的 localhost 反而没放行。
  const hosts = new Set(["localhost", "127.0.0.1"]);
  if (rawHost !== "" && rawHost !== "true" && !rawHost.startsWith("0.0.0.0")) hosts.add(rawHost);
  const port = typeof server.port === "number" && server.port > 0 ? server.port : undefined;
  const sources = new Set<string>(["'self'", "data:", "blob:"]);
  for (const host of hosts) {
    // 不带端口＝该主机任意端口（CSP 的匹配规则），兜底那份就只有这两条。
    sources.add(`http://${host}`);
    sources.add(`ws://${host}`);
    if (port !== undefined && host === rawHost) {
      sources.add(`http://${host}:${port}`);
      sources.add(`ws://${host}:${port}`);
    }
  }
  return [...sources].join(" ");
}

/** 两态共用的那部分；开发态只在 `connect-src` 与 `script-src` 上放宽。 */
function baseEntries(dev: boolean, server: DevServerInfo): readonly CspEntry[] {
  return [
    { directive: "default-src", sources: "'self'" },
    // 开发态多给 `'unsafe-eval'`：vite 的 HMR 与部分插件依赖它。打包态禁——那正是注入脚本要用的东西。
    { directive: "script-src", sources: dev ? "'self' 'unsafe-eval'" : "'self'" },
    // 行内样式必须放行：皮肤靠 style 属性写 CSS 变量，禁掉等于界面当场散架（行内**脚本**仍然是禁的）。
    { directive: "style-src", sources: "'self' 'unsafe-inline'" },
    { directive: "img-src", sources: "'self' data: blob:" },
    { directive: "font-src", sources: "'self' data:" },
    { directive: "connect-src", sources: dev ? devConnectSources(server) : "'self' data: blob:" },
    { directive: "worker-src", sources: "'self' blob:" },
    { directive: "frame-src", sources: "'none'" },
    { directive: "object-src", sources: "'none'" },
    { directive: "base-uri", sources: "'none'" },
    { directive: "form-action", sources: "'none'" },
    { directive: "frame-ancestors", sources: "'none'" }
  ];
}

/** 当前这份页面该带的策略。开发态与打包态的唯一分叉点就在这里。 */
export function buildRendererCsp(input: {
  readonly mode: CspMode;
  readonly devServer?: DevServerInfo;
}): string {
  return serializeCsp(baseEntries(input.mode === "dev", input.devServer ?? {}));
}

/**
 * 包成 meta 标签。策略里出现双引号直接拒：那会把 `content="…"` 截断，
 * 截断之后的半条策略不是我们以为的那条——宁可炸，不发一份「看起来有闸其实没有」的产物。
 */
export function cspMetaTag(policy: string): string {
  if (policy.includes('"')) {
    throw new Error(
      "CSP 策略里不许出现双引号：它会被 content 属性截断，剩下的一半不是我们要的那条"
    );
  }
  return `<meta http-equiv="${CSP_META_HTTP_EQUIV}" content="${policy}" />`;
}

/** vite 插件的最小形状（只 `import type`，打包进主进程产物时不会把 vite 带进运行时）。 */
interface CspVitePlugin {
  readonly name: string;
  configResolved?: (config: unknown) => void;
  /**
   * vite 真会递**第二个**参数（`{ filename, server, tags }`）——这里把它声明出来，
   * 是为了「按真实调用形状写用例」（`renderer-csp.test.ts` 就是按两参调的），
   * 而不是让实现只吃一个参数、用例却传两个。策略本身来自 `configResolved`，这里用不到它。
   */
  transformIndexHtml?: (html: string, ctx: { filename: string; server?: unknown }) => string;
}

/**
 * 装配点（`electron.vite.config.ts` 的 `renderer.plugins`）只负责把它挂上，
 * 策略与插入位置都住在这个文件——两态各一份，不共用。
 */
export function rendererCspPlugin(): CspVitePlugin {
  let policy = buildRendererCsp({ mode: "packaged" });
  return {
    name: "mochen:renderer-csp",
    configResolved(config: unknown): void {
      const resolved = config as {
        command?: string;
        server?: { host?: string; port?: number };
      };
      policy = buildRendererCsp({
        mode: resolved.command === "serve" ? "dev" : "packaged",
        devServer: resolved.server ?? {}
      });
    },
    transformIndexHtml(html: string): string {
      const tag = cspMetaTag(policy);
      // 插在 charset 之后（CSP 排在前面会把编码声明挤出前 1024 字节），退一步才到 <head> 之后。
      const charset = /<meta[^>]*charset[^>]*>/i.exec(html);
      if (charset !== null) {
        const at = charset.index + charset[0].length;
        return `${html.slice(0, at)}\n    ${tag}${html.slice(at)}`;
      }
      const head = /<head[^>]*>/i.exec(html);
      if (head !== null) {
        const at = head.index + head[0].length;
        return `${html.slice(0, at)}\n    ${tag}${html.slice(at)}`;
      }
      throw new Error(
        "这份 html 没有 charset 也没有 head：不是我们的页面，宁可当场炸也不发没闸的产物"
      );
    }
  };
}
