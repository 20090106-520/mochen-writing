import { describe, expect, it, vi } from "vitest";
import {
  CH,
  eventOf,
  openChapter,
  proposal,
  push,
  setupAgentFixture,
  store
} from "./agent-store-fixture";

/**
 * `reduceEvent` 的 error 分支怎么对待提案卡（缺陷③的 live 半边，评审 T3-1）。
 * 独立成文件而不是塞进 useAgentStore.test.ts：那份已经贴着 800 行硬门禁
 * （tools/check-source-line-budget.mjs），本仓先例是把测试拆成共享
 * agent-store-fixture.ts 的多个 `.test.ts`（useAgentStore.hydrate.test.ts 同因）。
 */
setupAgentFixture();

describe("useAgentStore 实时 error 对提案卡状态的影响", () => {
  it("实时 error 带 proposalId ⇒ 那张 pending 卡收编成 stale，不再计入待审", async () => {
    // 自动批准（accept-session / accept-prefix）跑在主进程的 autos 队列里，渲染层拿不到
    // DecisionResult；失败只剩一条带 proposalId 的 error。这张卡的 pending 已在主进程删除，
    // 实时页面上却仍是 pending ⇒ 卡说谎。口径只看 status === "pending"：ProposalCard 的可批准
    // 闸门与 pendingOf 都读它，所以这里钉状态不钉 DOM（本仓没有组件测试）。
    await openChapter();
    store().startListening();
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("proposal", { proposal: proposal("p1") })
    });
    expect(store().proposals.p1?.status).toBe("pending");
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("error", {
        message: "写入时 chapters/01-a.md 又被改动过，这条建议已失效。",
        proposalId: "p1"
      })
    });
    expect(store().proposals.p1?.status).toBe("stale");
    expect(store().pendingOf(CH)).toBe(0);
    // 「错误可见」没被状态改判替掉：lastError 照旧落这句中文。
    expect(store().viewOf(CH).lastError).toContain("又被改动过");
  });

  it("实时 error 不带 proposalId ⇒ 一张卡的状态都不动（模型 503 不是失效判决）", async () => {
    await openChapter();
    store().startListening();
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("proposal", { proposal: proposal("p1") })
    });
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("proposal", { proposal: proposal("p2") })
    });
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("written", {
        proposalId: "p2",
        docRelPath: CH,
        fingerprint: "fp-b",
        backupRelPath: null
      })
    });
    await vi.runAllTimersAsync();
    expect(store().proposals.p1?.status).toBe("pending");
    expect(store().proposals.p2?.status).toBe("written");
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("error", { message: "模型服务端返回 503：繁忙" })
    });
    expect(store().proposals.p1?.status).toBe("pending");
    expect(store().proposals.p2?.status).toBe("written");
    expect(store().pendingOf(CH)).toBe(1);
    // 带着查不到的 proposalId 也一样不许越权：不崩、不顺手扫别的卡（pending 的 p1 仍是 pending）。
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("error", { message: "这条提案已不在待审列表里。", proposalId: "pGhost" })
    });
    expect(store().proposals.p1?.status).toBe("pending");
    expect(store().proposals.p2?.status).toBe("written");
    expect(store().pendingOf(CH)).toBe(1);
  });

  it("已 written / 已 cancelled 的卡不被后续 error{proposalId} 重判（守卫严格只认 pending）", async () => {
    await openChapter();
    store().startListening();
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("proposal", { proposal: proposal("p1") })
    });
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("written", {
        proposalId: "p1",
        docRelPath: CH,
        fingerprint: "fp-b",
        backupRelPath: null
      })
    });
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("proposal", { proposal: proposal("p2") })
    });
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("decision", {
        proposalId: "p2",
        decision: "cancel",
        guidance: "",
        auto: false
      })
    });
    await vi.runAllTimersAsync();
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("error", { message: "提案之后又被改动过，这条建议已失效。", proposalId: "p1" })
    });
    // cancelled 那一半是「严格 === pending」的钉子：守卫若写成「不是 written 就改判」，这张卡必红。
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("error", { message: "这条建议已失效。", proposalId: "p2" })
    });
    expect(store().proposals.p1?.status).toBe("written");
    expect(store().proposals.p2?.status).toBe("cancelled");
    expect(store().viewOf(CH).lastError).toBe("这条建议已失效。");
  });
});
