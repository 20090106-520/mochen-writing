/**
 * 插件叠加工具表的守卫（2026-10-07 批次 5-㉘）。
 *
 * 【这一层为什么单独钉】它是「插件的工具真能叫得动」这条路的最后一道接缝：
 * agent-service 只负责把 base host 递进来，派发方向全在这里判。
 * 方向判反的症状极隐蔽——插件工具永远不被调（本轮工具白转），
 * 而所有单测照样绿。
 */
import { describe, expect, it } from "vitest";
import type { ToolHost, ToolOutcome } from "@mochen/agent-runtime";
import { withPlugins } from "./plugin-host.js";

function baseHost(): ToolHost & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    context: () => ({ docRelPath: null, permissionMode: "read-only", workMode: "act" }),
    async call(name) {
      calls.push(name);
      return { ok: true, text: `base:${name}`, proposals: [] } satisfies ToolOutcome;
    }
  };
}

const plugin = (tools: string[]) => ({
  extraSpecs: () =>
    tools.map((name) => ({
      name,
      description: "插件给的。",
      parameters: { type: "object", properties: {} }
    })),
  has: (name: string) => tools.includes(name),
  call: async (name: string) => ({ ok: true, text: `plugin:${name}`, proposals: [] }) as ToolOutcome
});

describe("withPlugins", () => {
  it("没有插件 ⇒ 原样返回那一个 host（一个字段都不重写）", () => {
    const base = baseHost();
    expect(withPlugins(base, undefined)).toBe(base);
  });

  it("花名册那些仍走 base；插件的那些走插件", async () => {
    const base = baseHost();
    const host = withPlugins(base, plugin(["rhythm_check"]));
    expect((await host.call("read_doc", {})).text).toBe("base:read_doc");
    expect((await host.call("rhythm_check", {})).text).toBe("plugin:rhythm_check");
    expect(base.calls).toEqual(["read_doc"]);
  });

  it("插件规格原样透出（不多不少）", () => {
    const host = withPlugins(baseHost(), plugin(["a_tool", "b_tool"]));
    expect(host.extraSpecs?.().map((s) => s.name)).toEqual(["a_tool", "b_tool"]);
  });

  it("context 透传的是 base 那一个（插件不该另造一份会话上下文）", () => {
    const host = withPlugins(baseHost(), plugin(["x"]));
    expect(host.context()).toEqual({
      docRelPath: null,
      permissionMode: "read-only",
      workMode: "act"
    });
  });

  it("base 抛错不许被吞成 ok：这一层不碰结果，只管派发方向", async () => {
    const base: ToolHost = {
      context: () => ({ docRelPath: null, permissionMode: "read-only", workMode: "act" }),
      call: async () => {
        throw new Error("base 自己炸了");
      }
    };
    const host = withPlugins(base, plugin(["x"]));
    await expect(host.call("read_doc", {})).rejects.toThrow("base 自己炸了");
  });
});
