/**
 * Cordis 兼容插件的类型面（2026-10-07 批次 5-㉘）。
 *
 * 【这一份为什么照着抄 Cordis 的形状，而不是自己发明一套】
 * 目标是「让按 DeepSeek Harness 官方文档写的插件能装进来」。官方文档里那三种写法是：
 *
 * ```ts
 * // 函数形态
 * import type { Context } from "@deepseek-ai/cordis";
 * export const name = "my-plugin";
 * export function apply(ctx: Context) { ctx.tools.register(……) }
 * // 对象形态
 * export default { name: "my-plugin", inject: ["tools"], apply(ctx) {} };
 *
 * // 类形态（自己提供 service 时用）
 * export default class MyService extends Service { static inject = ["tools"]; … }
 * ```
 *
 * 形状不一样，插件就装不进来。所以这里逐条对着文档抄，**不发明新 API**。
 * 抄来的每一处都在注释里注明它对应官方文档的哪一段。
 *
 * 【这一段注释里为什么没有出现「块注释的开始/结束符」】
 * 官方示例里有几处省略的块注释，照抄进来会**提前结束本段 JSDoc**，
 * 编译报出来的是 types.ts 第 11 行一个莫名其妙的 token——不是代码错，是注释先结束了。
 */

/** JSON Schema 子集：插件声明工具入参用。刻意只收工具真正常用的那几档。 */
export type JsonSchema =
  | { type: "string"; description?: string; enum?: readonly string[] }
  | { type: "number"; description?: string }
  | { type: "boolean"; description?: string }
  | { type: "array"; description?: string; items: JsonSchema }
  | { type: "object"; description?: string; properties: Record<string, JsonSchema> };

/**
 * 工具的一次调用结果。
 * 刻意做成 `{ ok }` 而不是「成功抛异常、失败返回串」：
 * 工具失败**不是**程序错误，模型需要看见失败并据此换一条路。
 */
export type ToolResult = { ok: true; text: string } | { ok: false; text: string };

/** 插件注册进来的一个工具。模型能看见的就是 name/description/parameters。 */
export interface ToolDefinition {
  /** 必须是 `snake_case` 且全小写：它会原样进模型看得见的工具表。 */
  name: string;
  /** 什么时候该调它、需要什么前提、失败意味着什么——官方文档点名要求写清楚。 */
  description: string;
  parameters: JsonSchema;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

/**
 * 工具定义 DSL（官方文档里的 `ctx.tools.register(defineTool({ … }))`）。
 *
 * **它在本仓里是个恒等函数**：DSH 用它是为了拿到类型推导，运行期不需要任何行为。
 * 之所以仍然提供，是因为插件源码会 `import { defineTool } from "…"`——
 * 不导出它，插件在装进来那一刻就抛 `defineTool is not a function`。
 */
export function defineTool(definition: ToolDefinition): ToolDefinition {
  return definition;
}

/** service 容器里的一项能力（官方叫 service）。插件通过 `ctx.<名字>` 拿到它。 */
export interface ServiceHandle {
  /** service 的名字，与插件 `inject` 里写的一致。 */
  readonly serviceName: string;
  /** 卸载插件时由内核调用：让插件自己收尾（官方文档：`ctx.effect` 的返回值）。 */
  [Symbol.dispose]?(): void;
}

/** 官方文档里那个 `ctx`。插件只通过它登记能力。 */
export interface Context {
  /** 按名字拿 service；拿不到就是 `undefined`（插件该在 `inject` 里声明过）。 */
  get<T extends object>(name: string): T | undefined;
  /** 官方文档的 `ctx.tools.register(...)`。 */
  readonly tools: ToolsService;
  /** 官方文档的 `ctx.effect(fn)`：返回值是卸载时的清理函数。 */
  effect(disposer: () => void | (() => void)): void;
  /** 插件名字，内核在挂载时填好。 */
  readonly pluginName: string;
  /** 官方文档提到的自动清理面：事件监听。不许插件自己 removeListener。 */
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
}

/** `ctx.tools` 的真身。 */
export interface ToolsService extends ServiceHandle {
  /**
   * 官方文档：`ctx.tools.register(defineTool({ … }))`。
   * 返回值可以交给插件自己 later 注销；内核在卸载时**也会**清掉这一轮注册的。
   */
  register(definition: ToolDefinition): () => void;
  /** 已注册的工具（内核与界面读它；插件不该拿来做判断）。 */
  list(): readonly ToolDefinition[];
}

/**
 * 插件读的「当前书」。
 *
 * 【它为什么存在，以及为什么不叫它别的】
 * 官方那套 API 里插件只能拿到 `ctx`（登记能力）与 `ctx.tools`（挂工具），
 * 没有任何读用户数据的面。没有这一层，插件就只能有两种活法：要么收模型递进来的
 * 文本自己算，要么什么也做不了——而「自己算」正是插件唯一比智能体强的地方。
 *
 * 【它为什么是只读的】插件与主进程同权（与 DSH 官方一致，见 plugin-service 头注释），
 * 所以这一层的边界**不是**权限隔离，是**接口形状**：这里只有读，没有写。
 * 真要写盘，模型得走 `propose_patch`/`write_doc`，进审批卡片，用户看得见、改得了。
 * 插件自己偷偷写一份用户看不见的修改，那才是越权。
 *
 * 【为什么每次现取而不是构造时拍快照】
 * 快照的写法在单测里全绿，真机上是「换一本书，插件还在读上一本」。
 * 插件挂载发生在启动时（那时通常还没开书），用户随时会换书——
 * 所以每一个方法都必须穿过一个「现取当前状态」的函数，而不是抓住一个值。
 *
 * 【为什么没有 `activeDoc()`】
 * 早先给它留过一格，写完就发现兑现不了：主进程知道「这一轮在改哪一章」是因为
 * `buildHost` 拿着那一轮的 `docRelPath`，而**没有轮次进行时它并不知道用户打开的是哪一章**
 * （那是渲染层的选中态）。要凑一个全局指针，就得在每轮开始时写一次、在结束时清一次——
 * 于是又是一个「跨作用域缓存」，而它上一次咬人是换书后读到上一本书。
 * 删掉这一格，改为由模型在工具参数里显式递 `doc`：那个值模型本来就知道，
 * 插件也不必猜。少一个说不清的状态，胜过多一个方便。
 */
export interface DocsService extends ServiceHandle {
  /** 当前打开的书名；没开书返回 null（不是空串——空串与「书名真的叫空」分不开）。 */
  bookTitle(): string | null;
  /**
   * 当前书的文稿清单。没开书返回空数组。
   *
   * 【返回的每一项都是副本】内核把对象交给插件的那一刻起，插件就能改它；
   * 若直接回传主进程持有的那份，改一下就等于把书里的名稿清单改了，且改得无声无息。
   */
  list(): readonly PluginDoc[];
  /** 读一篇正文；路径不在书内或读不到都返回 null（不抛——插件不该因一次坏路径整个挂掉）。 */
  read(relPath: string): Promise<string | null>;
}

/** `DocsService.list()` 的一项。字段刻意是 `DocRef` 的一个只读子集——插件不需要写回。 */
export interface PluginDoc {
  /** 书内相对路径，如 `chapters/01.md`。 */
  relPath: string;
  /** 友好标题（来自 frontmatter 或文件名）。 */
  title: string;
  /** 类别，如「章节」「设定」。 */
  kind: string;
}

/** 插件的三种形态，统一收成这一份。 */
export type PluginModule =
  | { name?: string; inject?: readonly string[]; apply(ctx: Context): void }
  | {
      default: (new (ctx: Context) => ServiceHandle) & { inject?: readonly string[] };
      name?: string;
    };

/** 从模块里把「名字 / 依赖 / 挂载」三样取出来，三种形态各走各的取法。 */
export function readPluginShape(module: PluginModule): {
  name: string;
  inject: readonly string[];
  mount(ctx: Context): void;
} {
  // 判定顺序不能乱：**先认顶层 apply（函数形态，也是官方文档说「多数情况够用」的那种）**。
  // 【这里重写过一轮并踩了坑】早先只判 module.default，于是函数形态全被判成「形状认不出来」，
  // 16 条守卫里 10 条红——看上去像内核坏了，其实是把最常见的那一档漏了。
  const top = module as {
    name?: string;
    inject?: readonly string[];
    apply?: (ctx: Context) => void;
    default?: unknown;
  };

  // ① 函数形态：顶层就导出 apply。
  if (typeof top.apply === "function") {
    return { name: top.name ?? "未命名插件", inject: top.inject ?? [], mount: top.apply };
  }

  // ② 类形态：default 是个构造器，依赖挂在**构造器的静态属性**上。
  if (typeof top.default === "function") {
    const Ctor = top.default as new (ctx: Context) => ServiceHandle;
    return {
      name: top.name ?? Ctor.name,
      inject: (Ctor as { inject?: readonly string[] }).inject ?? [],
      mount: (ctx) => {
        new Ctor(ctx);
      }
    };
  }

  // ③ 对象形态：`{ default: { name, inject, apply } }`。
  // 同样踩过一次：这三样在 default **里面**，读顶层只会读到 undefined。
  const body = top.default as
    { name?: string; inject?: readonly string[]; apply?: (ctx: Context) => void } | undefined;
  if (body !== undefined && typeof body.apply === "function") {
    return {
      name: body.name ?? top.name ?? "未命名插件",
      inject: body.inject ?? top.inject ?? [],
      mount: body.apply
    };
  }

  throw new Error("这个模块既没有导出 apply，也不是带 default 对象的形态。");
}
