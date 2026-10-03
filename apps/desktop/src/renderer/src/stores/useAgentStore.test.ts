import { describe, expect, it, vi } from "vitest";
import { TURN_END_STATUSES } from "@mochen/contracts";
import type { AgentOutbound } from "@mochen/contracts";
import { composeStatusLine, threadKeyFor, UNBOUND } from "./useAgentStore";
import { useBookStore } from "./useBookStore";
// 夹具（api 桩、事件工厂、openChapter/itemsOf/store 等）与 useAgentStore.hydrate.test.ts 共用，
// 抽到 agent-store-fixture.ts 只为过 800 行门禁（D2）；此处为纯搬迁，未改任何断言语义。
import {
  CH,
  OTHER,
  api,
  decided,
  decideProposal,
  eventOf,
  interruptTurn,
  itemsOf,
  loadSession,
  openChapter,
  proposal,
  proposalDiff,
  push,
  setNextDecision,
  setupAgentFixture,
  started,
  startTurn,
  store,
  typed
} from "./agent-store-fixture";

setupAgentFixture();

describe("useAgentStore", () => {
  it("startListening 幂等：装配重复调用也只订阅一次", async () => {
    await openChapter();
    store().startListening();
    store().startListening();
    expect(api.onAgentEvent).toHaveBeenCalledTimes(1);
  });

  it("流式残字与定稿不重复：delta 累积，message 事件到达后归零并进 items", async () => {
    await openChapter();
    store().startListening();
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    push({
      type: "delta",
      turnId: "t1",
      threadKey: CH,
      deltaKind: "reasoning",
      text: "先读上下文"
    });
    push({ type: "delta", turnId: "t1", threadKey: CH, deltaKind: "message", text: "海雾" });
    expect(store().viewOf(CH).streaming).toEqual({ reasoning: "先读上下文", message: "海雾" });
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("message", { text: "海雾涌上来", interrupted: false })
    });
    expect(store().viewOf(CH).streaming.message).toBe("");
    expect(store().viewOf(CH).streaming.reasoning).toBe("先读上下文");
    expect(typed("message").text).toBe("海雾涌上来");
  });

  it("线程隔离：另一章的事件不进当前章，running 也各算各的", async () => {
    await openChapter();
    store().startListening();
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("user-message", { text: "改这里" })
    });
    push({ type: "turn-start", turnId: "t2", threadKey: OTHER });
    expect(itemsOf(CH).length).toBe(1);
    expect(itemsOf(OTHER).length).toBe(0);
    expect(store().viewOf(CH).turnId).toBe("t1");
    expect(store().viewOf(OTHER).turnId).toBe("t2");
    expect(store().viewOf(OTHER).running).toBe(true);
  });

  it("proposal 事件登记成待审卡，diff 从主进程取回", async () => {
    await openChapter();
    store().startListening();
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("proposal", { proposal: proposal("p1") })
    });
    await vi.runAllTimersAsync();
    expect(store().proposals.p1?.status).toBe("pending");
    expect(store().proposals.p1?.diff).toBe("diff:p1");
    expect(store().pendingOf(CH)).toBe(1);
  });

  it("decision：cancel 落已取消，deny-with-guidance 落已拒绝并把说明挂上", async () => {
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
      event: eventOf("decision", {
        proposalId: "p1",
        decision: "deny-with-guidance",
        guidance: "别动比喻",
        auto: false
      })
    });
    expect(store().proposals.p1?.status).toBe("rejected");
    expect(store().proposals.p1?.message).toBe("别动比喻");
    expect(store().pendingOf(CH)).toBe(0);
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
    expect(store().proposals.p2?.status).toBe("cancelled");
  });

  it("written：卡片落已写入，并把新指纹交给 book store 吸收", async () => {
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
        backupRelPath: ".mochen/changes/x/01-a.md.bak"
      })
    });
    await vi.runAllTimersAsync();
    expect(store().proposals.p1?.status).toBe("written");
    expect(store().notice).toContain("已写入");
    expect(store().notice).toContain("原稿已备份");
    expect(useBookStore().draft).toBe("正文\n夜色沉下去\n");
    expect(useBookStore().notice).toContain("草稿已同步");
  });

  it("写盘失败（io）与权限收紧都保持待审并显示原因（spec §9 可重试）", async () => {
    await openChapter();
    store().startListening();
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("proposal", { proposal: proposal("p1") })
    });
    setNextDecision({ ok: false, reason: "io", message: "文件被占用，写入失败" });
    await store().decide("p1", "accept-once", "");
    expect(store().proposals.p1?.status).toBe("pending");
    expect(store().proposals.p1?.message).toBe("文件被占用，写入失败");
    setNextDecision({
      ok: false,
      reason: "permission-denied",
      message: "只读参考档下一律拒绝写入"
    });
    await store().decide("p1", "accept-once", "");
    expect(store().proposals.p1?.status).toBe("pending");
    expect(store().proposals.p1?.message).toContain("只读");
    expect(decided.length).toBe(2);
  });

  it("指纹过期（stale）落「文件已变动」，不再计入待审", async () => {
    await openChapter();
    store().startListening();
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("proposal", { proposal: proposal("p1") })
    });
    setNextDecision({ ok: false, reason: "stale", message: "文件在外部被改过，已拒写" });
    await store().decide("p1", "accept-once", "");
    expect(store().proposals.p1?.status).toBe("stale");
    expect(store().pendingOf(CH)).toBe(0);
  });

  it("取消与拒绝即使没有事件回推，也凭 decide 的返回值落态", async () => {
    await openChapter();
    store().startListening();
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("proposal", { proposal: proposal("p1") })
    });
    setNextDecision({ ok: false, reason: "cancelled", message: "已取消这条提案" });
    await store().decide("p1", "cancel", "");
    expect(store().proposals.p1?.status).toBe("cancelled");
    setNextDecision({ ok: false, reason: "denied", message: "已拒绝" });
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("proposal", { proposal: proposal("p2") })
    });
    await store().decide("p2", "deny-with-guidance", "别改节奏");
    expect(store().proposals.p2?.status).toBe("rejected");
    expect(store().proposals.p2?.message).toBe("别改节奏");
  });

  it("send 用当前活动章作线程键，没开标签时退回 unbound", async () => {
    store().send("写点啥");
    expect(started[0]).toEqual({
      threadKey: UNBOUND,
      docRelPath: null,
      stageId: "draft",
      userText: "写点啥",
      thinkingLevel: "off",
      webSearchEnabled: false
    });
    await openChapter();
    store().send("改这一章");
    expect(started[1]).toEqual({
      threadKey: CH,
      docRelPath: CH,
      stageId: "draft",
      userText: "改这一章",
      thinkingLevel: "off",
      webSearchEnabled: false
    });
    expect(threadKeyFor(null)).toBe(UNBOUND);
    expect(threadKeyFor(CH)).toBe(CH);
  });

  it("两枚每轮开关的态在 store，send 把当下值原样塞进出站输入（漏一层就到这里露头）", async () => {
    await openChapter();
    expect(store().thinkingLevel).toBe("off");
    expect(store().webSearchEnabled).toBe(false);

    store().toggleWebSearch();
    store().cycleThinking();
    store().send("想一想再改");
    expect(started.at(-1)).toMatchObject({ thinkingLevel: "low", webSearchEnabled: true });

    // 四步必须回到 off：枚举里少一格或多一格，这条先红。
    store().cycleThinking();
    store().cycleThinking();
    store().cycleThinking();
    expect(store().thinkingLevel).toBe("off");
    store().toggleWebSearch();
    expect(store().webSearchEnabled).toBe(false);
    store().send("不用想");
    expect(started.at(-1)).toMatchObject({ thinkingLevel: "off", webSearchEnabled: false });
  });

  it("stop 打的是 turn-start 推来的那个 turnId；没有活动 turn 就不发", async () => {
    store().startListening();
    expect(await store().stop()).toBe(false);
    expect(interruptTurn).not.toHaveBeenCalled();
    await openChapter();
    push({ type: "turn-start", turnId: "t9", threadKey: CH });
    expect(await store().stop()).toBe(true);
    expect(interruptTurn).toHaveBeenCalledWith("t9");
    push({ type: "turn-end", turnId: "t9", threadKey: CH, status: "interrupted", message: "" });
    expect(await store().stop()).toBe(false);
  });

  it("tick 按最早开跑的线程计时；没有线程在跑就归零", async () => {
    store().startListening();
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    push({ type: "turn-start", turnId: "t2", threadKey: OTHER });
    vi.setSystemTime(new Date("2026-10-01T00:00:12.000Z"));
    store().tick();
    expect(store().seconds).toBe(12);
    push({ type: "turn-end", turnId: "t1", threadKey: CH, status: "done", message: "" });
    push({ type: "turn-end", turnId: "t2", threadKey: OTHER, status: "done", message: "" });
    store().tick();
    expect(store().seconds).toBe(0);
  });

  it("状态行四态 + 排队数：工作中 / 断了给原因 / 待审计数 / 就绪", () => {
    const running = { ...store().viewOf("x"), running: true };
    expect(composeStatusLine(running, 42, 0, 0)).toBe("工作中 · 42s · Esc 打断");
    // 排队数只在运行中出现（spec §5.1：状态行用「排队 N 条」如实说明下一条什么时候才生效）。
    expect(composeStatusLine(running, 42, 0, 2)).toBe("工作中 · 42s · Esc 打断 · 排队 2 条");
    const idle = { ...store().viewOf("y"), running: false };
    expect(composeStatusLine(idle, 0, 3, 0)).toBe("3 条待审");
    expect(composeStatusLine(idle, 0, 0, 0)).toBe("就绪");
    expect(composeStatusLine(undefined, 0, 0, 0)).toBe("就绪");
    // spec §6.3 第 3 条：打断后仍有未审批提案时，状态行必须还是「已打断 · N 条待审」。
    const cut = { ...idle, endedAs: "interrupted" as const };
    expect(composeStatusLine(cut, 0, 2, 0)).toBe("已打断 · 2 条待审");
    expect(composeStatusLine(cut, 0, 0, 0)).toBe("已打断 · 可点「继续」");
    const failed = {
      ...idle,
      endedAs: "failed" as const,
      lastError: "模型服务端返回 503：上游繁忙"
    };
    expect(composeStatusLine(failed, 0, 0, 0)).toBe("模型服务端返回 503：上游繁忙 · 可点「继续」");
  });

  it("Tab 排队：trim 后入队、满 5 条拒入队并写中文；打断不清队；turn-end 自动发队首", async () => {
    await openChapter();
    store().startListening();
    expect(store().queueText(CH, "  带空白  ")).toBe(true);
    expect(store().viewOf(CH).queued.at(-1)).toBe("带空白");
    // 纯空白没有指令，不占队列也不写提示
    expect(store().queueText(CH, "   ")).toBe(false);
    store().viewOf(CH).queued.length = 0;
    for (let i = 1; i <= 5; i += 1) expect(store().queueText(CH, `第 ${i} 条`)).toBe(true);
    expect(store().queueText(CH, "第六条")).toBe(false);
    expect(store().notice).toBe("排队指令最多 5 条，先等这一轮结束。");
    expect(store().viewOf(CH).queued.length).toBe(5);
    // 打断不清队（spec §5.1：按 Esc 停的是当前这一轮，排队指令仍然有效）：
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    store().threads[CH]!.turnId = "t1";
    await store().stop();
    expect(store().viewOf(CH).queued.length).toBe(5);
    // turn-end 自动发队首（一轮只发一条，其余继续排）：
    started.length = 0;
    loadSession.mockClear();
    push({ type: "turn-end", turnId: "t1", threadKey: CH, status: "interrupted", message: "" });
    await Promise.resolve();
    expect(started.map((input) => input.userText)).toEqual(["第 1 条"]);
    expect(store().viewOf(CH).queued.length).toBe(4);
    // 裁定 G3 的顺序：发了队首就不在本 tick 触发水合。ensureHydrated 的同步前缀会把历史
    // 重放进这条正要起新轮的线程，规则 2（running 跳过）此刻还没资格挡它。
    expect(loadSession).not.toHaveBeenCalled();
  });

  it("turn-end 队列为空时仍补一次水合（证明上一条的早退不是把水合整个关掉）", async () => {
    await openChapter();
    store().startListening();
    loadSession.mockClear();
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    push({ type: "turn-end", turnId: "t1", threadKey: CH, status: "done", message: "" });
    expect(loadSession).toHaveBeenCalledWith(CH);
    await vi.runAllTimersAsync();
    expect(store().viewOf(CH).hydrated).toBe(true);
  });

  it("turn-end failed 与 error 事件都只留在出事的线程里", async () => {
    await openChapter();
    store().startListening();
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("error", { message: "锚点在正文里出现两次" })
    });
    expect(store().viewOf(CH).lastError).toBe("锚点在正文里出现两次");
    push({
      type: "turn-end",
      turnId: "t1",
      threadKey: CH,
      status: "failed",
      message: "模型服务端返回 503：繁忙"
    });
    expect(store().viewOf(CH).lastError).toContain("503");
    expect(store().viewOf(CH).running).toBe(false);
    expect(store().viewOf(OTHER).lastError).toBe("");
  });

  it("断了才有「继续」：interrupted / failed 给入口，done、运行中与没跑过都不给", async () => {
    await openChapter();
    store().startListening();
    expect(store().canContinue(CH)).toBe(false);
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    expect(store().canContinue(CH)).toBe(false);
    push({ type: "turn-end", turnId: "t1", threadKey: CH, status: "done", message: "" });
    expect(store().canContinue(CH)).toBe(false);
    push({ type: "turn-start", turnId: "t2", threadKey: CH });
    push({
      type: "turn-end",
      turnId: "t2",
      threadKey: CH,
      status: "interrupted",
      message: "已打断"
    });
    expect(store().canContinue(CH)).toBe(true);
    push({ type: "turn-start", turnId: "t3", threadKey: CH });
    push({
      type: "turn-end",
      turnId: "t3",
      threadKey: CH,
      status: "failed",
      message: "模型服务端返回 429"
    });
    expect(store().canContinue(CH)).toBe(true);
    expect(store().canContinue(OTHER)).toBe(false);
  });

  it("「继续」发的是固定指令且断了才发得出去，不是把上一句原样重发", async () => {
    await openChapter();
    store().startListening();
    store().continueTurn();
    expect(started).toEqual([]);
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    push({
      type: "turn-end",
      turnId: "t1",
      threadKey: CH,
      status: "interrupted",
      message: "已打断"
    });
    store().continueTurn();
    expect(started.at(-1)?.userText).toContain("接着上一轮未写完的地方继续");
    expect(started.at(-1)?.docRelPath).toBe(CH);
  });

  // ===== 控制方追加的三条硬约束（Task 12 评审产物，简报里没有）=====

  it("（m1）startTurn 被边界拒绝：单句中文进 notice 与该线程 lastError，绝不静默", async () => {
    await openChapter();
    store().startListening();
    startTurn.mockImplementationOnce(async () => {
      throw new Error("输入内容过长（最多 20000 字）");
    });
    store().send("写点啥");
    await vi.runAllTimersAsync();
    expect(store().notice).toContain("输入内容过长（最多 20000 字）");
    expect(store().viewOf(CH).lastError).toContain("输入内容过长（最多 20000 字）");
    expect(store().viewOf(CH).running).toBe(false);
    expect(started).toEqual([]);
  });

  it("（m1）decide 被拒绝：卡片保持待审并显示中文原因，decide 的 promise 照样落地", async () => {
    await openChapter();
    store().startListening();
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("proposal", { proposal: proposal("p1") })
    });
    decideProposal.mockImplementationOnce(async () => {
      throw new Error("提案标识不能为空");
    });
    await store().decide("p1", "accept-once", "");
    await vi.runAllTimersAsync();
    expect(store().proposals.p1?.status).toBe("pending");
    expect(store().proposals.p1?.message).toContain("提案标识不能为空");
    expect(store().notice).toContain("提案标识不能为空");
  });

  it("（m1）diff 取回落空：中文原因进 notice，卡片仍是待审而不是崩掉", async () => {
    await openChapter();
    store().startListening();
    proposalDiff.mockImplementationOnce(async () => {
      throw new Error("这条提案的原文片段没找到，无法生成 diff");
    });
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("proposal", { proposal: proposal("p1") })
    });
    await vi.runAllTimersAsync();
    expect(store().notice).toContain("这条提案的原文片段没找到，无法生成 diff");
    expect(store().proposals.p1?.status).toBe("pending");
    expect(store().proposals.p1?.diff).toBe("");
  });

  it("（m1）interruptTurn 被拒绝：stop 返回 false 并把中文原因显示出来", async () => {
    await openChapter();
    store().startListening();
    push({ type: "turn-start", turnId: "t5", threadKey: CH });
    interruptTurn.mockImplementationOnce(async () => {
      throw new Error("这一轮已经结束，无需打断");
    });
    expect(await store().stop()).toBe(false);
    expect(store().notice).toContain("这一轮已经结束，无需打断");
    expect(store().viewOf(CH).lastError).toContain("这一轮已经结束，无需打断");
  });

  it("（m2）未知类型的推送：忽略并留痕，当前线程的 items 一字不加，之后的正常事件照样归约", async () => {
    await openChapter();
    store().startListening();
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("user-message", { text: "改这里" })
    });
    const threadsBefore = Object.keys(store().threads).length;
    push({ type: "来自未来的推送", turnId: "t1", threadKey: CH } as unknown as AgentOutbound);
    expect(store().notice).toContain("来自未来的推送");
    expect(itemsOf(CH).length).toBe(1);
    expect(Object.keys(store().threads).length).toBe(threadsBefore);
    push({ type: "delta", turnId: "t1", threadKey: CH, deltaKind: "message", text: "海雾" });
    expect(store().viewOf(CH).streaming.message).toBe("海雾");
  });

  it("（m2）缺 threadKey 的推送：忽略并留痕，绝不新建线程也不给现有线程加事件", async () => {
    await openChapter();
    store().startListening();
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    push({ type: "turn-start", turnId: "t9" } as unknown as AgentOutbound);
    expect(store().notice).toContain("会话线程");
    expect(Object.keys(store().threads)).toEqual([CH]);
    expect(store().viewOf(CH).turnId).toBe("t1");
    expect(itemsOf(CH).length).toBe(0);
    push({ type: "turn-end", turnId: "t1", threadKey: CH, status: "done", message: "" });
    expect(store().viewOf(CH).running).toBe(false);
  });

  it("（m2）event 载荷不是对象 / 事件类型不认识 / 收尾状态不认识：都忽略，正常事件仍可用", async () => {
    await openChapter();
    store().startListening();
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: "锚点在正文里出现两次"
    } as unknown as AgentOutbound);
    expect(store().notice).toContain("事件载荷不是一个对象");
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: { id: "e1", ts: "2026-10-01T00:00:00.000Z", turnId: "t1", type: "mystery" }
    } as unknown as AgentOutbound);
    expect(store().notice).toContain("事件类型");
    push({
      type: "turn-end",
      turnId: "t1",
      threadKey: CH,
      status: "exploded",
      message: ""
    } as unknown as AgentOutbound);
    expect(store().notice).toContain("收尾状态");
    expect(store().threads[UNBOUND]).toBeUndefined();
    expect(Object.keys(store().threads)).toEqual([CH]);
    expect(itemsOf(CH).length).toBe(0);
    push({ type: "delta", turnId: "t1", threadKey: CH, deltaKind: "message", text: "海雾" });
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("message", { text: "海雾涌上来", interrupted: false })
    });
    expect(store().viewOf(CH).streaming.message).toBe("");
    expect(typed("message").text).toBe("海雾涌上来");
  });

  it("（o）threadKey 恒等于 docRelPath ?? UNBOUND：没开标签的推送与发送共用同一条 unbound 线程", async () => {
    expect(UNBOUND).toBe("unbound");
    store().startListening();
    push({ type: "turn-start", turnId: "t1", threadKey: UNBOUND });
    push({
      type: "event",
      turnId: "t1",
      threadKey: UNBOUND,
      event: eventOf("user-message", { text: "先问一句" })
    });
    expect(Object.keys(store().threads)).toEqual([UNBOUND]);
    expect(itemsOf(UNBOUND).length).toBe(1);
    expect(itemsOf(CH).length).toBe(0);
    store().send("没开标签也问一句");
    expect(started[0]).toEqual({
      threadKey: UNBOUND,
      docRelPath: null,
      stageId: "draft",
      userText: "没开标签也问一句",
      // 没开书也照样发得出这一轮，两枚每轮开关仍是默认关档 —— 字段一个都不缺。
      thinkingLevel: "off",
      webSearchEnabled: false
    });
    expect(threadKeyFor(null)).toBe(UNBOUND);
  });

  // ===== 修复波（Task 13 评审）：裁定 p 单一来源 / 线程隔离全分支 / 同线程两轮 turnId 守卫 / threadKeyFor trim =====

  it("（裁定 p）TURN_END_STATUSES 每一项的 turn-end 都收尾：running 归 false、endedAs 落对应值", async () => {
    // 随枚举增长的写法：contracts 新加一项时这里会自动多跑一次；若渲染层退回自造白名单会漏掉新状态而挂 running。
    await openChapter();
    store().startListening();
    for (const status of TURN_END_STATUSES) {
      push({ type: "turn-start", turnId: `t-${status}`, threadKey: CH });
      push({ type: "turn-end", turnId: `t-${status}`, threadKey: CH, status, message: "" });
      expect(store().viewOf(CH).running).toBe(false);
      expect(store().viewOf(CH).endedAs).toBe(status);
    }
  });

  it("（隔离·全分支）非激活线程的 delta/event/written 各归各线程，绝不串进激活页", async () => {
    await openChapter(); // 激活页 = CH
    store().startListening();
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    // 向另一条线程 OTHER 推三类事件：delta 走增量分支、error 与 written 走 event 分支
    push({ type: "delta", turnId: "t9", threadKey: OTHER, deltaKind: "message", text: "别章残字" });
    push({
      type: "event",
      turnId: "t9",
      threadKey: OTHER,
      event: eventOf("error", { message: "别章的错" })
    });
    push({
      type: "event",
      turnId: "t9",
      threadKey: OTHER,
      event: eventOf("written", {
        proposalId: "pOther",
        docRelPath: OTHER,
        fingerprint: "fp-b",
        backupRelPath: null
      })
    });
    await vi.runAllTimersAsync();
    // 激活页 CH 的流式与错误一字未动
    expect(store().viewOf(CH).streaming.message).toBe("");
    expect(store().viewOf(CH).lastError).toBe("");
    expect(itemsOf(CH).length).toBe(0);
    // 载荷各归 OTHER 自己那条线程
    expect(store().viewOf(OTHER).streaming.message).toBe("别章残字");
    expect(store().viewOf(OTHER).lastError).toBe("别章的错");
    expect(itemsOf(OTHER).length).toBe(2);
  });

  it("（同线程两轮）迟到的旧轮 turn-end 不许抹掉新一轮的 running/streaming", async () => {
    await openChapter();
    store().startListening();
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    push({ type: "turn-end", turnId: "t1", threadKey: CH, status: "done", message: "" });
    // 同一条线程再起第二轮
    push({ type: "turn-start", turnId: "t2", threadKey: CH });
    push({ type: "delta", turnId: "t2", threadKey: CH, deltaKind: "message", text: "第二轮残字" });
    // 迟到的第一轮 turn-end 到达：必须被忽略，不能清空第二轮
    push({ type: "turn-end", turnId: "t1", threadKey: CH, status: "done", message: "" });
    expect(store().viewOf(CH).running).toBe(true);
    expect(store().viewOf(CH).turnId).toBe("t2");
    expect(store().viewOf(CH).streaming.message).toBe("第二轮残字");
    // 第二轮正常收尾
    push({
      type: "turn-end",
      turnId: "t2",
      threadKey: CH,
      status: "interrupted",
      message: "已打断"
    });
    expect(store().viewOf(CH).running).toBe(false);
    expect(store().viewOf(CH).streaming.message).toBe("");
    expect(store().viewOf(CH).endedAs).toBe("interrupted");
  });

  it("（threadKeyFor trim）纯空白活动标签归一到 UNBOUND，与主进程同口径", () => {
    expect(threadKeyFor("   ")).toBe(UNBOUND);
    expect(threadKeyFor("")).toBe(UNBOUND);
    expect(threadKeyFor(CH)).toBe(CH);
    expect(threadKeyFor(null)).toBe(UNBOUND);
  });

  it("reduceEvent 第三参 fetchDiff:false 时不打 diff IPC（回放不白打）", async () => {
    await openChapter();
    const thread = store().viewOf(CH);
    proposalDiff.mockClear();
    store().reduceEvent(thread, eventOf("proposal", { proposal: proposal("pNoDiff") }), {
      fetchDiff: false
    });
    expect(proposalDiff).not.toHaveBeenCalled();
  });

  it("pendingOf 不数 expired（零改动靠测试钉住，不靠注释）", async () => {
    await openChapter();
    const thread = store().viewOf(CH);
    store().reduceEvent(thread, eventOf("proposal", { proposal: proposal("pOpen") }));
    store().proposals["pOpen"]!.status = "expired";
    expect(store().pendingOf(CH)).toBe(0);
    store().proposals["pOpen"]!.status = "pending";
    expect(store().pendingOf(CH)).toBe(1);
  });

  it("新线程默认 hydrated=false / hydrating=false / queued=[]", () => {
    const thread = store().viewOf("brand-new-thread");
    expect(thread.hydrated).toBe(false);
    expect(thread.hydrating).toBe(false);
    expect(thread.queued).toEqual([]);
  });
});
