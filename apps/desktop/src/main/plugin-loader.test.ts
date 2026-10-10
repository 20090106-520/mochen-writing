import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { REWRITTEN_NAME, loadPluginFrom } from "./plugin-loader.js";

/**
 * 插件装载器的**重复装载**契约（2026-10-09 全仓扫描 P2-12）。
 *
 * 原病灶：cache-buster 用的是 `?v=${Date.now()}`。它的本意是对的——「用户改了插件，界面要看得见」——
 * 但 URL 每次都新，等于把两件事一起办砸：
 * ① Node 的 ESM 注册表按 URL 存模块，每调一次就多一份**永远不会回收**的模块实例；
 * ② 每次 `plugins:list` 都走 `mountAll()` → 又 import 一遍 ⇒ 插件顶层副作用重跑一次
 *    （顶层 registerTool / 打开连接 / 打日志那些），而内容一个字都没变。
 *
 * 判据要的是**行为**而不是字符串形状：副作用计数器住在插件源码里，跑一次加一次。
 * 于是「同一份内容重复装」必须是 1，「内容真变了」必须是 2——这两条分开，才既不留假绿
 * （把 Date.now() 换成常量也会让第一条绿、第二条红），也不误杀真需求。
 */

const SHIM_SOURCE = `export const defineTool = (d) => d;\nexport const Service = class {};\n`;

function harness() {
  const root = mkdtempSync(join(tmpdir(), "mochen-plugin-loader-"));
  const pluginDir = join(root, "counter-plugin");
  // 插件目录要真的存在：loadPluginFrom 从**插件自己的目录**里找 client.js，
  // 上一版夹具漏了这一步，三条用例全红在 ENOENT 上——那是夹具的错，不是被测代码的错，
  // 红错了原因就等于没红（看不出该修哪一边）。
  mkdirSync(pluginDir, { recursive: true });
  const shimPath = pathToFileURL(join(root, "shim.mjs")).href;
  writeFileSync(join(root, "shim.mjs"), SHIM_SOURCE, "utf8");
  return { root, pluginDir, shimPath };
}

/** 插件源码：顶层加一次计数，导出的对象里带同一个计数——模块实例是不是同一份，一眼可判。 */
function pluginSource(tag: string): string {
  return `import { defineTool } from "@deepseek-ai/cordis";
globalThis.__mochenPluginLoadCount = (globalThis.__mochenPluginLoadCount ?? 0) + 1;
export const tools = [defineTool({ name: "${tag}" })];
export const loadCount = () => globalThis.__mochenPluginLoadCount;
`;
}

/** 装载回来的模块：这里只用到这两样，形状自己钉，不去迁 @mochen/plugin-kernel 那个宽类型。 */
type Loaded = { tools: { name: string }[]; loadCount: () => number };
// globalThis 上挂一个只有我们知道的名字：转成 Record 要经 unknown，
// 否则 tsc 会拦「这两个类型压根不重叠」（这条不是绕检查，是这类探针的固定写法）。
const counter = (): number =>
  (globalThis as unknown as Record<string, number>).__mochenPluginLoadCount ?? 0;
const setCounter = (v: number): void => {
  (globalThis as unknown as Record<string, number>).__mochenPluginLoadCount = v;
};
/** 第一件工具的名字：写成可选链是因为 strict 下 `tools[0]` 未必存在，而我们要的就是那个名字。 */
const firstName = (m: Loaded): string => m.tools[0]?.name ?? "(没有工具)";

describe("重复装载不许重跑副作用、也不许多占一份注册表", () => {
  it("同一份内容装两次：副作用只跑一次", async () => {
    const { pluginDir, shimPath } = harness();
    writeFileSync(join(pluginDir, "client.js"), pluginSource("甲"), "utf8");
    setCounter(0);
    const first = (await loadPluginFrom(pluginDir, shimPath)) as unknown as Loaded;
    const second = (await loadPluginFrom(pluginDir, shimPath)) as unknown as Loaded;
    expect(counter(), "内容没变却把插件顶层又跑了一遍").toBe(1);
    expect(first.loadCount()).toBe(1);
    expect(second.loadCount()).toBe(1);
    expect(firstName(second)).toBe("甲");
  });

  it("内容真变了：必须看得出（这条红=把 cache-buster 改成常量的那种假修）", async () => {
    const { pluginDir, shimPath } = harness();
    writeFileSync(join(pluginDir, "client.js"), pluginSource("甲"), "utf8");
    setCounter(0);
    await loadPluginFrom(pluginDir, shimPath);
    writeFileSync(join(pluginDir, "client.js"), pluginSource("乙"), "utf8");
    const next = (await loadPluginFrom(pluginDir, shimPath)) as unknown as Loaded;
    expect(counter(), "改了插件却拿回旧的那份，等于界面永远看不见用户的改动").toBe(2);
    expect(firstName(next)).toBe("乙");
  });

  it("内容没变时不去重写产物文件（省下每次 list 的一次磁盘写）", async () => {
    const { pluginDir, shimPath } = harness();
    writeFileSync(join(pluginDir, "client.js"), pluginSource("甲"), "utf8");
    setCounter(0);
    await loadPluginFrom(pluginDir, shimPath);
    const out = join(pluginDir, REWRITTEN_NAME);
    // 往产物里插一枚记号：内容未变的那次装载若真去重写，记号就没了。
    writeFileSync(out, readFileSync(out, "utf8") + "\n// 记号\n", "utf8");
    await loadPluginFrom(pluginDir, shimPath);
    expect(readFileSync(out, "utf8"), "内容未变仍重写了产物文件").toContain("记号");
  });
});
