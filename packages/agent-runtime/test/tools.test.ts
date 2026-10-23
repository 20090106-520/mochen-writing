import { describe, expect, it } from "vitest";
import { AGENT_TOOL_NAMES, type EditProposal } from "@mochen/contracts";
import { wireToolsFor } from "../src/per-run-fields.js";
import {
  TOOL_SPECS,
  dispatchToolCall,
  isCallableTool,
  toolGateOf,
  toolNameOf,
  toolsFor,
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

describe("工具面板逐枚关掉（2026-10-21）", () => {
  const host = fakeHost([], { ok: true, text: "", proposals: [] });

  it("关掉的工具不在本轮清单里，但仍在花名册里——所以拒绝理由是「你关掉的」而不是「不存在」", () => {
    const names = toolsFor(host, false, ["read_doc"]).map((spec) => spec.name);
    expect(names).not.toContain("read_doc");
    expect(names).toContain("list_docs");

    const gate = toolGateOf(host, "read_doc", false, ["read_doc"]);
    expect(gate.allowed).toBe(false);
    expect(gate).toMatchObject({ kind: "off-this-round" });
    if (!gate.allowed) expect(gate.reason).toContain("工具面板里把「read_doc」关掉了");
    expect(isCallableTool(host, "read_doc", false, ["read_doc"])).toBe(false);
  });

  it("不关的时候一切照旧：五枚都在，read_doc 叫得动", () => {
    expect(toolsFor(host, false)).toHaveLength(TOOL_SPECS.length - 2);
    expect(toolsFor(host, true)).toHaveLength(TOOL_SPECS.length);
    expect(isCallableTool(host, "read_doc", false)).toBe(true);
  });

  it("联网关着且没在面板里关它时，理由仍是「联网开关关闭」，不冒充用户关的", () => {
    const gate = toolGateOf(host, "web_search", false);
    expect(gate).toMatchObject({ kind: "off-this-round" });
    if (!gate.allowed) expect(gate.reason).toContain("联网开关是关闭的");
  });
});

describe("dispatchToolCall", () => {
  it("参数是合法 JSON 时把解析结果交给 host", async () => {
    const log: { name: string; args: Record<string, unknown> }[] = [];
    const outcome = { ok: true, text: "正文", proposals: [] as EditProposal[] };
    const out = await dispatchToolCall(
      fakeHost(log, outcome),
      {
        id: "c1",
        name: "read_doc",
        args: '{"doc":"chapters/01.md"}'
      },
      false
    );
    expect(log).toEqual([{ name: "read_doc", args: { doc: "chapters/01.md" } }]);
    expect(out).toBe(outcome);
  });

  it("参数不是合法 JSON 时把中文回执回喂模型，不抛错（§6 不静默丢弃）", async () => {
    const log: { name: string; args: Record<string, unknown> }[] = [];
    const out = await dispatchToolCall(
      fakeHost(log, { ok: true, text: "", proposals: [] }),
      {
        id: "c1",
        name: "read_doc",
        args: '{"doc": 缺引号}'
      },
      false
    );
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
      { id: "c1", name: "delete_book", args: "{}" },
      false
    );
    expect(out.ok).toBe(false);
    expect(out.text).toContain("delete_book");
    expect(out.text).toContain("read_doc");
  });

  it("参数是合法 JSON 但不是对象（数组或 null）时同样回喂中文，不调用 host", async () => {
    for (const args of ["[1,2]", '"just a string"', "null"]) {
      const log: { name: string; args: Record<string, unknown> }[] = [];
      const out = await dispatchToolCall(
        fakeHost(log, { ok: true, text: "", proposals: [] }),
        {
          id: "c1",
          name: "list_docs",
          args
        },
        false
      );
      expect(out.ok).toBe(false);
      expect(out.text).toContain("必须是对象");
      expect(log).toEqual([]);
    }
  });

  it("模型省略参数（空串）时按空对象派发，read-only 档不受派发层影响", async () => {
    const log: { name: string; args: Record<string, unknown> }[] = [];
    const outcome = { ok: true, text: "书名稿清单", proposals: [] as EditProposal[] };
    const out = await dispatchToolCall(
      fakeHost(log, outcome),
      {
        id: "c2",
        name: "list_docs",
        args: ""
      },
      false
    );
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
    await dispatchToolCall(host, { id: "1", name: "read_doc", args: "" }, false);
    expect(seen).toEqual(["read_doc"]);
    // 插件注册的：放行。
    await dispatchToolCall(host, { id: "2", name: "rhythm_check", args: "" }, false);
    expect(seen).toEqual(["read_doc", "rhythm_check"]);
    // 没人注册过的：仍然被中文拒掉——闸没松，只是闸后名单从 5 个变成 5+N 个。
    const denied = await dispatchToolCall(host, { id: "3", name: "rm_rf", args: "" }, false);
    expect(denied.ok).toBe(false);
    expect(denied.text).toContain("rm_rf");
    expect(seen).toHaveLength(2);
  });
});

/**
 * P1-2：联网开关只门控出站清单、不门控执行。
 * 关掉联网后模型只要**仿历史里那条 web_search** 调一次，派发层原先静态放行、照样真出网。
 * 修法口径是「清单与执行用同一份判据」，所以这一组的验收点全在派发那一层，
 * 而不是去看 body 里的 tools 数组（那一半早就有 agent-service-boundary 的出站用例钉着）。
 */
describe("本轮工具面（P1-2：清单与执行同一份判据）", () => {
  const webCall = { id: "c1", name: "web_search", args: '{"query":"雾 写法"}' } as const;
  const searched: ToolOutcome = { ok: true, text: "搜到了三条", proposals: [] };

  it("关掉联网：web_search 在派发这一层就叫不动，host 一个字都没被调用（= 没出网）", async () => {
    const log: { name: string; args: Record<string, unknown> }[] = [];
    const out = await dispatchToolCall(fakeHost(log, searched), webCall, false);
    expect(log).toEqual([]);
    expect(out.ok).toBe(false);
    expect(out.text).toContain("联网");
    expect(out.text).toContain("web_search");
  });

  it("开着联网：同一枚工具照常派发到 host（闸只关该关的，不是把工具摘了）", async () => {
    const log: { name: string; args: Record<string, unknown> }[] = [];
    const out = await dispatchToolCall(fakeHost(log, searched), webCall, true);
    expect(log).toEqual([{ name: "web_search", args: { query: "雾 写法" } }]);
    expect(out.ok).toBe(true);
  });

  it("关闭那一轮摘掉两枚出网工具：其余五枚照常叫得动", () => {
    const host = fakeHost([], searched);
    for (const name of ["read_doc", "list_docs", "search_docs", "propose_patch", "write_doc"])
      expect(isCallableTool(host, name, false)).toBe(true);
    expect(isCallableTool(host, "web_search", false)).toBe(false);
    expect(isCallableTool(host, "web_search", true)).toBe(true);
    // web_read 与 web_search 同一类（NETWORK_TOOL_NAMES）：关联网两枚一起叫不动。
    expect(isCallableTool(host, "web_read", false)).toBe(false);
    expect(isCallableTool(host, "web_read", true)).toBe(true);
  });

  it("插件工具不归联网开关管：它不在花名册上，关掉联网照样叫得动", async () => {
    const seen: string[] = [];
    const host: ToolHost = {
      context: () => ({ docRelPath: null, permissionMode: "read-only", workMode: "act" }),
      extraSpecs: () => [
        { name: "rhythm_check", description: "插件工具。", parameters: { type: "object" } }
      ],
      call: async (name) => {
        seen.push(name);
        return { ok: true, text: "", proposals: [] };
      }
    };
    expect(isCallableTool(host, "rhythm_check", false)).toBe(true);
    await dispatchToolCall(host, { id: "1", name: "rhythm_check", args: "{}" }, false);
    expect(seen).toEqual(["rhythm_check"]);
  });

  it("拒绝那句中文不许承诺本轮没有的东西：名单里不再列出 web_search", async () => {
    const out = await dispatchToolCall(
      fakeHost([], searched),
      { id: "c1", name: "delete_book", args: "{}" },
      false
    );
    const tail = out.text.slice(out.text.indexOf("可用工具只有"));
    expect(tail).not.toContain("web_search");
    expect(tail).toContain("read_doc");
  });

  it("派发判据就是出站那份映射，不是第二次判断：开关两态逐枚对照，看得见 ⇔ 叫得动", () => {
    const host = fakeHost([], searched);
    for (const enabled of [true, false]) {
      // 出站那一份的**真身**（provider-client 拼 body 时调的就是它，一模一样两份输入）。
      const outbound = wireToolsFor(TOOL_SPECS, enabled).map((spec) => spec.name);
      for (const name of [...AGENT_TOOL_NAMES])
        expect(isCallableTool(host, name, enabled)).toBe(outbound.includes(name));
    }
  });
});
