/**
 * 「继续」这一族的判定（2026-11-20 · 主线第一刀）。
 *
 * 【为什么要有这一族】状态行原来写着「已打断 · 可点「继续」」，而那一行是纯文本——
 * 全仓没有一枚「继续」按钮。用户看到的是一句**点不动**的承诺：
 * AI 被打断之后，界面把他晾在那儿，只能自己把上一句重打一遍。
 *
 * 【这一族只回答两件事】
 *   ① 上一句用户指令是什么（lastUserTextOf）——重发要有内容，不能凭空造一句；
 *   ② 此刻该不该给「继续」这一枚钮（resumeAffordanceOf）——不该给的时刻不给，
 *      免得它在「就绪」时也摆着一枚，点下去只会多跑一轮。
 *
 * 【判据只有这一份】组件（CenterColumn 的状态栏）与 store（resumeLastTurn）都读它，
 * 谁也不自己 if 一遍。
 */
import { describe, expect, it } from "vitest";
import { newThread, type ThreadView } from "./agent-thread";
import { lastUserTextOf, RESUME_LABEL, RESUME_TITLE, resumeAffordanceOf } from "./turn-resume";

function event(type: string, text: string, turnId = "t1"): ThreadView["items"][number] {
  return {
    id: `${type}-${text}`,
    ts: "2026-11-20T00:00:00.000Z",
    turnId,
    type,
    text
  } as unknown as ThreadView["items"][number];
}

function view(extra: Partial<ThreadView> = {}): ThreadView {
  return { ...newThread(), ...extra };
}

describe("lastUserTextOf · 上一句用户指令", () => {
  it("没有线程 ⇒ 空串（没有可重发的内容就不该给按钮）", () => {
    expect(lastUserTextOf(undefined)).toBe("");
  });

  it("一条用户消息都没有 ⇒ 空串", () => {
    expect(lastUserTextOf(view())).toBe("");
  });

  it("取的是**最后**那一条，不是第一条", () => {
    const thread = view({
      items: [event("user-message", "先写第一句"), event("user-message", "把这段改得有雾气")]
    });
    expect(lastUserTextOf(thread)).toBe("把这段改得有雾气");
  });

  it("前面几轮的历史不算：只认最后一条用户消息", () => {
    const thread = view({
      items: [
        event("user-message", "第一轮", "t1"),
        event("message", "t1", "回话"),
        event("user-message", "第二轮", "t2")
      ]
    });
    expect(lastUserTextOf(thread)).toBe("第二轮");
  });

  it("只有空白的那条不算 ⇒ 往前找有字的那条（空白发出去过，但重发它没有意义）", () => {
    const thread = view({
      items: [event("user-message", "有字的那句"), event("user-message", "   \n ")]
    });
    expect(lastUserTextOf(thread)).toBe("有字的那句");
  });

  it("首尾空白都去掉：重发出去的是干净的那句", () => {
    const thread = view({ items: [event("user-message", "  改这一段  ")] });
    expect(lastUserTextOf(thread)).toBe("改这一段");
  });
});

describe("resumeAffordanceOf · 什么时候给「继续」", () => {
  it("没有线程 ⇒ 没有这一枚", () => {
    expect(resumeAffordanceOf(undefined)).toBeNull();
  });

  it("这一轮还在跑 ⇒ 没有（跑着的时候打断按钮才是那一条路）", () => {
    const thread = view({
      running: true,
      endedAs: "interrupted",
      items: [event("user-message", "写")]
    });
    expect(resumeAffordanceOf(thread)).toBeNull();
  });

  it("还没收场过（endedAs 为空）⇒ 没有", () => {
    expect(resumeAffordanceOf(view({ items: [event("user-message", "写")] }))).toBeNull();
  });

  it("正常收场（done）⇒ 没有：这一轮成了，没什么要继续的", () => {
    const thread = view({ endedAs: "done", items: [event("user-message", "写")] });
    expect(resumeAffordanceOf(thread)).toBeNull();
  });

  it("被打断 ⇒ 有：带上一句的字与说明", () => {
    const thread = view({ endedAs: "interrupted", items: [event("user-message", "续写下一段")] });
    const affordance = resumeAffordanceOf(thread);
    expect(affordance).not.toBeNull();
    expect(affordance?.text).toBe("续写下一段");
    expect(affordance?.label).toBe(RESUME_LABEL);
    expect(affordance?.title).toBe(RESUME_TITLE);
  });

  it("失败 ⇒ 有：失败往往就是「再试一次」的意思", () => {
    const thread = view({ endedAs: "failed", items: [event("user-message", "续写下一段")] });
    expect(resumeAffordanceOf(thread)?.text).toBe("续写下一段");
  });

  it("收得不好但**一句都没说过** ⇒ 没有：没有可重发的内容，给一枚空转的钮是骗人", () => {
    const thread = view({ endedAs: "interrupted", items: [] });
    expect(resumeAffordanceOf(thread)).toBeNull();
  });

  it("文案不许是空串：按钮上要写字，悬停要说清这一下会发生什么", () => {
    expect(RESUME_LABEL.trim()).not.toBe("");
    expect(RESUME_TITLE.trim()).not.toBe("");
    // 悬停说明必须说清「重发」这件事，别让人以为会撤回到上一版。
    expect(RESUME_TITLE).toContain("再发一次");
  });
});
