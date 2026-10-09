/**
 * 内核守卫（2026-10-07 批次 5-㉘）。
 *
 * 这里的每一条都对应官方插件文档里的**一句承诺**，不是「我觉得应该这样」：
 * 「The framework waits for every required service before loading the plugin.」
 * 「Anything registered through ctx—event listeners, tools, or timers—is cleaned up when the plugin unloads.」
 * 「You do not need to call removeListener or clearInterval manually.」
 *
 * 内核没有真机可验（插件是别人的代码），所以这几条就是它唯一的防线——
 * 一条恒红的断言等于没写，所以下面每条都在**未改动的内核**上先验过。
 */
import { describe, expect, it } from "vitest";
import {
  Service,
  createPluginApp,
  defineTool,
  type Context,
  type PluginModule
} from "../src/index.js";

/** 一个官方文档形状的插件：函数形态 + inject。 */
function fnPlugin(
  name: string,
  inject: string[] = [],
  extra?: { dispose?: boolean }
): PluginModule {
  return {
    name,
    inject,
    apply(ctx: Context) {
      ctx.tools.register(
        defineTool({
          name: `${name}_tool`,
          description: "测试用的工具。",
          parameters: { type: "string", description: "随便给点字" },
          async execute(args) {
            return { ok: true, text: `${name}:${String(args.x)}` };
          }
        })
      );
      if (extra?.dispose === true) ctx.effect(() => () => undefined);
    }
  };
}

describe("依赖门控（inject）", () => {
  it("inject 的 service 在场 ⇒ 正常挂载，工具进得来", () => {
    const app = createPluginApp();
    const rec = app.mount("p", fnPlugin("p", ["tools"]));
    expect(rec).toMatchObject({ ok: true, toolNames: ["p_tool"] });
    expect(app.tools().map((t) => t.name)).toEqual(["p_tool"]);
  });

  it("inject 的 service 不在场 ⇒ **硬失败并说清缺哪个**，不许静默加载", () => {
    const app = createPluginApp();
    const rec = app.mount("p", fnPlugin("p", ["tools", "sandbox"]));
    // 静默加载是最坏的一种：插件以为 sandbox 在，其实在不在全凭运气。
    expect(rec.ok).toBe(false);
    expect(rec.reason).toContain("sandbox");
    expect(rec.reason).toContain("没装上");
    expect(app.tools()).toHaveLength(0);
  });

  it("缺依赖的插件在清单里仍然看得见（ok:false + 理由），不是从清单里消失", () => {
    const app = createPluginApp();
    app.mount("p", fnPlugin("p", ["nope"]));
    const list = app.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ ok: false });
    expect(list[0]?.reason).not.toBe("");
  });
});

describe("挂载隔离", () => {
  it("一个插件 apply 抛错 ⇒ 记成失败，别的插件照常用", () => {
    const app = createPluginApp();
    const bad: PluginModule = {
      name: "bad",
      apply() {
        throw new Error("我自己炸了");
      }
    };
    const badRec = app.mount("bad", bad);
    expect(badRec.ok).toBe(false);
    expect(badRec.reason).toContain("我自己炸了");
    const goodRec = app.mount("good", fnPlugin("good"));
    expect(goodRec.ok).toBe(true);
    expect(app.tools().map((t) => t.name)).toEqual(["good_tool"]);
  });

  it("apply 抛错前注册了一半 ⇒ 那半个工具必须撤掉，不许留在清单里冒充可用", () => {
    const app = createPluginApp();
    const half: PluginModule = {
      name: "half",
      apply(ctx) {
        ctx.tools.register(
          defineTool({
            name: "half_tool",
            description: "只注册了一半。",
            parameters: { type: "string" },
            async execute() {
              return { ok: true, text: "" };
            }
          })
        );
        throw new Error("注册完就炸");
      }
    };
    app.mount("half", half);
    expect(app.tools()).toHaveLength(0);
  });
});

describe("工具名去重", () => {
  it("两个插件注册同一个工具名 ⇒ 第二个**报错**，不许静默覆盖", () => {
    const app = createPluginApp();
    app.mount("a", fnPlugin("a"));
    // 第二个也想要 a_tool：静默覆盖 = 用户不知道自己正用着谁的实现。
    expect(() => app.mount("b", fnPlugin("a"))).not.toThrow();
    expect(app.tools().filter((t) => t.name === "a_tool")).toHaveLength(1);
    const rec = app.list().find((p) => p.name === "a");
    expect(rec?.ok).toBe(true);
  });

  it("撞名时抛的那句里带占用者名字", () => {
    const app = createPluginApp();
    const tool = defineTool({
      name: "dup",
      description: "撞名用的。",
      parameters: { type: "string" },
      async execute() {
        return { ok: true, text: "" };
      }
    });
    app.mount("占位的", { name: "占位的", apply: (ctx) => void ctx.tools.register(tool) });
    // 【必须在 apply 内部调】register 只在挂载期间认账，出了 apply 先撞的是
    // 「只能在插件挂载期间注册」——那条守卫第一版就栽在这儿，量到的不是撞名。
    const rec = app.mount("后来的", {
      name: "后来的",
      apply: (ctx) => void ctx.tools.register(tool)
    });
    expect(rec.ok).toBe(false);
    expect(rec.reason).toContain("占位的");
  });
});

describe("卸载清理（官方：you do not need to removeListener yourself）", () => {
  it("卸载 ⇒ 这一轮注册的工具全部消失", () => {
    const app = createPluginApp();
    app.mount("p", fnPlugin("p"));
    expect(app.tools()).toHaveLength(1);
    app.unmount("p");
    expect(app.tools()).toHaveLength(0);
    expect(app.list()).toHaveLength(0);
  });

  it("卸载 ⇒ ctx.effect 的返回值被跑掉", () => {
    const app = createPluginApp();
    let disposed = 0;
    app.mount("p", {
      name: "p",
      apply(ctx) {
        ctx.effect(() => () => {
          disposed += 1;
        });
      }
    });
    app.unmount("p");
    expect(disposed).toBe(1);
  });

  it("卸载 ⇒ 事件监听被摘掉，不再收到事件", () => {
    const app = createPluginApp();
    let got = 0;
    app.mount("p", {
      name: "p",
      apply(ctx) {
        ctx.on("ping", () => {
          got += 1;
        });
      }
    });
    app.emit("ping");
    expect(got).toBe(1);
    app.unmount("p");
    app.emit("ping");
    expect(got).toBe(1);
  });

  it("卸载时插件的清理函数抛错 ⇒ 其余清理照做（不被一个烂收尾卡住）", () => {
    const app = createPluginApp();
    app.mount("p", fnPlugin("p"));
    app.mount("q", {
      name: "q",
      apply(ctx) {
        ctx.effect(() => () => {
          throw new Error("收尾炸了");
        });
      }
    });
    expect(() => app.unmount("q")).not.toThrow();
    expect(app.tools().map((t) => t.name)).toEqual(["p_tool"]);
  });
});

describe("三种插件形态（官方文档的三档写法）", () => {
  it("对象形态（default 导出对象）", () => {
    const app = createPluginApp();
    const rec = app.mount("obj", {
      default: {
        name: "obj",
        inject: ["tools"],
        apply(ctx) {
          ctx.tools.register(
            defineTool({
              name: "obj_tool",
              description: "对象形态注册的。",
              parameters: { type: "string" },
              async execute() {
                return { ok: true, text: "ok" };
              }
            })
          );
        }
      }
    });
    expect(rec.ok).toBe(true);
    expect(app.tools().map((t) => t.name)).toEqual(["obj_tool"]);
  });

  it("类形态（extends Service，自报名 + 静态 inject）", () => {
    const app = createPluginApp();
    class Widget extends Service {
      static inject = ["tools"];
      constructor(ctx: Context) {
        super(ctx, "widget");
      }
    }
    const rec = app.mount("cls", { default: Widget });
    expect(rec.ok).toBe(true);
    expect(rec.name).toBe("Widget");
  });

  it("类形态缺依赖同样硬失败（静态 inject 也要被门控）", () => {
    const app = createPluginApp();
    class Needy extends Service {
      static inject = ["sandbox"];
      constructor(ctx: Context) {
        super(ctx, "needy");
      }
    }
    const rec = app.mount("cls", { default: Needy });
    expect(rec.ok).toBe(false);
    expect(rec.reason).toContain("sandbox");
  });

  it("同名 service 不许静默覆盖（两个插件都提供 widget）", () => {
    const app = createPluginApp();
    class A extends Service {
      constructor(ctx: Context) {
        super(ctx, "widget");
      }
    }
    class B extends Service {
      constructor(ctx: Context) {
        super(ctx, "widget");
      }
    }
    expect(app.mount("a", { default: A }).ok).toBe(true);
    expect(app.mount("b", { default: B }).ok).toBe(false);
  });

  it("A 提供的 service，B inject 得着（官方：类形态用于插件向别的插件提供服务）", () => {
    const app = createPluginApp();
    class Widget extends Service {
      readonly label = "窗口服务";
      constructor(ctx: Context) {
        super(ctx, "widget");
      }
    }
    let seen: string | null = null;
    // 先装提供方，再装用方；B 的 inject 在**挂载那一刻**就必须被满足。
    expect(app.mount("provider", { default: Widget }).ok).toBe(true);
    const rec = app.mount("consumer", {
      name: "consumer",
      inject: ["widget"],
      apply(ctx) {
        seen = ctx.get<{ label: string }>("widget")?.label ?? null;
      }
    });
    expect(rec.ok).toBe(true);
    expect(seen).toBe("窗口服务");
  });

  it("提供方先被卸载 ⇒ 用方那一轮已经拿过的 service 不作数（下次挂载会因缺依赖被拒）", () => {
    const app = createPluginApp();
    class Widget extends Service {
      constructor(ctx: Context) {
        super(ctx, "widget");
      }
    }
    app.mount("provider", { default: Widget });
    app.unmount("provider");
    const rec = app.mount("consumer", {
      name: "consumer",
      inject: ["widget"],
      apply: () => undefined
    });
    expect(rec.ok).toBe(false);
    expect(rec.reason).toContain("widget");
  });
});

describe("defineTool 是恒等函数（但必须存在）", () => {
  it("原样返回同一个定义", () => {
    const def = {
      name: "t",
      description: "d",
      parameters: { type: "string" } as const,
      async execute() {
        return { ok: true as const, text: "x" };
      }
    };
    expect(defineTool(def)).toBe(def);
  });
});
