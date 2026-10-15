import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@mochen/contracts";
import { sessionUsageText, turnUsageText } from "./token-usage";

const TS = "2026-10-01T08:00:00.000Z";

function userMsg(id: string): AgentEvent {
  return { id, ts: TS, turnId: id, type: "user-message", text: "把开头改紧" };
}

/** 一条「上游报了这一轮用量」的事件（requests=reported=1 是常见形态）。 */
function usage(
  id: string,
  promptTokens: number,
  completionTokens: number,
  totalTokens: number
): AgentEvent {
  return {
    id,
    ts: TS,
    turnId: id,
    type: "usage",
    requests: 1,
    reported: 1,
    promptTokens,
    completionTokens,
    totalTokens
  };
}

describe("turnUsageText（2026-10-15）", () => {
  it("全报：输入/输出/合计三枚都精确千分位，不写「约」", () => {
    expect(
      turnUsageText({
        requests: 1,
        reported: 1,
        promptTokens: 12345,
        completionTokens: 678,
        totalTokens: 13023
      })
    ).toBe("本轮用量：输入 12,345 · 输出 678 · 合计 13,023 Token");
  });

  it("部分报：追加一句「几次请求里有几次上游没回报」，不是估算", () => {
    expect(
      turnUsageText({
        requests: 3,
        reported: 2,
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120
      })
    ).toBe(
      "本轮用量：输入 100 · 输出 20 · 合计 120 Token（这轮共 3 次请求，其中 1 次上游没回报用量）"
    );
  });

  it("四位以上数字照样千分位（三枚各自格式化）", () => {
    expect(
      turnUsageText({
        requests: 1,
        reported: 1,
        promptTokens: 1000000,
        completionTokens: 2048,
        totalTokens: 1002048
      })
    ).toBe("本轮用量：输入 1,000,000 · 输出 2,048 · 合计 1,002,048 Token");
  });
});

describe("sessionUsageText（2026-10-15）", () => {
  it("既无提问也无回报：回空串（调用方跳过这一行，不硬凑）", () => {
    expect(sessionUsageText([])).toBe("");
  });

  it("有提问但一次都没报 ⇒ 明说「还没回报过」，绝不拿 0 Token 冒充", () => {
    expect(sessionUsageText([userMsg("u1"), userMsg("u2")])).toBe(
      "用量：还没有上游回报过（本会话 2 轮都没报）。"
    );
  });

  it("有回顾：N 轮里 M 轮有上游回报 + 三枚精确千分位", () => {
    expect(
      sessionUsageText([
        userMsg("u1"),
        usage("s1", 100, 20, 120),
        userMsg("u2"),
        usage("s2", 200, 40, 240)
      ])
    ).toBe("用量：2 轮里 2 轮有上游回报，输入 300 · 输出 60 · 合计 360 Token");
  });

  it("回报数只数 usage 事件、轮数只数 user-message，两者各自独立", () => {
    // 提问 2 轮、却只有 1 轮回报 → N=2、M=1。
    expect(sessionUsageText([userMsg("u1"), userMsg("u2"), usage("s1", 5, 5, 10)])).toBe(
      "用量：2 轮里 1 轮有上游回报，输入 5 · 输出 5 · 合计 10 Token"
    );
  });
});
