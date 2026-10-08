/**
 * 空窗期判据与文案的单测（批次 5-㊹）。
 *
 * 判据这一族最容易出的错是「**该关的时候没关**」：多挂一行「正在想」比不挂更糟
 * （用户会以为上一轮还在跑，或者以为重复发了）。所以这里一半的用例都在钉「关」的那几支。
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@mochen/contracts";
import {
  ELAPSED_SHOW_AFTER_MS,
  PATIENCE_LABEL_AFTER_MS,
  thinkingWindowElapsedText,
  thinkingWindowLabel,
  thinkingWindowState,
  THINKING_LIVE_LABEL
} from "./thinking-window";
import type { StreamingTail } from "./timeline";

const EMPTY_TAIL: StreamingTail = { reasoning: "", message: "" };

function event(type: string, turnId: string, extra: Record<string, unknown> = {}): AgentEvent {
  return {
    id: `${type}-${turnId}-${Math.random().toString(36).slice(2, 8)}`,
    ts: "2026-10-08T00:00:00.000Z",
    turnId,
    type,
    ...extra
  } as unknown as AgentEvent;
}

describe("thinkingWindowState", () => {
  it("本轮刚发出、还没有任何产出 ⇒ 开", () => {
    const items = [event("user-message", "t1", { text: "第三幕怎么写" })];
    expect(thinkingWindowState({ running: true, items, tail: EMPTY_TAIL })).toEqual({
      open: true,
      turnId: "t1"
    });
  });

  it("没在跑 ⇒ 关（哪怕时间线是空的）", () => {
    expect(thinkingWindowState({ running: false, items: [], tail: EMPTY_TAIL })).toEqual({
      open: false,
      turnId: null
    });
  });

  it("本轮已经有思考块 ⇒ 关（那张 .thinking-card 自己接管）", () => {
    const items = [
      event("user-message", "t1", { text: "q" }),
      event("reasoning", "t1", { text: "先看第三幕要交代什么", interrupted: false })
    ];
    expect(thinkingWindowState({ running: true, items, tail: EMPTY_TAIL }).open).toBe(false);
  });

  it("本轮已经有计划/工具/正文 ⇒ 关（四类都算助手侧产出）", () => {
    for (const type of ["plan", "tool-call", "message"]) {
      const extra =
        type === "plan"
          ? { items: [{ text: "列三个走向", done: false }] }
          : type === "tool-call"
            ? { tool: "web_search", args: {}, ok: true, resultText: "" }
            : { text: "先这样", interrupted: false };
      const items = [event("user-message", "t1", { text: "q" }), event(type, "t1", extra)];
      expect(thinkingWindowState({ running: true, items, tail: EMPTY_TAIL }).open, type).toBe(
        false
      );
    }
  });

  it("tail 已经在流式 ⇒ 关（正在被流式卡接管）", () => {
    const items = [event("user-message", "t1", { text: "q" })];
    expect(
      thinkingWindowState({ running: true, items, tail: { reasoning: "在想第三幕", message: "" } })
        .open
    ).toBe(false);
    expect(
      thinkingWindowState({ running: true, items, tail: { reasoning: "", message: "第三幕" } }).open
    ).toBe(false);
  });

  it("tail 里只有空白 ⇒ 仍算没有产出（trim 之后判，不是判空串）", () => {
    const items = [event("user-message", "t1", { text: "q" })];
    expect(
      thinkingWindowState({ running: true, items, tail: { reasoning: "   \n ", message: "" } }).open
    ).toBe(true);
  });

  it("第二轮：上一轮的满屏内容不许让这一轮的窗口开不出来（当前轮从最后一条用户消息认起）", () => {
    const items = [
      event("user-message", "t1", { text: "第一问" }),
      event("message", "t1", { text: "第一答", interrupted: false }),
      event("user-message", "t2", { text: "第二问" })
    ];
    expect(thinkingWindowState({ running: true, items, tail: EMPTY_TAIL })).toEqual({
      open: true,
      turnId: "t2"
    });
  });

  it("当前轮已有产出而上一轮没有 ⇒ 关（认的是当前轮，不是「有没有产出」这件事本身）", () => {
    const items = [
      event("user-message", "t1", { text: "第一问" }),
      event("user-message", "t2", { text: "第二问" }),
      event("reasoning", "t2", { text: "在核对", interrupted: false })
    ];
    expect(thinkingWindowState({ running: true, items, tail: EMPTY_TAIL }).open).toBe(false);
  });

  it("只有用户消息、压根没有助手事件 ⇒ 开；一条用户消息都没有 ⇒ 关（认不出当前轮就不硬开）", () => {
    expect(thinkingWindowState({ running: true, items: [], tail: EMPTY_TAIL })).toEqual({
      open: false,
      turnId: null
    });
    expect(
      thinkingWindowState({
        running: true,
        items: [event("error", "t1", { message: "炸了" })],
        tail: EMPTY_TAIL
      }).open,
      "只有一条错误事件时认不出当前轮，不许硬开一块正在想"
    ).toBe(false);
  });
});

describe("文案", () => {
  it("等得久了换一句承认等待的话", () => {
    expect(thinkingWindowLabel(0)).toBe(THINKING_LIVE_LABEL);
    expect(thinkingWindowLabel(PATIENCE_LABEL_AFTER_MS - 1)).toBe(THINKING_LIVE_LABEL);
    expect(thinkingWindowLabel(PATIENCE_LABEL_AFTER_MS)).toBe("还在想");
    expect(thinkingWindowLabel(30_000)).toBe("还在想");
  });

  it("「正在想」与流式思考卡上那枚徽标是同一句话（同一状态不许两种措辞）", () => {
    expect(THINKING_LIVE_LABEL).toBe("正在想");
    expect(thinkingWindowLabel(0)).toBe(THINKING_LIVE_LABEL);
  });

  it("秒数取整且至少 1（不到一秒不许显示 0 秒）", () => {
    expect(thinkingWindowElapsedText(0)).toBe("1 秒");
    expect(thinkingWindowElapsedText(999)).toBe("1 秒");
    expect(thinkingWindowElapsedText(1000)).toBe("1 秒");
    expect(thinkingWindowElapsedText(1999)).toBe("1 秒");
    expect(thinkingWindowElapsedText(12_400)).toBe("12 秒");
  });

  it("露秒数的门槛是正数（写成 0 的话「不到一秒」那一支会变成「立刻露 1 秒」）", () => {
    expect(ELAPSED_SHOW_AFTER_MS).toBeGreaterThan(0);
    expect(ELAPSED_SHOW_AFTER_MS).toBeLessThan(PATIENCE_LABEL_AFTER_MS);
  });
});
