import { describe, expect, it } from "vitest";
import type { AgentEvent, SessionLoadResult } from "@mochen/contracts";
import {
  CH,
  OTHER,
  eventOf,
  itemsOf,
  listSessions,
  loadSession,
  openChapter,
  proposal,
  push,
  setSessionResult,
  setupAgentFixture,
  store
} from "./agent-store-fixture";
import { useBookStore } from "./useBookStore";
import { MISSING_DOC_ROW_REASON, UNBOUND_ROW_REASON } from "../utils/session-row-action";

// #113e 历史对话面板的数据源与切换动作。独立成文件：useAgentStore.ts 的 800 行门禁已经把
// 水合用例拆过一次（D2），这里继续按主题分文件，共用同一套夹具。
setupAgentFixture();

/** 面板里的一行：这里只关心 sessionId 与它属于哪条线程。 */
const rowOf = (sessionId: string, docRelPath: string) => ({
  sessionId,
  docRelPath,
  model: "mochen-mock",
  startedAt: "2026-10-01T00:00:00.000Z",
  title: "改紧一点"
});

/** 指名回放的结果：`loaded()` 的 meta 里 sessionId 恒为 s1，测「读回的是哪一条」必须自己写 meta。 */
function named(sessionId: string, events: AgentEvent[]): SessionLoadResult {
  return {
    found: true,
    relPath: `.mochen/sessions/${sessionId}.jsonl`,
    meta: {
      type: "session-meta",
      sessionId,
      docRelPath: CH,
      stageId: "draft",
      model: "mochen-mock",
      startedAt: "2026-10-01T00:00:00.000Z"
    },
    events,
    droppedLines: []
  };
}

describe("useAgentStore.refreshSessions（面板打开时的取数）", () => {
  it("把主进程的行原样收进 store", async () => {
    listSessions.mockResolvedValue([rowOf("s-a", CH)]);
    await store().refreshSessions();
    expect(store().sessions).toEqual([rowOf("s-a", CH)]);
  });

  it("取数失败：notice 给中文原因，已显示的行不清空（假空态比报错更坏）", async () => {
    listSessions.mockResolvedValue([rowOf("s-a", CH)]);
    await store().refreshSessions();
    listSessions.mockRejectedValueOnce(new Error("历史通道没接上"));
    await store().refreshSessions();
    expect(store().notice).toContain("历史对话没有读回来");
    expect(store().notice).toContain("历史通道没接上");
    expect(store().sessions).toHaveLength(1);
  });
});

describe("useAgentStore.rowActionFor（面板每一行的当下判定）", () => {
  it("正在看的那条 = 回放记下的 sessionId；其余同章行可点", async () => {
    await openChapter();
    setSessionResult(named("s-a", [eventOf("user-message", { text: "第一轮" })]));
    await store().ensureHydrated(CH);
    expect(store().rowActionFor(rowOf("s-a", CH)).kind).toBe("current");
    expect(store().rowActionFor(rowOf("s-b", CH)).kind).toBe("open");
  });

  /** 这一条钉的是「上下文由 store 装配」：unbound 的判断用的是那份 UNBOUND 口径，不是组件自己猜。 */
  it("unbound 与已删文稿的行都禁用，理由各是各的", async () => {
    await openChapter();
    expect(store().rowActionFor(rowOf("s-0", "unbound"))).toEqual({
      kind: "disabled",
      reason: UNBOUND_ROW_REASON
    });
    expect(store().rowActionFor(rowOf("s-x", "chapters/09-删掉的章.md"))).toEqual({
      kind: "disabled",
      reason: MISSING_DOC_ROW_REASON
    });
  });

  it("回复在途：别的行切不了，正在看的那行不受影响", async () => {
    await openChapter();
    setSessionResult(named("s-a", [eventOf("user-message", { text: "第一轮" })]));
    await store().ensureHydrated(CH);
    store().startListening();
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    expect(store().rowActionFor(rowOf("s-b", CH))).toEqual({
      kind: "disabled",
      reason: "回复完成或停止后可切换。"
    });
    expect(store().rowActionFor(rowOf("s-a", CH)).kind).toBe("current");
  });
});

describe("useAgentStore.showSession（点一行 = 切过去接着聊）", () => {
  it("同章较早那条：视图换成它的事件，写入目标跟着改", async () => {
    await openChapter();
    setSessionResult(named("s-new", [eventOf("user-message", { id: "e-new", text: "最近那条" })]));
    await store().ensureHydrated(CH);
    expect(itemsOf(CH).map((e) => e.id)).toEqual(["e-new"]);

    loadSession.mockImplementationOnce(async () =>
      named("s-old", [eventOf("user-message", { id: "e-old", text: "较早那条" })])
    );
    await store().showSession(rowOf("s-old", CH));
    // 指名读：第二个实参必须是那条的 id，丢掉就退化成「最近那条」。
    expect(loadSession.mock.lastCall).toEqual([CH, "s-old"]);
    expect(itemsOf(CH).map((e) => e.id)).toEqual(["e-old"]);
    expect(store().viewOf(CH).sessionId).toBe("s-old");
    expect(store().notice).toBe("");
  });

  /** 覆盖式切换的另一半：上一条会话的提案卡不许还挂在这一页上——那是一张能点、点了必错的假卡。 */
  it("切换覆盖旧视图：上一条会话留下的提案卡不再可点", async () => {
    await openChapter();
    store().startListening();
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("proposal", { proposal: proposal("pOld") })
    });
    expect(store().proposals["pOld"]).toBeDefined();
    loadSession.mockImplementationOnce(async () =>
      named("s-old", [eventOf("user-message", { id: "e-old", text: "较早那条" })])
    );
    await store().showSession(rowOf("s-old", CH));
    expect(store().proposals["pOld"]).toBeUndefined();
  });

  it("另一章的那条：先开那一章的标签，再指名读它", async () => {
    await openChapter();
    setSessionResult(named("s-new", [eventOf("user-message", { id: "e-new", text: "最近那条" })]));
    await store().ensureHydrated(CH);
    await store().showSession(rowOf("s-other", OTHER));
    expect(useBookStore().activeDocTab).toBe(OTHER);
    expect(loadSession.mock.lastCall).toEqual([OTHER, "s-other"]);
    // 反向钉：切走的那一章的视图不能被顺手清掉——它是回来时还要看的内容。
    expect(itemsOf(CH).map((e) => e.id)).toEqual(["e-new"]);
  });

  it("unbound 那条：不读盘、不关标签，只把理由摆出来", async () => {
    await openChapter();
    loadSession.mockClear();
    await store().showSession(rowOf("s-0", "unbound"));
    expect(loadSession).not.toHaveBeenCalled();
    expect(useBookStore().docTabs).toEqual([CH]);
    expect(store().notice).toBe(UNBOUND_ROW_REASON);
  });

  it("文稿已删的那条：同样一次盘都不碰", async () => {
    await openChapter();
    loadSession.mockClear();
    await store().showSession(rowOf("s-x", "chapters/09-删掉的章.md"));
    expect(loadSession).not.toHaveBeenCalled();
    expect(store().notice).toBe(MISSING_DOC_ROW_REASON);
  });

  it("回复在途：切不了，标签与视图一字不动", async () => {
    await openChapter();
    setSessionResult(named("s-new", [eventOf("user-message", { id: "e-new", text: "最近那条" })]));
    await store().ensureHydrated(CH);
    store().startListening();
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    loadSession.mockClear();
    await store().showSession(rowOf("s-old", CH));
    expect(loadSession).not.toHaveBeenCalled();
    expect(itemsOf(CH).map((e) => e.id)).toEqual(["e-new"]);
    expect(store().notice).toBe("回复完成或停止后可切换。");
  });

  it("点的就是正在看的那条：不重复读盘", async () => {
    await openChapter();
    setSessionResult(named("s-a", [eventOf("user-message", { id: "e-a", text: "第一轮" })]));
    await store().ensureHydrated(CH);
    loadSession.mockClear();
    await store().showSession(rowOf("s-a", CH));
    expect(loadSession).not.toHaveBeenCalled();
    expect(itemsOf(CH).map((e) => e.id)).toEqual(["e-a"]);
  });

  /**
   * 切标签后组件会补一次 `ensureHydrated`（那是「最近那条」的通路）。
   * 指名回放必须已经把它置成 hydrated，否则这一补读会把刚点开的那条盖成最近那条。
   */
  it("指名回放之后组件再补一次 ensureHydrated：不重读、内容还是那一条", async () => {
    await openChapter();
    loadSession.mockImplementationOnce(async () =>
      named("s-old", [eventOf("user-message", { id: "e-old", text: "较早那条" })])
    );
    await store().showSession(rowOf("s-old", OTHER));
    expect(loadSession.mock.lastCall).toEqual([OTHER, "s-old"]);
    expect(itemsOf(OTHER).map((e) => e.id)).toEqual(["e-old"]);
    loadSession.mockClear();
    await store().ensureHydrated(OTHER);
    expect(loadSession).not.toHaveBeenCalled();
    expect(itemsOf(OTHER).map((e) => e.id)).toEqual(["e-old"]);
  });

  it("读回来是 found:false：理由进 notice，视图清空但不假装成功", async () => {
    await openChapter();
    setSessionResult(named("s-new", [eventOf("user-message", { id: "e-new", text: "最近那条" })]));
    await store().ensureHydrated(CH);
    loadSession.mockImplementationOnce(async () => ({
      found: false,
      reason: "no-session",
      message: "这本书里没有这条线程的历史。"
    }));
    await store().showSession(rowOf("s-ghost", CH));
    expect(itemsOf(CH)).toEqual([]);
    expect(store().notice).toBe("这本书里没有这条线程的历史。");
  });

  it("IPC 抛：notice 带原因，sessionId 不被改成那条的 id", async () => {
    await openChapter();
    setSessionResult(named("s-new", [eventOf("user-message", { id: "e-new", text: "最近那条" })]));
    await store().ensureHydrated(CH);
    loadSession.mockImplementationOnce(async () => {
      throw new Error("会话首行不可用（x）：坏");
    });
    await store().showSession(rowOf("s-old", CH));
    expect(store().notice).toContain("会话首行不可用");
    expect(store().viewOf(CH).sessionId).toBe("s-new");
    expect(itemsOf(CH).map((e) => e.id)).toEqual(["e-new"]);
  });
});
