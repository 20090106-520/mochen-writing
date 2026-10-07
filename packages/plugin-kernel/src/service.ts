/**
 * service 基类（官方文档的「类形态」那一档）。
 *
 * 官方示例：
 * ```ts
 * export default class MyService extends Service {
 *   static inject = ["tools"]
 *   constructor(ctx: Context) { super(ctx, "myService") … }
 * }
 * ```
 * 【这一段注释里为什么没有出现「块注释的开始/结束符」】
 * 官方示例那行构造器带一句省略的行内注释，照抄进来会**提前结束本段 JSDoc**，
 * 编译报出来的是 service.ts 里一个莫名其妙的 token（第一次报在第 8 行）。
 * 「类形态用于插件要**向别的插件**提供服务」——所以本仓这版服务按名字登记进容器，
 * 别的插件可以 `inject: ["myService"]`。一个插件只能服务一个名字（官方签名就是这么写的）。
 */
import type { Context, ServiceHandle } from "./types.js";

/**
 * 当前正在挂载的那一轮用的注册表。
 *
 * 【为什么不能按 ctx 存】早先这里是个 `WeakMap<Context, …>`，看着够用——
 * 每个插件各拿一个 ctx，于是**每个插件都有一张空表**，插件 A 注册的 widget
 * 插件 B 永远看不见，「类形态用于插件向别的插件提供服务」这句话整条落空，
 * 而「同名 service 不许静默覆盖」那条守卫也因此量不到冲突（两个 ctx 两张表，撞不上）。
 * ⇒ 注册表是**整个应用**一张，挂载期间由 `runInRegistry` 指出来。
 *
 * 并发：挂载是同步的，且一次只挂一个插件，所以「当前这张表」不存在交错问题。
 * 真要做到异步挂载，得把注册表显式穿进 Service 构造器——那是以后的事，现在别提前付账。
 */
let active: Map<string, ServiceHandle> | null = null;

/** 在指定的注册表里执行一段代码（挂载 apply 用）。 */
export function runInRegistry<T>(registry: Map<string, ServiceHandle>, fn: () => T): T {
  const previous = active;
  active = registry;
  try {
    return fn();
  } finally {
    active = previous;
  }
}

const FALLBACK = new WeakMap<Context, Map<string, ServiceHandle>>();

/** 把服务挂到当前那张注册表上（由 `createPluginApp` 调）。 */
export function registerService(ctx: Context, handle: ServiceHandle): void {
  const map = active ?? FALLBACK.get(ctx) ?? new Map<string, ServiceHandle>();
  if (map.has(handle.serviceName)) {
    // 同名服务不许静默覆盖：后一个插件会以为自己独占，实际拿到的是前一个的行为。
    throw new Error(`服务 ${handle.serviceName} 已经被另一个插件占着了。`);
  }
  map.set(handle.serviceName, handle);
  if (active === null) FALLBACK.set(ctx, map);
}

/** 按名字取服务；没有就是 `undefined`（**不抛**，插件该在 inject 里声明过）。 */
export function lookupService<T extends object>(
  registry: Map<string, ServiceHandle>,
  name: string
): T | undefined {
  return registry.get(name) as T | undefined;
}

export abstract class Service implements ServiceHandle {
  static inject: readonly string[] = [];

  readonly serviceName: string;

  constructor(ctx: Context, serviceName: string) {
    this.serviceName = serviceName;
    registerService(ctx, this);
  }

  /** 需要显式收尾的资源（网络连接之类）由子类覆写。官方文档：不给就不用清。 */
  [Symbol.dispose]?(): void;
}
