import { describe, expect, it } from "vitest";
import {
  CH,
  eventOf,
  itemsOf,
  loadSession,
  loaded,
  openChapter,
  proposal,
  proposalDiff,
  push,
  readDoc,
  setSessionResult,
  setupAgentFixture,
  store
} from "./agent-store-fixture";

// 水合（ensureHydrated）八规则 + D1 副作用抑制用例，独立成文件以共享 useAgentStore.test.ts
// 的夹具而各不过 800 行门禁（D2）。
setupAgentFixture();

describe("useAgentStore 水合（ensureHydrated 八规则）", () => {
  it("规则1 幂等：hydrated 后再按 /resume 不重复取数", async () => {
    await openChapter();
    setSessionResult(loaded([eventOf("user-message", { text: "改紧" })]));
    loadSession.mockClear();
    await store().ensureHydrated(CH);
    await store().ensureHydrated(CH);
    expect(loadSession).toHaveBeenCalledTimes(1);
    expect(store().viewOf(CH).items.length).toBe(1);
  });

  it("规则2 running 时跳过：本轮在跑不抢迟到 delta 的顺序", async () => {
    await openChapter();
    store().startListening();
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    loadSession.mockClear();
    await store().ensureHydrated(CH);
    expect(loadSession).not.toHaveBeenCalled();
    expect(store().viewOf(CH).hydrated).toBe(false);
  });

  it("规则3 并发合流 + 失败回滚可重试", async () => {
    await openChapter();
    loadSession.mockClear();
    setSessionResult({
      found: false,
      reason: "no-book",
      message: "还没打开作品目录，历史读不回来。"
    });
    const first = store().ensureHydrated(CH);
    const second = store().ensureHydrated(CH);
    await Promise.all([first, second]);
    expect(loadSession).toHaveBeenCalledTimes(1);
    // no-book 不置位（规则5），下次还能水合：
    expect(store().viewOf(CH).hydrated).toBe(false);
    // 抛错路径：回滚 hydrated=false、hydrating=false，notice 见中文，可再按 /resume
    loadSession.mockImplementationOnce(async () => {
      throw new Error("会话首行不可用（x）：坏");
    });
    await store().ensureHydrated(CH);
    expect(store().viewOf(CH).hydrating).toBe(false);
    expect(store().notice).toContain("会话首行不可用");
  });

  it("规则4 按事件 id 去重：实时已有 e-message，回放再送同 id 不叠加、旧卡不打 diff IPC", async () => {
    await openChapter();
    store().startListening();
    proposalDiff.mockClear();
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("message", { id: "e-message", text: "实时正文", interrupted: false })
    });
    setSessionResult(
      loaded([
        eventOf("message", { id: "e-message", text: "实时正文", interrupted: false }),
        eventOf("proposal", { proposal: proposal("pOld") })
      ])
    );
    await store().ensureHydrated(CH);
    expect(itemsOf(CH).filter((e) => e.id === "e-message").length).toBe(1);
    expect(store().proposals["pOld"]!.status).toBe("expired");
    expect(proposalDiff).not.toHaveBeenCalled(); // 规则4：fetchDiff:false（M1）
  });

  it("规则4b 回放不触发写盘回吸收、也不覆盖全局提示（D1）", async () => {
    await openChapter();
    readDoc.mockClear();
    setSessionResult(
      loaded([
        eventOf("proposal", { proposal: proposal("pW") }),
        eventOf("written", {
          proposalId: "pW",
          docRelPath: CH,
          fingerprint: "fp-b",
          backupRelPath: null
        })
      ])
    );
    await store().ensureHydrated(CH);
    // absorbAgentWrite 会走 reloadActive → readDoc；回放必须不触发它（D1）。
    expect(readDoc).not.toHaveBeenCalled();
    // written.status 仍如实落态，只是不再污染实时提示（rule6/rule8 依赖 status）。
    expect(store().proposals["pW"]!.status).toBe("written");
    expect(store().notice).not.toContain("已写入");
  });

  it("规则5 no-session 置位、no-book 不置位", async () => {
    await openChapter();
    setSessionResult({
      found: false,
      reason: "no-session",
      message: "这本书里没有这条线程的历史。"
    });
    await store().ensureHydrated(CH);
    expect(store().viewOf(CH).hydrated).toBe(true);
  });

  it("规则6 派生扫描覆盖 status：decision 配对的卡不是 expired", async () => {
    await openChapter();
    setSessionResult(
      loaded([
        eventOf("proposal", { proposal: proposal("pA") }),
        eventOf("decision", { proposalId: "pA", decision: "cancel", guidance: "", auto: false })
      ])
    );
    await store().ensureHydrated(CH);
    expect(store().proposals["pA"]!.status).toBe("cancelled");
  });

  it("规则7 droppedLines>0 写中文 notice 且不伪造事件", async () => {
    await openChapter();
    setSessionResult(loaded([eventOf("user-message", { text: "改紧" })], [3, 9]));
    await store().ensureHydrated(CH);
    expect(store().notice).toBe("这条线程有 2 行没能读回，其余内容已恢复。");
    expect(store().viewOf(CH).items.length).toBe(1);
  });

  it("规则8（M3）只有 interrupted 结尾才复活「继续」；error 结尾不标 failed", async () => {
    await openChapter();
    setSessionResult(
      loaded([
        eventOf("user-message", { text: "改紧" }),
        eventOf("interrupted", { pendingProposals: 0 })
      ])
    );
    await store().ensureHydrated(CH);
    expect(store().viewOf(CH).endedAs).toBe("interrupted");
    expect(store().canContinue(CH)).toBe(true);
    // 换 error 结尾：lastError 保留但不 failed，canContinue 必须为假。
    store().threads[CH]!.hydrated = false;
    store().threads[CH]!.endedAs = "";
    setSessionResult(
      loaded([
        eventOf("user-message", { text: "改紧" }),
        eventOf("error", { message: "模型服务端返回 503：上游繁忙" })
      ])
    );
    await store().ensureHydrated(CH);
    expect(store().viewOf(CH).endedAs).toBe("");
    expect(store().canContinue(CH)).toBe(false);
    expect(store().viewOf(CH).lastError).toBe("模型服务端返回 503：上游繁忙");
  });
});
