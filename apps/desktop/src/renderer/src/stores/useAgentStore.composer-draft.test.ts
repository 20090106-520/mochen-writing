import { describe, expect, it, vi } from "vitest";
import { composerTextAfterQueue } from "../utils/hotkey-queue";
import { QUEUED_MAX } from "./useAgentStore";
import {
  CH,
  OTHER,
  eventOf,
  openChapter,
  push,
  setupAgentFixture,
  startTurn,
  store
} from "./agent-store-fixture";

/**
 * 输入框的值上收 store（F-A 预填通路）的 store 侧断言。
 * 独立成文件而不是塞进 useAgentStore.test.ts：那份已经贴着 800 行硬门禁
 * （tools/check-source-line-budget.mjs），本仓先例是把测试拆成共享 agent-store-fixture.ts
 * 的多个 `.test.ts`（useAgentStore.hydrate.test.ts、useAgentStore.live-error.test.ts 同因）。
 */
setupAgentFixture();

describe("useAgentStore.composerDrafts · 输入值上收与排队无丢失", () => {
  it("草稿上收 store：draftOf 缺省空串，setDraft/draftOf 按 threadKey 各归各", () => {
    expect(store().draftOf(CH)).toBe("");
    store().setDraft(CH, "第一章的草稿");
    store().setDraft(OTHER, "第二章的草稿");
    expect(store().draftOf(CH)).toBe("第一章的草稿");
    expect(store().draftOf(OTHER)).toBe("第二章的草稿");
  });

  it("prefillComposer：空草稿时写入预填，已有字时不覆盖并给中文提示（W4 联动）", () => {
    store().prefillComposer(CH, "我想改这一章：先读它，再给我三处可以动的地方。");
    expect(store().draftOf(CH)).toBe("我想改这一章：先读它，再给我三处可以动的地方。");
    // 预填成功那一趟必须静默：提示只属于被挡那一支，写成功也提示 = 无条件写 notice
    expect(store().notice).toBe("");
    // 已有字 ⇒ 再预填被挡，草稿一字不改，且写一句中文（错误可见，不静默）
    store().prefillComposer(CH, "第二条预填指令");
    expect(store().draftOf(CH)).toBe("我想改这一章：先读它，再给我三处可以动的地方。");
    expect(store().notice).toContain("预填");
  });

  it("prefillComposer：草稿里只有空白 ⇒ 视作空，预填照样落地且一字提示都不写", () => {
    store().setDraft(CH, "   \n\t ");
    store().prefillComposer(CH, "预填指令");
    expect(store().draftOf(CH)).toBe("预填指令");
    expect(store().notice).toBe("");
  });

  it("clearDraft 只清那一格，别的线程草稿不动", () => {
    store().setDraft(CH, "a 章的字");
    store().setDraft(OTHER, "b 章的字");
    store().clearDraft(CH);
    expect(store().draftOf(CH)).toBe("");
    expect(store().draftOf(OTHER)).toBe("b 章的字");
  });

  it("/clear 清的是历史显示，绝不清掉输入框里还没发出去的草稿", async () => {
    await openChapter();
    store().setDraft(CH, "还没发出去的一句话");
    store().clearThreadView(CH);
    expect(store().draftOf(CH)).toBe("还没发出去的一句话");
  });

  // 排队三支（评审 X1 的数据丢失教训）在 store 侧的钉子。接线层 composables/useHotkeys 是 DOM 绑的、
  // 本仓零 jsdom，所以这里钉的是「接线照抄的那条调用形状」在 store 上的真实结果：
  // 先问 queueText 拿 accepted，再拿 composerTextAfterQueue(text, accepted) 回写 setDraft。
  // 若实现改成「先清草稿再入队」「同一条推进队两次」「满了也照清」，下面两条例子必红。
  it("排队被受理 ⇒ queued 只多这一条（不双写），回写值是空串（清草稿发生在入队之后）", () => {
    const agent = store();
    agent.setDraft(CH, "把第二段改短");
    const text = agent.draftOf(CH);
    const accepted = agent.queueText(CH, text);
    // 入队本身一格都不许动输入框：清空只能来自下面那次显式回写（「先清后问」在这里就会红）。
    expect(agent.draftOf(CH)).toBe(text);
    agent.setDraft(CH, composerTextAfterQueue(text, accepted));
    expect(accepted).toBe(true);
    expect(agent.threads[CH]?.queued).toEqual(["把第二段改短"]);
    expect(agent.draftOf(CH)).toBe("");
  });

  it("排队满额被拒 ⇒ queued 一字不加、草稿逐字节留在原格（提示要用户重发的字没被删）", () => {
    const agent = store();
    // 满额条数由 QUEUED_MAX 推导（不留第二份「5」）：种队列与期望吃同一份数组。
    const seeded = Array.from({ length: QUEUED_MAX }, (_, index) => `第${index + 1}条`);
    for (const text of seeded) agent.queueText(CH, text);
    const draft = "   满额后按下的这句\n带前导空格与末尾换行";
    agent.setDraft(CH, draft);
    const accepted = agent.queueText(CH, draft);
    // 被拒的一刻草稿必须原封不动还在原格：回写之前它一个字都不许被顺手清掉或 Trim 掉。
    expect(agent.draftOf(CH)).toBe(draft);
    agent.setDraft(CH, composerTextAfterQueue(draft, accepted));
    expect(accepted).toBe(false);
    expect(agent.threads[CH]?.queued).toEqual(seeded);
    expect(agent.draftOf(CH)).toBe(draft);
  });

  // ===== F3（评审 Important 3）：发送被拒把用户刚打的字原样还回这一格 =====
  // send 自己不清草稿；两个入口（CenterColumn.onComposerSend / useHotkeys 的 submit 支）发送后同步
  // clearDraft 是「乐观清空」。被拒时 store.send 的 .catch 要把这句还回来——所以下面每例都照实复现
  // 「send → clearDraft」这一对入口动作，再断言 .catch 的回写结果。

  it("startTurn 被拒 ⇒ 把用户这一格刚乐观清掉的字原样还回（且 notice 仍是那句启动失败）", async () => {
    await openChapter();
    startTurn.mockImplementationOnce(async () => {
      throw new Error("模型未配置");
    });
    store().setDraft(CH, "铁锈味的海雾");
    store().send("铁锈味的海雾");
    store().clearDraft(CH); // 入口的乐观清空（真身保持原位，见 F3 实现）
    await vi.runAllTimersAsync();
    expect(store().draftOf(CH)).toBe("铁锈味的海雾");
    // 钉 notice 没被换成静默：仍是那句「这一轮没能启动：…」
    expect(store().notice).toContain("这一轮没能启动");
  });

  it("失败回执回来之前用户又打了字 ⇒ 不许覆盖新输入", async () => {
    await openChapter();
    startTurn.mockImplementationOnce(async () => {
      throw new Error("模型未配置");
    });
    store().setDraft(CH, "铁锈味的海雾");
    store().send("铁锈味的海雾");
    store().clearDraft(CH);
    // 用户在 .catch 回来之前重新打了一句：回写必须看到非空草稿而放弃。
    store().setDraft(CH, "新的半句");
    await vi.runAllTimersAsync();
    expect(store().draftOf(CH)).toBe("新的半句");
  });

  it("send 成功路径不回填草稿（startTurn resolve + turn-start 正常推送后这一格仍空）", async () => {
    await openChapter();
    store().startListening();
    store().setDraft(CH, "要发出去的一句");
    store().send("要发出去的一句"); // 默认桩 resolve { turnId: "t1" }，不进 .catch
    store().clearDraft(CH);
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    await vi.runAllTimersAsync();
    expect(store().draftOf(CH)).toBe("");
  });

  // ===== 控制方真机实测补的第二条通路（实例 9228，2026-10-03 17:0x）=====
  // 主进程把「尚未打开作品目录 / 还没有配置模型服务 / 还没有保存 API Key」以及 try 里的一切异常
  // 都转成事件（agent-service.ts 的三个 pre-flight 分支 + 它的 catch），startTurn 照样 resolve。
  // 所以真机上吞字走的是 turn-end{failed}，不是 promise 拒绝——上面两例只钉住了拒绝支。
  // 判「这一轮到底进没进转录」的唯一凭据是它有没有发过 user-message：发过 ⇒ 字已在中栏，不许重复回填。

  it("pre-flight 失败（turn-start → turn-end{failed}，该轮从未出现 user-message）⇒ 文本还回这一格", async () => {
    await openChapter();
    store().startListening();
    store().setDraft(CH, "铁锈味的海雾");
    store().send("铁锈味的海雾");
    store().clearDraft(CH); // 入口的乐观清空
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    push({
      type: "turn-end",
      turnId: "t1",
      threadKey: CH,
      status: "failed",
      message: "还没有配置模型服务：请在设置里填写 baseURL 与模型名。"
    });
    await vi.runAllTimersAsync();
    expect(store().draftOf(CH)).toBe("铁锈味的海雾");
  });

  it("该轮已经出现 user-message（字已在转录里）⇒ 失败也不回填，草稿保持空", async () => {
    await openChapter();
    store().startListening();
    store().setDraft(CH, "铁锈味的海雾");
    store().send("铁锈味的海雾");
    store().clearDraft(CH);
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("user-message", { text: "铁锈味的海雾" })
    });
    push({
      type: "turn-end",
      turnId: "t1",
      threadKey: CH,
      status: "failed",
      message: "流式连接中断。"
    });
    await vi.runAllTimersAsync();
    expect(store().draftOf(CH)).toBe("");
  });

  it("用户刚打的字 pre-flight 失败要还回草稿，绝不许把它塞进输入框", async () => {
    await openChapter();
    store().startListening();
    // 第一轮：用户的话 pre-flight 失败 ⇒ 还回草稿，并把线程推进到 endedAs=failed。
    store().setDraft(CH, "铁锈味的海雾");
    store().send("铁锈味的海雾");
    store().clearDraft(CH);
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    push({
      type: "turn-end",
      turnId: "t1",
      threadKey: CH,
      status: "failed",
      message: "还没有配置模型服务：请在设置里填写 baseURL 与模型名。"
    });
    await vi.runAllTimersAsync();
    expect(store().draftOf(CH)).toBe("铁锈味的海雾");
  });
});
