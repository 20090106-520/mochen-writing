/**
 * 插件运行时（主进程那一侧，2026-10-07 批次 5-㉘）。
 *
 * 【它做的事】
 * 扫 `<appData>/plugins/` 下每个子目录 → 走 plugin-loader 改写并 import → 交给内核挂载 →
 * 把插件注册的工具**叠加**到智能体的工具表后面。
 *
 * 【三条不许省的规矩】
 * ① **只读全局目录**，绝不往书目录里塞东西（与技能市场同一条铁律）。
 * ② **一个插件坏了不许连累别的**：内核按插件隔离，失败那条记成 ok:false + 中文理由，
 *    其余照常用。静默跳过会让用户以为装上了。
 * ③ **重启要重挂**：插件是进程内状态，应用重启后必须自己把目录扫回来——
 *    这条最容易被漏，漏了的表现是「昨天还好好的」。
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readDocFile } from "@mochen/fs-store";
import type { DocRef } from "@mochen/contracts";
import {
  createPluginApp,
  defineTool,
  Service,
  type DocsService,
  type MountedPlugin,
  type PluginDoc,
  type ToolDefinition
} from "@mochen/plugin-kernel";
import type { ChatToolSpec, ToolOutcome } from "@mochen/agent-runtime";
import { IPC_CHANNELS } from "@mochen/contracts";
import type { PluginListResult } from "@mochen/contracts";
import { entryOf, loadPluginFrom } from "./plugin-loader.js";
import { BUILTIN_PLUGINS } from "./builtin-plugins.js";

/** 与 skill-market-service.ts 同款：只用来登记通道，不直接依赖 electron。 */
type Handler = (channel: string, fn: (...args: unknown[]) => unknown) => void;

/** 适配层文件名。启动时生成一次，插件里的 `@deepseek-ai/*` import 全部改写到它。 */
export const SHIM_NAME = ".mochen-cordis-shim.mjs";

/**
 * 适配层的内容。
 *
 * 【为什么不 import 本仓的 kernel 源码】主进程构建把依赖 externalize 掉了，
 * kernel 被打进主进程 chunk，磁盘上**没有**一个能被 import 的文件。
 * 而插件 import 的是 `@deepseek-ai/cordis`——那句话必须落到某个真实文件上。
 * ⇒ 生成一个薄适配层，从全局取**同一个** kernel 实例。
 *
 * 【为什么不是重新实现一份】再写一份 `defineTool`/`Service` 就是第二份实现，
 * 将来 kernel 改了而 shim 没改，插件会以一份**永远不变的旧语义**运行，
 * 且没有任何测试会红。
 */
const SHIM_SOURCE = `// 墨宸为插件生成的适配层（自动写出的，不要手改）。
const k = globalThis.__mochen_plugin_kernel;
if (!k) throw new Error("插件适配层先于内核就绪了，这不该发生。");
export const defineTool = k.defineTool;
export const Service = k.Service;
`;

export interface PluginServiceOptions {
  /** 全局插件目录（`<appData>/plugins`）。不存在会在 mountAll 时建出来。 */
  pluginsDir: string;
  /**
   * 现取当前书。**每次调用都现取，绝不在这里拍快照**（理由见 kernel 的 DocsService 注释）：
   * 插件挂载在启动时，那时通常还没开书；用户随时会换书。
   */
  book(): { root: string; docs: readonly DocRef[]; title: string } | null;
}

export interface PluginService {
  /** 扫目录并挂载。启动时调一次；之后再调是「重挂」（换插件后刷新用）。 */
  mountAll(): Promise<readonly MountedPlugin[]>;
  /** 交给模型的工具规格；没有插件就是空数组。 */
  extraSpecs(): ChatToolSpec[];
  has(name: string): boolean;
  call(name: string, args: Record<string, unknown>): Promise<ToolOutcome>;
  list(): MountedPlugin[];
  /** 被停用的安装名（停用的那些这一轮没挂）。 */
  disabled(): string[];
  isDisabled(dirName: string): boolean;
  /**
   * 停用/启用一个插件。**改完不会自动重挂**——
   * 界面要拿到一句如实的回执，所以由调用方决定要不要 `mountAll()` 刷新。
   */
  setDisabled(dirName: string, disabled: boolean): void;
  /** 卸一个插件（删掉它整个目录）。目录名不合法或不存在时抛。 */
  removePlugin(dirName: string): void;
  /** 读一个插件的 `client.js` 源码（给界面上的预览）。只读、限长、截断时如实标。 */
  readSource(dirName: string): Promise<{ content: string; truncated: boolean }>;
  /**
   * 插件目录本身（只读）。列清单要在主进程扫盘，而目录不是构造参数以外的东西——
   * 所以由 service 自己交出来，而不是 IPC 层去猜路径。
   */
  pluginsDir(): string;
}

/** 停用清单的文件名（落在插件目录里，与那些插件目录平级，所以扫目录时会跳过它）。 */
export const DISABLED_FILE = ".mochen-plugins-disabled.json";

/** 插件源码的预览上限（字符）。超出截断并如实标 truncated。 */
export const SOURCE_MAX_CHARS = 8000;

export function createPluginService(options: PluginServiceOptions): PluginService {
  const app = createPluginApp({ services: { docs: createDocsService(options.book) } });
  // 适配层从这里取实现：一个 kernel，两个入口。
  (globalThis as Record<string, unknown>).__mochen_plugin_kernel = { defineTool, Service };

  function ensureShim(dir: string): string {
    mkdirSync(dir, { recursive: true });
    const shim = join(dir, SHIM_NAME);
    if (!existsSync(shim)) writeFileSync(shim, SHIM_SOURCE, "utf8");
    return shim;
  }

  async function mountAll(): Promise<readonly MountedPlugin[]> {
    mkdirSync(options.pluginsDir, { recursive: true });
    // 停用清单**必须在挂载之前**读：停用的插件压根不挂，它的工具也就不进工具表。
    // 【为什么不能「挂着但回失败」】那样模型仍看得见那个工具名，于是会反复调它、
    // 反复拿到失败——一个看得见却永远调不通的工具比看不见更糟。
    const disabled = readDisabled();
    // 传 **file:// URL**，不是路径：Windows 上 Node 的 ESM loader 只认 URL，
    // 直接塞 `C:\…\shim.mjs` 会报「absolute paths must be valid file:// URLs」
    //（真机第一次跑就撞在这句上——报错来自内核之外的链路，报出来才看得见）。
    const shim = pathToFileURL(ensureShim(options.pluginsDir)).href;
    // **先把上一轮挂的全卸掉**，再扫这一轮。
    // 【这一行是「停用」能不能真生效的关键】漏了它，停用就只是「这一轮不重新挂」——
    // 而上一轮挂上去的那份工具**还留在表里**，于是模型照样调得到。
    // 症状与界面撒谎完全一样：用户点了停用，界面也变了，能力却还在。
    // mount() 内部会对同名插件先 unmount 一次，但那只覆盖「这轮要挂的」，
    // 停用的、这轮压根不碰的那些没人替它清。
    for (const one of app.list()) app.unmount(one.name);
    const results: MountedPlugin[] = [];
    for (const name of readdirSync(options.pluginsDir)) {
      const dir = join(options.pluginsDir, name);
      // 只认目录：用户随手丢一个 .txt 进来，不该被当成插件而报一条错。
      if (!statSync(dir).isDirectory()) continue;
      if (name.startsWith(".")) continue;
      // 停用的：**静默跳过**，不记成「装不上」。
      // 【为什么不给它记一笔】markFailed 会把 ok 置成 false，界面就会说它「装不上」——
      // 而用户自己刚点的停用。这是一句彻头彻尾的谎：东西好好的，是用户不要它跑。
      // 「在册但没挂」这件事由 describe() 那一层如实告诉界面。
      if (disabled.has(name)) continue;
      try {
        const module = await loadPluginFrom(dir, shim);
        results.push(app.mount(name, module));
      } catch (err) {
        // 加载失败要说出来（官方文档同款要求）：一句中文，不带堆栈。
        // 这一步还没拿到模块，所以不走 mount（mount 需要一个模块），
        // 由内核的 markFailed 记一笔——清单里要看得见「装过但没装上」。
        const message = err instanceof Error ? err.message : String(err);
        results.push(app.markFailed(name, `这个插件没装上：${message}`));
      }
    }
    return results;
  }

  const defs = new Map<string, ToolDefinition>();
  const sync = (): void => {
    defs.clear();
    for (const tool of app.tools()) defs.set(tool.name, tool);
  };
  // 挂载会改变工具表：这里用它做「每次读都重算一次」的兜底，
  // 免得再维护一份缓存（缓存与真实表漂开，症状是「装完插件模型还是看不见它」）。
  sync();

  return {
    mountAll,
    extraSpecs: () => {
      sync();
      return [...defs.values()].map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: toSpecParameters(tool.parameters)
      }));
    },
    has: (name) => app.tools().some((tool) => tool.name === name),
    async call(name, args) {
      const tool = app.tools().find((t) => t.name === name);
      if (tool === undefined) {
        return { ok: false, text: `插件工具 ${name} 不在了（插件可能被卸了）。`, proposals: [] };
      }
      try {
        const result = await tool.execute(args);
        return { ok: result.ok, text: result.text, proposals: [] };
      } catch (err) {
        // 插件工具抛错**不是**本轮失败：它是一次失败的工具调用，模型看得见才换得掉。
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, text: `插件工具 ${name} 自己抛了错：${message}`, proposals: [] };
      }
    },
    list: () => [...app.list()],
    pluginsDir: () => options.pluginsDir,
    disabled: () => [...readDisabled()],
    isDisabled,
    setDisabled,
    removePlugin,
    readSource
  };

  /** 停用清单落在插件目录**外面**的那一个文件里。 */
  function disabledPath(): string {
    return join(options.pluginsDir, DISABLED_FILE);
  }
  function readDisabled(): Set<string> {
    try {
      const parsed = JSON.parse(readFileSync(disabledPath(), "utf8")) as { disabled?: unknown };
      if (!Array.isArray(parsed.disabled)) return new Set();
      return new Set(parsed.disabled.filter((one): one is string => typeof one === "string"));
    } catch {
      // 读不到/坏了 = 什么都没停用。这是**保守方向**：宁可全开，不要用户以为停用了其实还在跑。
      return new Set();
    }
  }
  function isDisabled(dirName: string): boolean {
    return readDisabled().has(dirName);
  }
  /** 启用是「从清单里删掉它」，停用是「加进去」。停用清单为空时把文件删掉，别留一个空壳。 */
  function setDisabled(dirName: string, disabled: boolean): void {
    const next = readDisabled();
    if (disabled) next.add(dirName);
    else next.delete(dirName);
    if (next.size === 0) rmSync(disabledPath(), { force: true });
    else writeFileSync(disabledPath(), JSON.stringify({ disabled: [...next] }, null, 2), "utf8");
  }
  /**
   * 卸一个插件：删掉它整个目录。
   *
   * 【为什么不复用 mavis-trash 那类回收站】插件目录在**用户的** appData 下，
   * 而本函数跑在应用里，用户点「卸载」要的是立刻少一个工具，不是进回收站等他自己去清。
   * 内置插件被卸掉也没关系：下次启动 `seedBuiltinPlugins` 会重新种（这是恢复出厂那条路）。
   */
  function removePlugin(dirName: string): void {
    const dir = join(options.pluginsDir, dirName);
    // 只许删插件目录的**直接子目录**，且必须真的存在。
    // 名字里带路径分隔符的一律拒：否则 "../" 能把删的动作递到插件目录外面去。
    if (dirName.includes("/") || dirName.includes("\\") || dirName.startsWith(".")) {
      throw new Error("这不是一个插件目录名。");
    }
    if (!existsSync(dir)) throw new Error("这个插件已经不在了。");
    rmSync(dir, { recursive: true, force: true });
  }
  /**
   * 读一个插件的源码。只读、只读插件目录内，且限长。
   *
   * 【为什么限长】界面要摆「看一眼它写了什么」，一份三千行的插件源码能把浮层撑到视口外。
   * 截断时如实标 truncated——摆一半而不说，用户会以为那就是全部。
   */
  async function readSource(dirName: string): Promise<{ content: string; truncated: boolean }> {
    if (dirName.includes("/") || dirName.includes("\\") || dirName.startsWith(".")) {
      throw new Error("这不是一个插件目录名。");
    }
    const file = join(options.pluginsDir, dirName, "client.js");
    const full = readFileSync(file, "utf8");
    return full.length > SOURCE_MAX_CHARS
      ? { content: full.slice(0, SOURCE_MAX_CHARS), truncated: true }
      : { content: full, truncated: false };
  }
}

/**
 * 装配 `docs` service：插件读当前书的唯一入口。
 *
 * 【`read` 为什么必须走 `readDocFile` 而不自己 join 路径】
 * `readDocFile` 内部第一步就是 `assertSafeRelPath`：绝对路径、`..` 越界、空路径全被拒。
 * 这一层是**书目录边界**的执行点，所以判定只能有一份实现（铁律 6）。
 * 自己 `path.join(root, relPath)` 看着少两行，代价是插件递一个 `../../.ssh/id_rsa`
 * 就能读到书外的文件——而插件与主进程同权，这个门是唯一的一道。
 *
 * 【失败一律 null，不抛】
 * 插件拿到 null 会自己换个路径/说「没读到」，插件拿到 throw 会连带整个插件判定装失败。
 * 后者把「这一篇读不到」放大成「这个插件坏了」，是更大的谎。
 */
function createDocsService(book: PluginServiceOptions["book"]): DocsService {
  return {
    serviceName: "docs",
    bookTitle: () => book()?.title ?? null,
    list: (): readonly PluginDoc[] => {
      const current = book();
      if (current === null) return [];
      // 每一项都是**新对象**：直接把 DocRef 那份交出去，插件改一下就等于改了主进程持有的名稿清单。
      return current.docs.map((doc) => ({
        relPath: doc.relPath,
        title: doc.title,
        kind: doc.kind
      }));
    },
    async read(relPath) {
      const current = book();
      if (current === null) return null;
      try {
        return (await readDocFile(current.root, relPath)).content;
      } catch {
        // 路径非法、文件不存在、被占用——对插件是同一件事：这一篇读不到。
        return null;
      }
    }
  };
}

/**
 * 四条通道：列 / 停用启用 / 卸载 / 读源码（2026-10-07 批次 5-㉚）。
 *
 * 与技能市场同一条铁律：**渲染层只递安装名**，路径由主进程拼。
 * 传路径等于让渲染层决定读写哪，而渲染层是唯一不可信的一层（它跑在用户能改的文件里）。
 *
 * 【停用/启用/卸载之后一律重挂】
 * 「停用之后模型那一轮调不到」这句话要成立，重挂就不能省：不停重挂的话，
 * 用户点了停用、界面也变了，而工具还在表里——那是最坏的一种：界面说停了，实际没停。
 * 重挂的失败要如实回给界面，不许假装成功。
 */
export function registerPluginIpc(handle: Handler, plugins: PluginService): void {
  handle(IPC_CHANNELS.pluginsList, async () => {
    await plugins.mountAll();
    return pluginListRows(plugins);
  });
  handle(IPC_CHANNELS.pluginsToggle, async (_event, dirName, enabled) => {
    plugins.setDisabled(String(dirName), enabled !== true);
    await plugins.mountAll();
    return enabled === true
      ? `已启用「${dirName}」。`
      : `已停用「${dirName}」，这一轮它带的工具模型调不到了。`;
  });
  handle(IPC_CHANNELS.pluginsUninstall, async (_event, dirName) => {
    const name = String(dirName);
    plugins.removePlugin(name);
    // 顺手把它从停用清单里摘掉：否则目录没了、清单里还留着一条幽灵。
    if (plugins.isDisabled(name)) plugins.setDisabled(name, false);
    await plugins.mountAll();
    return `已卸载「${name}」。`;
  });
  handle(IPC_CHANNELS.pluginsSource, (_event, dirName) => plugins.readSource(String(dirName)));
}

/**
 * 列一张插件清单（**纯函数**，不碰 electron，所以能在单测里直接验）。
 *
 * 【这一段逐条排除的都是**应用自己写在插件目录里的文件**，不是「不像插件的东西」】
 * 真机第一版把它们当插件列了出来（探针 P530 量到两条：适配层 shim 与停用清单），
 * 于是用户看到「你有 4 个插件」而实际只有 2 个，另外两条他还停不掉、卸不掉。
 *
 * 三条判据，缺一不可：
 * ① 点开头的目录跳过——适配层与改写产物都在那儿（它们本来就该藏）。
 * ② 非目录跳过——停用清单那个 `.json` 由这条挡住。
 * ③ **要有入口文件**才算数，入口名复用 loader 的 `entryOf`——
 *   那是判定「什么算一个插件」的**唯一一份**实现，另写一份就会与装载时漂开。
 *   用户随手丢一个空目录进来，不给它一颗按了没反应的钮。
 *
 * 【为什么按「盘上有入口文件」列，而不按「这一轮挂没挂」】
 * 停用的插件这一轮压根没挂。按挂载筛会把它整条抹掉——而用户找的恰恰是
 * 「我停用了什么」。真机 P530 那条「已停用」分组就是靠这条才列得出来的。
 */
export function pluginListRows(plugins: PluginService): PluginListResult {
  const disabled = new Set(plugins.disabled());
  const mounted = new Map(plugins.list().map((one) => [one.name, one]));
  const builtin = new Map(BUILTIN_PLUGINS.map((one) => [one.dir, one]));
  const entries: PluginListResult["entries"] = readdirSync(plugins.pluginsDir()).flatMap(
    (dirName): PluginListResult["entries"] => {
      if (dirName.startsWith(".")) return [];
      if (!statSync(join(plugins.pluginsDir(), dirName)).isDirectory()) return [];
      if (entryOf(join(plugins.pluginsDir(), dirName)) === null) return [];
      const one = mounted.get(dirName);
      const isOff = disabled.has(dirName);
      return [
        {
          dirName,
          title: one?.name ?? dirName,
          toolNames: one?.ok === true ? [...one.toolNames] : [],
          // 停用的与装不上的**是两回事**，界面上要分开摆（面板的分组），
          // 所以这里给的理由也不同：停用说「你停的」，装不上说「它自己没装上」。
          ok: one?.ok ?? false,
          reason: isOff
            ? "你停用了它，这一轮没挂。"
            : one?.ok === true
              ? ""
              : (one?.reason ?? "这一轮没挂它。"),
          builtin: builtin.has(dirName),
          version: builtin.get(dirName)?.version ?? 0,
          disabled: isOff
        }
      ];
    }
  );
  return { entries, listed: true };
}

/** 插件的 JSON Schema 子集 → ChatToolSpec 要的 parameters。 */
function toSpecParameters(schema: ToolDefinition["parameters"]): ChatToolSpec["parameters"] {
  const base = {
    type: schema.type,
    ...(schema.description === undefined ? {} : { description: schema.description })
  };
  switch (schema.type) {
    case "array":
      return { ...base, items: toSpecParameters(schema.items) };
    case "object":
      return {
        ...base,
        properties: Object.fromEntries(
          Object.entries(schema.properties).map(([key, value]) => [key, toSpecParameters(value)])
        )
      };
    case "string":
      return { ...base, ...(schema.enum === undefined ? {} : { enum: [...schema.enum] }) };
    default:
      return base;
  }
}
