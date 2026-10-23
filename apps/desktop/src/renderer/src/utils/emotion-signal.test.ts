import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@mochen/contracts";
import { assistantEmotion, type AssistantEmotionInput } from "./emotion-signal";

function base(overrides: Partial<AssistantEmotionInput> = {}): AssistantEmotionInput {
  return {
    running: false,
    items: [],
    tail: { reasoning: "", message: "" },
    endedAs: "",
    lastError: "",
    pendingProposals: 0,
    hydrating: false,
    ...overrides
  };
}

function toolCall(tool: string, sources: { title: string; url: string }[] = []): AgentEvent {
  return {
    type: "tool-call",
    tool,
    sources,
    ok: true,
    empty: false
  } as unknown as AgentEvent;
}

describe("助手头像的状态判定", () => {
  it("没有轮次、没有错误、没有待审卡 = 待机", () => {
    expect(assistantEmotion(base())).toBe("02");
  });

  it("刚发出、还没有任何产出 = 接收任务", () => {
    expect(assistantEmotion(base({ running: true }))).toBe("31");
  });

  it("推理流先到 = 思考中", () => {
    expect(
      assistantEmotion(base({ running: true, tail: { reasoning: "先看", message: "" } }))
    ).toBe("30");
  });

  it("正文流一到就接管：哪怕还有别的信号也画「输出回复」", () => {
    expect(
      assistantEmotion(
        base({
          running: true,
          items: [toolCall("web_search", [{ title: "t", url: "https://x" }])],
          tail: { reasoning: "", message: "第一章" }
        })
      )
    ).toBe("39");
  });

  it("普通工具在跑 = 忙碌", () => {
    expect(assistantEmotion(base({ running: true, items: [toolCall("read_file")] }))).toBe("32");
  });

  it("联网工具：还没拿到来源 = 联网中，拿到来源 = 检索资料", () => {
    expect(assistantEmotion(base({ running: true, items: [toolCall("web_search")] }))).toBe("36");
    expect(
      assistantEmotion(
        base({
          running: true,
          items: [toolCall("web_read", [{ title: "t", url: "https://x" }])]
        })
      )
    ).toBe("40");
  });

  it("错误压过一切：普通错误 = 出错，明确的拒绝/受限 = 拒绝", () => {
    expect(assistantEmotion(base({ running: true, lastError: "连接超时" }))).toBe("34");
    expect(assistantEmotion(base({ lastError: "权限不足：403 Forbidden" }))).toBe("38");
  });

  it("已打断 = 停止终止（终止态优先于 running）", () => {
    expect(assistantEmotion(base({ running: true, endedAs: "interrupted" }))).toBe("41");
  });

  it("收场：完成 = 任务完成，失败 = 出错", () => {
    expect(assistantEmotion(base({ endedAs: "done" }))).toBe("33");
    expect(assistantEmotion(base({ endedAs: "failed" }))).toBe("34");
  });

  it("还有提案在等审批时，「完成」要让位给「等待输入」", () => {
    expect(assistantEmotion(base({ endedAs: "done", pendingProposals: 2 }))).toBe("35");
  });

  it("恢复历史线程 = 复述回忆", () => {
    expect(assistantEmotion(base({ hydrating: true }))).toBe("37");
  });
});
