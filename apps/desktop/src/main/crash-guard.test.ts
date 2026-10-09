import { describe, expect, it } from "vitest";
import { installCrashGuard, type CrashEvent, type CrashGuardDeps } from "./crash-guard.js";

/**
 * 进程级异常钩子（2026-10-09 全仓扫描 P0-6）。
 *
 * 修之前的样子：全仓 `uncaughtException` / `unhandledRejection` **零命中**，启动装配里任何一处抛
 * （目录迁移、credential store、插件挂载）⇒ 窗口永不出现、也永不报错，用户只会以为「双击没反应」。
 * 这里钉的是钩子本身该做的三件事：**留痕**（一行一条，含栈）、**说给人听**（只说第一次）、
 * **自己不许再抛**（记录失败把进程带下去，等于把故障升级成消失）。
 */
function makeDeps(overrides: Partial<CrashGuardDeps> = {}) {
  const lines: string[] = [];
  const notices: { title: string; detail: string }[] = [];
  const handlers = new Map<CrashEvent, (arg: unknown) => void>();
  const deps: CrashGuardDeps = {
    on: (event, handler) => {
      handlers.set(event, handler);
    },
    appendLine: (line) => {
      lines.push(line);
    },
    notify: (title, detail) => {
      notices.push({ title, detail });
    },
    now: () => "2026-10-09T12:00:00.000Z",
    ...overrides
  };
  return {
    deps,
    lines,
    notices,
    handlers,
    fire: (event: CrashEvent, arg: unknown) => handlers.get(event)?.(arg)
  };
}

describe("installCrashGuard", () => {
  it("两条通道都挂上：uncaughtException 与 unhandledRejection 缺一漏一半", () => {
    const { deps, handlers } = makeDeps();
    installCrashGuard(deps);
    expect([...handlers.keys()].sort()).toEqual(["uncaughtException", "unhandledRejection"]);
  });

  it("崩一次留一行：时间戳、通道名、错误消息与栈都在这行里", () => {
    const { deps, lines, fire } = makeDeps();
    installCrashGuard(deps);
    const err = new Error("EPERM: rename 被拦下");
    err.stack = "Error: EPERM: rename 被拦下\n    at book-service.ts:12";
    fire("uncaughtException", err);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("2026-10-09T12:00:00.000Z");
    expect(lines[0]).toContain("uncaughtException");
    expect(lines[0]).toContain("EPERM: rename 被拦下");
    expect(lines[0]).toContain("book-service.ts:12");
  });

  it("抛出来的不是 Error（字符串、undefined、对象都遇到过）＝照样落成人话，不许出现 undefined", () => {
    const { deps, lines, fire } = makeDeps();
    installCrashGuard(deps);
    fire("unhandledRejection", "磁盘忙");
    fire("uncaughtException", undefined);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("磁盘忙");
    expect(lines[1]).not.toContain("undefined: undefined");
    expect(lines[1]).toContain("uncaughtException");
  });

  it("通知只发第一次：连续崩十次不许弹十个框，但十行日志一行都不许少", () => {
    const { deps, lines, notices, fire } = makeDeps();
    installCrashGuard(deps);
    for (let i = 0; i < 10; i += 1) fire("uncaughtException", new Error(`第 ${i} 次`));
    expect(lines).toHaveLength(10);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.detail).toContain("第 0 次");
  });

  it("写日志自己抛错＝绝不再抛出去：记录失败把进程带下去，等于把故障升级成无声消失", () => {
    const { deps, notices, fire } = makeDeps({
      appendLine: () => {
        throw new Error("EBUSY: crash.log 被占用");
      }
    });
    installCrashGuard(deps);
    expect(() => fire("uncaughtException", new Error("原来那次崩"))).not.toThrow();
    // 盘上留不了痕，至少还得把话递到人面前。
    expect(notices).toHaveLength(1);
  });
});
