import { describe, expect, it } from "vitest";
import { PERMISSION_LABELS } from "@mochen/contracts";
import { CLEAR_VIEW_SENTENCE, composeStatusReport, newThread, UNBOUND } from "./useAgentStore";
import { useBookStore } from "./useBookStore";
import { useLayoutStore } from "./layoutStore";
import { NO_BOOK_CHIP_LABEL } from "../utils/permission-chip";
// 与 useAgentStore.test.ts 共用夹具（D2 的拆分先例）：本文件是 Task 8 新增的 `/` 面板动作断言，
// 主文件已 674 行、再挂 7 个用例会顶破 800 行门禁，故按简报第 8 条裁定拆到这一个 slash 侧文件。
import {
  CH,
  OTHER,
  eventOf,
  loadSession,
  openChapter,
  proposal,
  push,
  saveMeta,
  setupAgentFixture,
  store
} from "./agent-store-fixture";

setupAgentFixture();

describe("useAgentStore · / 面板动作", () => {
  it("/clear 只清渲染层：视图空、hydrated 置真、其它线程不动、也不再被自动水合倒回来", async () => {
    await openChapter();
    store().startListening();
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("user-message", { id: "e-a", text: "改紧" })
    });
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("message", { id: "e-b", text: "好", interrupted: false })
    });
    push({
      type: "event",
      turnId: "t9",
      threadKey: OTHER,
      event: eventOf("user-message", { id: "e-other", text: "别动" })
    });
    expect(store().viewOf(CH).items.length).toBe(2);
    expect(store().viewOf(CH).hydrated).toBe(false);
    loadSession.mockClear();

    store().runSlashCommand("clear", "");

    expect(store().viewOf(CH).items.length).toBe(0);
    expect(store().viewOf(CH).hydrated).toBe(true);
    expect(store().notice).toBe(CLEAR_VIEW_SENTENCE);
    expect(store().viewOf(OTHER).items.length).toBe(1);
    // hydrated 置真的意义：Task 5 的三处时机不会把刚清空的内容倒回来
    await store().ensureHydrated(CH);
    expect(loadSession).not.toHaveBeenCalled();
    expect(store().viewOf(CH).items.length).toBe(0);
  });

  it("/clear 有 pending 卡时必须把代价说清楚，并把卡一起从页面上摘掉", async () => {
    await openChapter();
    store().startListening();
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("proposal", { id: "e-p", proposal: proposal("p-clear") })
    });
    expect(store().pendingOf(CH)).toBe(1);

    store().runSlashCommand("clear", "");

    expect(store().pendingOf(CH)).toBe(0);
    expect(store().notice).toBe(
      `${CLEAR_VIEW_SENTENCE} 本页还有 1 条待审批提案，清空后这一轮里点不到它们；重启后会以「上次会话未处理」回来。`
    );
  });

  it("排队指令不属于显示内容：/clear 不动 queued", async () => {
    await openChapter();
    expect(store().queueText(CH, "第二条")).toBe(true);
    store().runSlashCommand("clear", "");
    expect(store().viewOf(CH).queued).toEqual(["第二条"]);
  });

  it("/status 写状态条的是整句报告，未回放与已回放两种口径分开", () => {
    const replayed = newThread();
    replayed.hydrated = true;
    replayed.items = [
      eventOf("user-message", { id: "e-a", text: "改紧" }),
      eventOf("message", { id: "e-b", text: "好", interrupted: false })
    ];
    expect(
      composeStatusReport({
        threadKey: CH,
        thread: replayed,
        cards: 2,
        pending: 1,
        hasBook: true,
        permissionMode: "read-only",
        stageName: "正文"
      })
    ).toBe(
      `状态 · 线程 ${CH} · 历史已回放（2 条） · 提案 2 张（待审 1 张） · 排队 0 条 · 权限档：只读参考 · 阶段：正文 · 用量：还没有上游回报过（本会话 1 轮都没报）。 · 尚无收尾记录`
    );

    // UNBOUND 线程就是「没开书」的形状：这一格不再兜底成任何档位名（旧期望写的是「只读参考」，
    // 那正是被捏造出来的档位，改它是修缺陷不是改测试迁就实现）。
    expect(
      composeStatusReport({
        threadKey: UNBOUND,
        thread: undefined,
        cards: 0,
        pending: 0,
        hasBook: false,
        permissionMode: null,
        stageName: "无"
      })
    ).toBe(
      "状态 · 线程 未绑定文稿 · 历史未回放（本页 0 条） · 提案 0 张（待审 0 张） · 排队 0 条 · " +
        `权限档：${NO_BOOK_CHIP_LABEL} · 阶段：无 · 还没有这一条线程`
    );

    const interrupted = newThread();
    interrupted.endedAs = "interrupted";
    expect(
      composeStatusReport({
        threadKey: CH,
        thread: interrupted,
        cards: 0,
        pending: 0,
        hasBook: true,
        permissionMode: "chapter-write",
        stageName: "正文"
      })
    ).toContain("上一轮已打断，可继续");
  });

  it("/status 走的是当前线程与 book.meta 的真实数字", async () => {
    await openChapter();
    store().startListening();
    push({
      type: "event",
      turnId: "t1",
      threadKey: CH,
      event: eventOf("proposal", { id: "e-p2", proposal: proposal("p-status") })
    });
    store().runSlashCommand("status", "");
    // 夹具的 meta：permissionMode 是 chapter-write、阶段 draft=正文
    expect(store().notice).toBe(
      `状态 · 线程 ${CH} · 历史未回放（本页 1 条） · 提案 1 张（待审 1 张） · 排队 0 条 · 权限档：可改当前章 · 阶段：正文 · 尚无收尾记录`
    );
  });

  /**
   * 缺陷② 在 `/status` 这一面的对应（评审 T2-3）：状态条的权限档文案同样只经 permissionChipView。
   * 无书时旧实现走 `PERMISSION_LABELS[... ?? DEFAULT_PERMISSION_MODE]`，照样播报「只读参考」——
   * 与本任务要杀的是同一句谎言，只是另一个表面。反向那条循环把「任何档位名都不许出现」钉死。
   */
  it("无书时 /status 不捏造档位名：权限档那一格报「未打开作品目录」", () => {
    store().runSlashCommand("status", "");
    const notice = store().notice;
    expect(notice).toBe(
      "状态 · 线程 未绑定文稿 · 历史未回放（本页 0 条） · 提案 0 张（待审 0 张） · 排队 0 条 · " +
        `权限档：${NO_BOOK_CHIP_LABEL} · 阶段：无 · 还没有这一条线程`
    );
    for (const label of Object.values(PERMISSION_LABELS)) expect(notice).not.toContain(label);
  });

  it("/resume 走 ensureHydrated，/model 走 layout.showSettings（面板不自己实现任何事）", async () => {
    await openChapter();
    loadSession.mockClear();
    store().runSlashCommand("resume", "");
    expect(loadSession).toHaveBeenCalledTimes(1);
    store().runSlashCommand("model", "");
    expect(useLayoutStore().currentView).toBe("settings");
  });

  it("/permissions 不带档名只把档位菜单打开，不写盘也不改 meta", async () => {
    const bookStore = useBookStore();
    await bookStore.openBook("/book");
    saveMeta.mockClear();
    store().runSlashCommand("permissions", "");
    expect(bookStore.permissionMenuOpen).toBe(true);
    expect(saveMeta).not.toHaveBeenCalled();
    bookStore.closePermissionMenu();
    expect(bookStore.permissionMenuOpen).toBe(false);
  });

  it("/permissions 带档名直接调 saveMeta，带错档名只给一句中文且不写盘", async () => {
    const bookStore = useBookStore();
    await bookStore.openBook("/book");
    saveMeta.mockClear();

    store().runSlashCommand("permissions", "全开");
    expect(saveMeta).toHaveBeenCalledTimes(1);
    expect(saveMeta.mock.calls[0]?.[0]).toMatchObject({ permissionMode: "full-access" });

    bookStore.closePermissionMenu();
    store().runSlashCommand("permissions", "随意改");
    expect(store().notice).toBe("没有这一档：「随意改」。可选：只读参考 / 可改当前章 / 全开。");
    expect(saveMeta).toHaveBeenCalledTimes(1);
    expect(bookStore.permissionMenuOpen).toBe(false);
  });

  it("叫了一个不存在的阶段：给一句实话并列出可选值，不假装切了", () => {
    // 2026-10-05 起 stage 已有真通路（setActiveStage），所以「叫不到」时的回复
    // 必须换成「没有这个阶段 + 可选值」，而不是旧的「波 2 接通」那句已过期的话。
    store().runSlashCommand("stage", "正文");
    expect(store().notice).toBe("没有这个阶段：「正文」。可选：（无）。");
    expect(store().notice).not.toContain("波 2");
  });

  it("/stage 不带参数：给一句关于阶段的话，不是「按了没反应」", () => {
    // 本夹具的书没有配 stages，所以走的是「这本书还没有任何阶段」那一支。
    // 守的不变量是「永远回一句实话」：有空阶段时它报当前阶段 + 可选值，
    // 没阶段时它说没有——两条都不许变成空 notice。
    store().runSlashCommand("stage", "");
    expect(store().notice).not.toBe("");
    expect(store().notice).toContain("阶段");
  });
});
