/**
 * 容器本体：官方文档里那个 Cordis 内核在本仓的等价物。
 *
 * 【它负责的四件事，一件都不许省】
 * ① **依赖门控**：插件 `inject: ["tools"]`，而 `tools` 不在 ⇒ 拒绝挂载并说清缺哪个。
 *    官方文档写的是「框架会等到每个必需 service 就绪才加载插件」——
 *    本仓的服务是启动时定死的，所以只剩「等不到」这一种，于是它必须是**硬失败**。
 *    静默加载一个依赖没到的插件，等于让它在错误的假设下跑，错了都不知道错在哪。
 * ② **挂载隔离**：一个插件 `apply` 抛错，不许把整个应用带下去——
 *    其余插件照常用，报错如实上报（官方文档：加载失败要说出来，不是静默跳过）。
 * ③ **自动清理**：官方文档明写「通过 ctx 登记的一切（事件监听、工具、定时器）
 *    在插件卸载时被清掉，你不需要自己 removeListener」。
 *    本仓照做，且把「这一轮注册的工具」逐个注销。
 * ④ **工具名去重**：重名必须报错。两个插件都叫 `read_file` 时，
 *    静默让后者覆盖前者 = 用户不知道自己正用着谁的实现。
 */
import { lookupService, runInRegistry } from "./service.js";
import {
  readPluginShape,
  type Context,
  type PluginModule,
  type ServiceHandle,
  type ToolDefinition,
  type ToolsService
} from "./types.js";

export interface PluginAppOptions {
  /** 启动就有的服务。键就是插件 `inject` 里写的那些名字。 */
  services?: Record<string, object>;
}

export interface MountedPlugin {
  name: string;
  /** 内核认定它可不可用。false = 依赖没到 / 挂载抛错，工具不计入。 */
  ok: boolean;
  /** 失败时那句人话（中文单句）。 */
  reason: string;
  /** 这一轮注册的工具（卸载后清空）。 */
  toolNames: readonly string[];
}

export interface PluginApp {
  /** 装一个插件。永不抛错——失败变成一条 `ok:false` 的记录。 */
  mount(name: string, module: PluginModule): MountedPlugin;
  /** 卸载：清工具、清定时器、跑插件自己给的清理函数。 */
  unmount(name: string): void;
  /**
   * 记一笔「装过但没装上」。
   * **为什么不靠 mount 报错代替**：加载失败时连模块都还没拿到（import 就炸了），
   * 没有模块可交给 mount。用一句「抛错」代替的话，清单里就**看不见**这份插件，
   * 用户会以为从来没装过——而磁盘上明明躺着一个装不上的目录。
   */
  markFailed(name: string, reason: string): MountedPlugin;
  /** 当前已挂载的插件清单。 */
  list(): readonly MountedPlugin[];
  /** 当前所有可用插件注册进来的工具。 */
  tools(): readonly ToolDefinition[];
  /** 插件触发的事件（给内核消费；插件之间不直接互相调）。 */
  emit(event: string, ...args: unknown[]): void;
  /** 注销事件监听（内核自己用）。 */
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
}

export function createPluginApp(options: PluginAppOptions = {}): PluginApp {
  const services = new Map<string, object>();
  for (const [name, value] of Object.entries(options.services ?? {})) services.set(name, value);
  // 插件互相提供的 service 放这一张表：整个应用一张，不是每个 ctx 一张。
  const registry = new Map<string, ServiceHandle>();

  const tools: ToolDefinition[] = [];
  const toolOwner = new Map<string, string>();
  const events = new Map<string, Set<(...args: unknown[]) => void>>();
  const mounted = new Map<string, MountedEntry>();
  /** 一个插件在册的全部东西：工具、它提供的 service、它的清理函数、它挂的事件。 */
  interface MountedEntry extends MountedPlugin {
    disposers: (() => void)[];
    listeners: [string, (...a: unknown[]) => void][];
    services: string[];
  }

  const toolsService: ToolsService = {
    serviceName: "tools",
    register(definition: ToolDefinition): () => void {
      const owner = current;
      if (owner === null) throw new Error("工具只能在插件挂载期间注册。");
      const taken = toolOwner.get(definition.name);
      if (taken !== undefined) {
        throw new Error(`工具 ${definition.name} 已经被「${taken}」占着了。`);
      }
      tools.push(definition);
      toolOwner.set(definition.name, owner.name);
      return () => removeTool(definition.name);
    },
    list: () => tools
  };
  services.set("tools", toolsService);

  function removeTool(name: string): void {
    const at = tools.findIndex((t) => t.name === name);
    if (at >= 0) tools.splice(at, 1);
    toolOwner.delete(name);
  }

  /** 当前正在挂载的插件。`apply` 同步执行期间有效，插件外为 null。 */
  let current: {
    name: string;
    disposers: (() => void)[];
    listeners: [string, (...a: unknown[]) => void][];
  } | null = null;

  function makeContext(pluginName: string): Context {
    const ctx: Context = {
      pluginName,
      get: <T extends object>(name: string) =>
        lookupService<T>(registry, name) ?? (services.get(name) as T | undefined),
      tools: toolsService,
      effect(disposer) {
        const value = disposer();
        if (typeof value === "function") current?.disposers.push(value);
      },
      on(event, handler) {
        const set = events.get(event) ?? new Set();
        set.add(handler);
        events.set(event, set);
        // 记在当前插件名下：官方文档说「卸载时一切经 ctx 登记的都被清掉，
        // 你不需要自己 removeListener」——那就得真的清掉，否则卸载后它还在收事件。
        current?.listeners.push([event, handler]);
      },
      off(event, handler) {
        events.get(event)?.delete(handler);
      }
    };
    return ctx;
  }

  function runDisposers(disposers: (() => void)[]): void {
    // 顺序反了会让清理代码用到已经没了的东西，报出来的错是它自己造成的。
    for (const dispose of disposers.splice(0)) {
      try {
        dispose();
      } catch {
        // 清理失败不许阻止其余清理：一个插件的收尾烂掉不该留下别的垃圾。
      }
    }
  }

  function unmount(name: string): void {
    const entry = mounted.get(name);
    if (entry === undefined) return;
    runDisposers(entry.disposers);
    for (const [event, handler] of entry.listeners) events.get(event)?.delete(handler);
    for (const tool of [...entry.toolNames]) removeTool(tool);
    // 插件自己提供的 service 也要撤：否则下一个同名插件永远撞名，而这个插件已经不在了。
    for (const key of [...registry.keys()]) if (entry.services.includes(key)) registry.delete(key);
    mounted.delete(name);
    // 记录是按**模块自报的名字**存的（自报名与安装目录名未必相同），
    // 按安装名卸载可能漏掉一条。宁可多扫一遍，也不留一条僵尸记录。
    for (const [key, other] of [...mounted]) {
      if (other !== entry && other.name === entry.name) unmount(key);
    }
  }

  function mount(name: string, module: PluginModule): MountedPlugin {
    unmount(name);
    let shape: ReturnType<typeof readPluginShape>;
    try {
      shape = readPluginShape(module);
    } catch (err) {
      return record(name, name, false, `这个插件的形状认不出来：${reason(err)}`, []);
    }

    const missing = shape.inject.filter((dep) => !services.has(dep) && !registry.has(dep));
    if (missing.length > 0) {
      // 硬失败，且说清缺哪几个：官方文档保证「依赖就绪才加载」，本仓做不到「等」，
      // 只能做到「不在就不装」，而沉默会让插件在错误假设下运行。
      return record(
        name,
        shape.name,
        false,
        `它要用到 ${missing.join("、")}，本仓没提供，所以没装上。`,
        []
      );
    }

    const ctx = makeContext(shape.name);
    const before = tools.length;
    const registryBefore = new Set(registry.keys());
    current = { name: shape.name, disposers: [], listeners: [] };
    try {
      runInRegistry(registry, () => shape.mount(ctx));
    } catch (err) {
      // 挂载抛错：撤掉它半路登记的东西，再如实记一笔。它不算装上。
      // 【为什么不能先写进 mounted 再删】早先那样写过：同名插件**装失败**时，
      // 会把先前那个装得好好的同名记录一并覆盖掉——用户看到的是「插件坏了」，
      // 实际坏的是刚才那一次尝试，而旧的那份已经没了。
      const flight = current;
      current = null;
      for (const tool of tools.slice(before)) removeTool(tool.name);
      if (flight !== null) {
        runDisposers(flight.disposers);
        for (const [event, handler] of flight.listeners) events.get(event)?.delete(handler);
      }
      return record(name, shape.name, false, `装上它的时候自己抛了错：${reason(err)}`, []);
    }
    const flight = current;
    current = null;
    const toolNames = tools.slice(before).map((t) => t.name);
    const entry = {
      name: shape.name,
      ok: true,
      reason: "",
      toolNames,
      disposers: flight?.disposers ?? [],
      listeners: flight?.listeners ?? [],
      services: [...registry.keys()].filter((key) => !registryBefore.has(key))
    };
    // 记录一律按**安装名**存。插件自报的名与安装目录名未必相同（类形态尤其明显：
    // 自报名是类名 `Widget`，安装名是目录名）。早先按自报名存，于是按安装名卸载
    // 找不到它——「提供方先卸载、用方下次因缺依赖被拒」那条守卫因此红。
    // entry.name 仍然记自报名，界面上要显示的是它。
    mounted.set(name, entry);
    return entry;
  }

  function record(
    installName: string,
    selfName: string,
    ok: boolean,
    reason: string,
    toolNames: readonly string[]
  ): MountedPlugin {
    const entry: MountedPlugin = {
      name: selfName === "未命名插件" ? installName : selfName,
      ok,
      reason,
      toolNames
    };
    mounted.set(installName, { ...entry, disposers: [], listeners: [], services: [] });
    return entry;
  }

  return {
    mount,
    unmount,
    markFailed: (name, reason) => record(name, name, false, reason, []),
    list: () =>
      [...mounted.values()].map(({ name, ok, reason, toolNames }) => ({
        name,
        ok,
        reason,
        toolNames
      })),
    tools: () => [...tools],
    emit(event, ...args) {
      for (const handler of [...(events.get(event) ?? [])]) handler(...args);
    },
    on(event, handler) {
      const set = events.get(event) ?? new Set();
      set.add(handler);
      events.set(event, set);
    },
    off(event, handler) {
      events.get(event)?.delete(handler);
    }
  };
}

function reason(err: unknown): string {
  return err instanceof Error && err.message !== "" ? err.message : String(err);
}

export type { ServiceHandle };
