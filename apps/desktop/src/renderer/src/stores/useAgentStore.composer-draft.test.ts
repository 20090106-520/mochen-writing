import { describe, expect, it } from "vitest";
import { composerTextAfterQueue } from "../utils/hotkey-queue";
import { QUEUED_MAX } from "./useAgentStore";
import { CH, OTHER, openChapter, setupAgentFixture, store } from "./agent-store-fixture";

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
    // 已有字 ⇒ 再预填被挡，草稿一字不改，且写一句中文（错误可见，不静默）
    store().prefillComposer(CH, "第二条预填指令");
    expect(store().draftOf(CH)).toBe("我想改这一章：先读它，再给我三处可以动的地方。");
    expect(store().notice).toContain("预填");
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
    for (let index = 0; index < QUEUED_MAX; index += 1) agent.queueText(CH, `第${index + 1}条`);
    const draft = "   满额后按下的这句\n带前导空格与末尾换行";
    agent.setDraft(CH, draft);
    const accepted = agent.queueText(CH, draft);
    // 被拒的一刻草稿必须原封不动还在原格：回写之前它一个字都不许被顺手清掉或 Trim 掉。
    expect(agent.draftOf(CH)).toBe(draft);
    agent.setDraft(CH, composerTextAfterQueue(draft, accepted));
    expect(accepted).toBe(false);
    expect(agent.threads[CH]?.queued).toEqual(["第1条", "第2条", "第3条", "第4条", "第5条"]);
    expect(agent.draftOf(CH)).toBe(draft);
  });
});
