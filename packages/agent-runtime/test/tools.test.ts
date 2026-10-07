import { describe, expect, it } from "vitest";
import { AGENT_TOOL_NAMES, type EditProposal } from "@mochen/contracts";
import {
  TOOL_SPECS,
  dispatchToolCall,
  toolNameOf,
  type ToolHost,
  type ToolOutcome
} from "../src/tools.js";

function fakeHost(
  log: { name: string; args: Record<string, unknown> }[],
  outcome: ToolOutcome
): ToolHost {
  return {
    context: () => ({ docRelPath: "chapters/01.md", permissionMode: "read-only", workMode: "act" }),
    call: async (name, args) => {
      log.push({ name, args });
      return outcome;
    }
  };
}

describe("TOOL_SPECS", () => {
  it("恰好五个工具，与 AGENT_TOOL_NAMES 一一对应（§5.1 约束 2 的机器关卡）", () => {
    expect(TOOL_SPECS.map((spec) => spec.name).sort()).toEqual([...AGENT_TOOL_NAMES].sort());
    for (const spec of TOOL_SPECS) {
      expect(spec.description.length).toBeGreaterThan(0);
      expect(spec.parameters.type).toBe("object");
    }
  });

  it("未知工具名返回 null，已知返回自身", () => {
    expect(toolNameOf("read_doc")).toBe("read_doc");
    expect(toolNameOf("rm_rf")).toBeNull();
  });
});

describe("dispatchToolCall", () => {
  it("参数是合法 JSON 时把解析结果交给 host", async () => {
    const log: { name: string; args: Record<string, unknown> }[] = [];
    const outcome = { ok: true, text: "正文", proposals: [] as EditProposal[] };
    const out = await dispatchToolCall(fakeHost(log, outcome), {
      id: "c1",
      name: "read_doc",
      args: '{"doc":"chapters/01.md"}'
    });
    expect(log).toEqual([{ name: "read_doc", args: { doc: "chapters/01.md" } }]);
    expect(out).toBe(outcome);
  });

  it("参数不是合法 JSON 时把中文回执回喂模型，不抛错（§6 不静默丢弃）", async () => {
    const log: { name: string; args: Record<string, unknown> }[] = [];
    const out = await dispatchToolCall(fakeHost(log, { ok: true, text: "", proposals: [] }), {
      id: "c1",
      name: "read_doc",
      args: '{"doc": 缺引号}'
    });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("不是合法 JSON");
    expect(log).toEqual([]);
  });

  it("host 不认识的第六个工具名被拦在派发层", async () => {
    const out = await dispatchToolCall(
      {
        context: () => ({ docRelPath: null, permissionMode: "read-only", workMode: "act" }),
        call: async () => ({ ok: true, text: "", proposals: [] })
      },
      { id: "c1", name: "delete_book", args: "{}" }
    );
    expect(out.ok).toBe(false);
    expect(out.text).toContain("delete_book");
    expect(out.text).toContain("read_doc");
  });

  it("参数是合法 JSON 但不是对象（数组或 null）时同样回喂中文，不调用 host", async () => {
    for (const args of ["[1,2]", '"just a string"', "null"]) {
      const log: { name: string; args: Record<string, unknown> }[] = [];
      const out = await dispatchToolCall(fakeHost(log, { ok: true, text: "", proposals: [] }), {
        id: "c1",
        name: "list_docs",
        args
      });
      expect(out.ok).toBe(false);
      expect(out.text).toContain("必须是对象");
      expect(log).toEqual([]);
    }
  });

  it("模型省略参数（空串）时按空对象派发，read-only 档不受派发层影响", async () => {
    const log: { name: string; args: Record<string, unknown> }[] = [];
    const outcome = { ok: true, text: "书名稿清单", proposals: [] as EditProposal[] };
    const out = await dispatchToolCall(fakeHost(log, outcome), {
      id: "c2",
      name: "list_docs",
      args: ""
    });
    expect(log).toEqual([{ name: "list_docs", args: {} }]);
    expect(out).toBe(outcome);
  });

  it("【改钉新决定】host 收到的是 string；花名册那五个仍被逐个校验过", async () => {
    const seen: string[] = [];
    const host: ToolHost = {
      context: () => ({ docRelPath: null, permissionMode: "full-access", workMode: "act" }),
      extraSpecs: () => [
        {
          name: "rhythm_check",
          description: "插件给的工具。",
          parameters: { type: "object", properties: { text: { type: "string" } } }
        }
      ],
      call: async (name, args) => {
        seen.push(name);
        expect(args).toEqual({});
        return { ok: true, text: "", proposals: [] };
      }
    };
    // 花名册里的：名字仍然是闭集里的那一个。
    await dispatchToolCall(host, { id: "1", name: "read_doc", args: "" });
    expect(seen).toEqual(["read_doc"]);
    // 插件注册的：放行。
    await dispatchToolCall(host, { id: "2", name: "rhythm_check", args: "" });
    expect(seen).toEqual(["read_doc", "rhythm_check"]);
    // 没人注册过的：仍然被中文拒掉——闸没松，只是闸后名单从 5 个变成 5+N 个。
    const denied = await dispatchToolCall(host, { id: "3", name: "rm_rf", args: "" });
    expect(denied.ok).toBe(false);
    expect(denied.text).toContain("rm_rf");
    expect(seen).toHaveLength(2);
  });
});
