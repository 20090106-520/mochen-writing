import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@mochen/contracts";
import { buildTimeline, TOOL_LABELS } from "./timeline";

function event(type: AgentEvent["type"], rest: Record<string, unknown> = {}): AgentEvent {
  return {
    id: `e-${type}`,
    ts: "2026-10-01T00:00:00.000Z",
    turnId: "t1",
    type,
    ...rest
  } as AgentEvent;
}

const NO_TAIL = { reasoning: "", message: "" };

describe("buildTimeline", () => {
  it("用户消息单独一层，排在最前", () => {
    const blocks = buildTimeline([event("user-message", { text: "把这段改得有雾气" })], NO_TAIL);
    expect(blocks).toEqual([{ kind: "user", id: "e-user-message", text: "把这段改得有雾气" }]);
  });

  it("思考与正文按到达顺序成层，打断标记保留", () => {
    const blocks = buildTimeline(
      [
        event("reasoning", { text: "先读前后文", interrupted: false }),
        event("message", { text: "海雾涌上来。", interrupted: true })
      ],
      NO_TAIL
    );
    expect(blocks.map((block) => block.kind)).toEqual(["thinking", "message"]);
    expect(blocks[1]).toMatchObject({ text: "海雾涌上来。", interrupted: true, streaming: false });
  });

  it("提案/裁决/写入不进时间线——它们只活在提案卡上", () => {
    const blocks = buildTimeline(
      [
        event("proposal", { proposal: {} }),
        event("decision", { proposalId: "p1", decision: "accept-once", guidance: "", auto: false }),
        event("written", {
          proposalId: "p1",
          docRelPath: "a.md",
          fingerprint: "fp",
          backupRelPath: null
        })
      ],
      NO_TAIL
    );
    expect(blocks).toEqual([]);
  });

  it("连续 plan 事件合并成一块，以最后一份清单为准", () => {
    const blocks = buildTimeline(
      [
        event("plan", { items: [{ text: "读上下文", done: true }] }),
        event("plan", {
          items: [
            { text: "读上下文", done: true },
            { text: "改第三段", done: false }
          ]
        })
      ],
      NO_TAIL
    );
    expect(blocks.length).toBe(1);
    expect(blocks[0]).toMatchObject({
      kind: "plan",
      items: [
        { text: "读上下文", done: true },
        { text: "改第三段", done: false }
      ]
    });
  });

  it("plan 被正文隔开后不再合并，两份清单各自成块", () => {
    const blocks = buildTimeline(
      [
        event("plan", { items: [{ text: "甲", done: false }] }),
        event("message", { text: "先说一句", interrupted: false }),
        event("plan", { items: [{ text: "乙", done: false }] })
      ],
      NO_TAIL
    );
    expect(blocks.map((block) => block.kind)).toEqual(["plan", "message", "plan"]);
  });

  it("工具调用成卡：中文名、入参、失败也保留结果文本", () => {
    const blocks = buildTimeline(
      [
        event("tool-call", {
          callId: "c1",
          tool: "search_docs",
          args: '{"query":"雾"}',
          ok: false,
          resultText: "锚点不唯一"
        })
      ],
      NO_TAIL
    );
    expect(blocks[0]).toEqual({
      kind: "tool",
      id: "e-tool-call",
      label: TOOL_LABELS.search_docs,
      args: '{"query":"雾"}',
      ok: false,
      resultText: "锚点不唯一"
    });
    expect(TOOL_LABELS.search_docs).toBe("全书检索");
  });

  it("未知工具名退回原始名：IPC 闸门不校验 tool，标签不许是 undefined", () => {
    const blocks = buildTimeline(
      [
        event("tool-call", {
          callId: "c9",
          tool: "delete_everything",
          args: "{}",
          ok: true,
          resultText: ""
        })
      ],
      NO_TAIL
    );
    expect(blocks[0]).toMatchObject({ kind: "tool", label: "delete_everything" });
  });

  it("错误与打断各自成块，打断块带待审计数", () => {
    const blocks = buildTimeline(
      [
        event("error", { message: "模型服务端返回 503：繁忙" }),
        event("interrupted", { pendingProposals: 2 })
      ],
      NO_TAIL
    );
    expect(blocks[0]).toEqual({ kind: "error", id: "e-error", text: "模型服务端返回 503：繁忙" });
    expect(blocks[1]).toEqual({ kind: "interrupted", id: "e-interrupted", pending: 2 });
  });

  it("流式残字只在非空时出现，且永远排在末尾", () => {
    const blocks = buildTimeline([event("message", { text: "定稿", interrupted: false })], {
      reasoning: "   ",
      message: "正在写"
    });
    expect(blocks.map((block) => block.kind)).toEqual(["message", "message"]);
    expect(blocks[1]).toMatchObject({ streaming: true, text: "正在写" });
    expect(buildTimeline([], { reasoning: "在想", message: "" })).toEqual([
      { kind: "thinking", id: "tail-thinking", text: "在想", streaming: true, interrupted: false }
    ]);
  });

  it("块 id 不重复：v-for 的 key 撞车就是渲染错位", () => {
    const blocks = buildTimeline(
      [
        event("user-message", { text: "甲" }),
        event("reasoning", { text: "乙", interrupted: false }),
        event("tool-call", { callId: "c1", tool: "read_doc", args: "{}", ok: true, resultText: "" })
      ],
      { reasoning: "丙", message: "丁" }
    );
    expect(new Set(blocks.map((block) => block.id)).size).toBe(blocks.length);
  });
});
