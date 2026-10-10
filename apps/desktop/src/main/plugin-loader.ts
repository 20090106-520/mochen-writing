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
import { createHash } from "node:crypto";
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
 * 本进程已经写出过的产物：产物绝对路径 → 那一次写入内容的哈希。
 *
 * 【为什么要有这么一张表】
 * 插件目录是用户可写的，产物文件也可能被别的进程改过。判断「要不要重写」不能看盘上现在
 * 是什么——那会把「用户手动改了产物」当成「我上次写坏了」而反复覆盖；也不能压根不写——
 * 那第一次装载就没人产出这份文件。所以这里只回答一个问题：**这个进程是否已经为同一份内容
 * 写过一次**。写过就省掉这次磁盘写（每次 plugins:list 都 mountAll，原先等于每次 list
 * 都要写一遍插件目录，2026-10-09 全仓扫描 P2-12 记的那笔账）。
 *
 * 【为什么表不会无限长】
 * 键是产物路径，一个插件一个，上界就是插件个数；停用/删除插件时目录没了，条目最多留在
 * 上一轮，不随调用次数增长。这跟原先用 Date.now() 当 cache-buster 的差别是关键：那个值
 * 进了 import URL，Node 的 ESM 注册表按 URL 存模块，于是每次 list 都多一份永不回收的实例。
 */
const writtenArtifacts = new Map<string, string>();

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
  // cache-buster 用**内容哈希**而不是时间戳：
  // ① 用户真改了插件 → 哈希变 → URL 变 → Node 重新 import，界面上照样看得见改动；
  // ② 内容没改 → URL 一个字不变 → 命中 ESM 注册表里的同一份模块，顶层副作用不重跑，
  //    也不再每轮多一份实例。原先用 Date.now()，把 ① 的正当需求办到了，却把 ② 全盘丢掉。
  const contentHash = createHash("sha256").update(rewritten).digest("hex");
  // 盘上文件被删（用户清理、换目录）时仍要补写一次，所以这里除了比对哈希还看存在性。
  if (writtenArtifacts.get(out) !== contentHash || !existsSync(out)) {
    writeFileSync(out, rewritten, "utf8");
    writtenArtifacts.set(out, contentHash);
  }
  const url = `${pathToFileURL(out).href}?v=${contentHash.slice(0, 16)}`;
  return (await import(url)) as PluginModule;
}
