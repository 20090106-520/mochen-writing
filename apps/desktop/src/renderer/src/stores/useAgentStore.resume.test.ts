/**
 * 「继续」在 store 这一层的**行为**（2026-11-20 · 主线第一刀）。
 *
 * 接线形状由 components/turn-resume-wiring.test.ts 钉；这里钉的是**行为**：
 * 点一下到底发出去了什么、失败时有没有把字还回输入框、没有可重发的内容时会不会白跑一轮。
 *
 * 独立成文件而不是塞进 useAgentStore.test.ts：那份已 719 行，800 行门禁是硬的
 * （.archcore/conventions/source-line-budget.rule.md）。
 */
import { describe, expect, it } from "vitest";
import {
  CH,
  eventOf,
  openChapter,
  push,
  setupAgentFixture,
  started,
  store
} from "./agent-store-fixture";

setupAgentFixture();

/** 走一轮：发出去一句用户指令，然后把这一轮收成指定收场。 */
function runTurn(userText: string, end: "interrupted" | "failed"): void {
  push({ type: "turn-start", turnId: "t1", threadKey: CH });
  push({
    type: "event",
    turnId: "t1",
    threadKey: CH,
    event: eventOf("user-message", { text: userText })
  });
  push({ type: "turn-end", turnId: "t1", threadKey: CH, status: end, message: "" });
}

describe("resumeLastTurn · 「继续」这一枚钮按下之后", () => {
  it("被打断 ⇒ 把上一句原样再发一次，同一线程", async () => {
    await openChapter();
    store().startListening();
    runTurn("把这段改得有雾气", "interrupted");
    started.length = 0;

    expect(store().resumeLastTurn()).toBe(true);
    expect(started).toHaveLength(1);
    expect(started.at(-1)?.userText).toBe("把这段改得有雾气");
    expect(started.at(-1)?.threadKey).toBe(CH);
  });

  it("失败 ⇒ 也能继续（失败往往就是「再试一次」的意思）", async () => {
    await openChapter();
    store().startListening();
    runTurn("续写下一段", "failed");
    started.length = 0;

    expect(store().resumeLastTurn()).toBe(true);
    expect(started.at(-1)?.userText).toBe("续写下一段");
  });

  it("这一轮还在跑 ⇒ 不发（跑着的时候「打断」才是那一条路）", async () => {
    await openChapter();
    store().startListening();
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    started.length = 0;

    expect(store().resumeLastTurn()).toBe(false);
    expect(started).toHaveLength(0);
  });

  it("一句都没说过 ⇒ 什么都不发：没有可重发的内容就不该白跑一轮", async () => {
    await openChapter();
    store().startListening();
    store().viewOf(CH).endedAs = "interrupted";
    started.length = 0;

    expect(store().resumeLastTurn()).toBe(false);
    expect(started).toHaveLength(0);
  });

  it("重发不进还字账：这一轮失败时，那句字不许被还回输入框（它早就在中栏转录里了，再还一次就是第二份）", async () => {
    await openChapter();
    store().startListening();
    runTurn("把这段改得有雾气", "interrupted");
    store().resumeLastTurn();
    // 重发的那一轮随后失败：还字账若记了那句，输入框会被填回第二份。
    // ⚠️ 必须先补 turn-start：store 里有一道迟到守卫（turnId 不等于本轮就整条忽略），
    // 少了它这一条 turn-end 压根没进这一格，断言会假绿。
    push({ type: "turn-start", turnId: "t2", threadKey: CH });
    push({ type: "turn-end", turnId: "t2", threadKey: CH, status: "failed", message: "上游 503" });

    expect(store().draftOf(CH)).toBe("");
  });

  it("正常的发送仍然记还字账（这一刀不许把老行为改掉）", async () => {
    await openChapter();
    store().startListening();
    store().send("这一句是用户亲手打的");
    push({ type: "turn-start", turnId: "t2", threadKey: CH });
    push({ type: "turn-end", turnId: "t2", threadKey: CH, status: "failed", message: "上游 503" });

    expect(store().draftOf(CH)).toBe("这一句是用户亲手打的");
  });
});
