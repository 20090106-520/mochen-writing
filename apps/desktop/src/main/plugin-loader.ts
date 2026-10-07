/**
 * 插件加载器：把一份按 DSH 文档写的插件，变成墨宸能 import 的模块（2026-10-07 批次 5-㉘）。
 *
 * 【要解决的到底是什么】
 * 插件源码里写的是 `import { defineTool, Service, type Context } from "@deepseek-ai/cordis"`。
 * 那是**运行期真的 import**，不是类型标注——不解决它，模块在 import 那一刻就炸。
 *
 * 【为什么不能直接装 npm 包就完事】
 * ① electron-vite 把依赖 externalize 了，插件跑在 `<appData>/plugins/<名字>/` 里，
 *    Node 从**插件自己的目录**往上找 node_modules，找不到应用那份。
 * ② 应用打包后 node_modules 不随包走，装在应用里也一样解析不到。
 * ⇒ 装的时候把 `@deepseek-ai/*` 这一句改写到本仓的 shim 上。
 * shim 提供官方文档里插件会 import 的那几样：`defineTool`、`Service`、类型 `Context`。
 *
 * 【改写而不是注入 loader hook 的理由】
 * `module.register()` 那条路要装全局 loader、影响进程里所有模块解析，
 * 而插件目录是用户可写的——让全进程去解一个用户目录，风险面比改写大得多。
 * 改写只动**这一个文件**，装卸都跟着插件目录走，出事也只出在这一份。
 *
 * 【边界：只改 import 的来源，不碰别处】
 * 只匹配 `from "@deepseek-ai/…"` 这一种形状。字符串里提到这个名字（例如文档字符串）
 * 一律不动——否则会把一句说明文字改成 import 路径，插件当场语法错误。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginModule } from "@mochen/plugin-kernel";

/** 改写产物落在插件目录里的名字。留在**同一目录**是关键：插件内部 `./helper.js` 这类相对引用才不会断。 */
export const REWRITTEN_NAME = ".mochen-plugin.mjs";

/** 只认 import 的来源那一种形状。刻意不含 `import(` 动态导入——那份源码里没有。 */
const IMPORT_FROM = /(from\s*)(["'])@deepseek-ai\/[^"']+\2/g;

/**
 * 把源码里 `@deepseek-ai/*` 的 import 来源改写到 shim。
 *
 * @param shimPath 绝对路径或 file URL；写进源码时要转成正斜杠（Windows 上反斜杠会毁掉转义）。
 */
export function rewritePluginSource(source: string, shimPath: string): string {
  const target = shimPath.replace(/\\/g, "/");
  return source.replace(
    IMPORT_FROM,
    (_all, from: string, quote: string) => `${from}${quote}${target}${quote}`
  );
}

/** 源码里有没有 `@deepseek-ai/*` 的 import（界面上如实说「这份要适配」而不是装完才发现）。 */
export function usesDeepSeekImports(source: string): boolean {
  return new RegExp(IMPORT_FROM.source).test(source);
}

/** 插件入口文件名：先找 `client.js`（官方示例那个名字），再找 `index.js`。 */
export function entryOf(dir: string): string | null {
  for (const name of ["client.js", "index.js", "main.js"]) {
    const file = join(dir, name);
    if (existsSync(file)) return file;
  }
  return null;
}

/**
 * 读一份插件并 import 进来。
 *
 * **失败一律抛中文单句**，由调用方（插件服务）记成一条 ok:false——
 * 官方文档要求「加载失败要说出来」，静默跳过等于让用户以为装上了。
 */
export async function loadPluginFrom(dir: string, shimPath: string): Promise<PluginModule> {
  const entry = entryOf(dir);
  if (entry === null) throw new Error("这个目录里没有插件入口（client.js / index.js / main.js）。");
  const source = readFileSync(entry, "utf8");
  const rewritten = rewritePluginSource(source, shimPath);
  const out = join(dir, REWRITTEN_NAME);
  writeFileSync(out, rewritten, "utf8");
  // 带一个时间戳做 cache-buster：重装同一个插件时 Node 的 ESM 缓存会拿旧的那份，
  // 于是「我改了插件」在真机上完全看不出变化——比报错更难查。
  const url = `${pathToFileURL(out).href}?v=${Date.now()}`;
  return (await import(url)) as PluginModule;
}
