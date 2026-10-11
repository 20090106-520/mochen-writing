import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useBookStore } from "./useBookStore";
import {
  createBookApi,
  DRAFT_A,
  DRAFT_B,
  stubBookWindow,
  type BookApiFixture
} from "./book-draft-fixture";

/**
 * 「一个字都不能莫名消失」这三条（2026-10-09 全仓扫描 P0-2 / P0-3 / P0-6）。
 *
 * P0-2：保存那次 IPC 抛错时，`saving` 曾永久停在 true —— 手动按钮被禁用、自动保存被自己挡住，
 * 而屏上还是「已自动保存」的样子，用户此后写的每一个字都只在内存里。
 * P0-3：关标签曾直接 `delete draftsByPath[relPath]`，全程不查 `dirty`。
 * P0-6：退出前没有任何落盘兜底。
 *
 * 判定真身在 `utils/draft-flush`（那边另有纯函数用例）；这一组钉的是 **store 接线**：
 * 判定结果有没有真的变成 saving / notice / 标签 / 存档的落点。
 */
let fx: BookApiFixture;

beforeEach(() => {
  setActivePinia(createPinia());
  fx = createBookApi();
  stubBookWindow(fx);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function openedStore() {
  const store = useBookStore();
  await store.openBook("/book");
  await store.openDocTab(DRAFT_A);
  return store;
}

describe("P0-2：保存失败的落点", () => {
  it("IPC 抛错：saving 归位 false、理由上屏、dirty 保持 true（字还在内存里就是还脏）", async () => {
    const store = await openedStore();
    store.onEdit("刚写的一段\n");
    fx.writeDoc.mockRejectedValueOnce(new Error("EPERM: resource busy or locked"));

    await store.saveActive();

    expect(store.saving).toBe(false);
    expect(store.notice).toContain("EPERM: resource busy or locked");
    expect(store.dirty).toBe(true);
    expect(store.draft).toBe("刚写的一段\n");
  });

  it("IPC 抛错之后，自动保存照旧会再试一次（旧行为是永久打死这条通路）", async () => {
    const store = await openedStore();
    store.onEdit("第一笔\n");
    fx.writeDoc.mockRejectedValueOnce(new Error("EBUSY"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(fx.writeDoc).toHaveBeenCalledTimes(1);

    // 关键在这一步：失败之后再有键入，排程必须重新起来。
    store.onEdit("第一笔加一段\n");
    await vi.advanceTimersByTimeAsync(2000);
    expect(fx.writeDoc).toHaveBeenCalledTimes(2);
    expect(store.saving).toBe(false);
  });

  it("抛错之后不许自己再排下一次：持续失败的盘（EBUSY）不能变成每两秒一次的写盘风暴", async () => {
    const store = await openedStore();
    store.onEdit("第一笔\n");
    fx.writeDoc.mockRejectedValue(new Error("EBUSY: resource busy or locked"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(fx.writeDoc).toHaveBeenCalledTimes(1);
    // 没有新编辑就不会有新尝试——这条既有约定，抛错分支跟 ok:false 分支都得守。
    await vi.advanceTimersByTimeAsync(20000);
    expect(fx.writeDoc).toHaveBeenCalledTimes(1);
    expect(store.saving).toBe(false);
    expect(store.dirty).toBe(true);
  });

  it("手动保存按钮在 IPC 抛错之后仍可再点（saving=false 是唯一凭据）", async () => {
    const store = await openedStore();
    store.onEdit("写一点\n");
    fx.writeDoc.mockRejectedValueOnce(new Error("EACCES"));
    await store.saveActive();
    fx.writeDoc.mockResolvedValueOnce({ ok: true, fingerprint: "fp-ok", backupRelPath: null });

    await store.saveActive();

    expect(fx.writeDoc).toHaveBeenCalledTimes(2);
    expect(store.dirty).toBe(false);
    expect(store.savedFingerprint).toBe("fp-ok");
  });

  it("主进程返回 io-error（不是抛错）时理由同样上屏，指纹绝不前进", async () => {
    const store = await openedStore();
    const before = store.savedFingerprint;
    store.onEdit("写一点\n");
    fx.writeDoc.mockResolvedValueOnce({
      ok: false,
      reason: "io-error",
      message: "写 01-a.md 失败（ENOSPC），旧稿保持原样，没有写成半截。"
    });

    await store.saveActive();

    expect(store.notice).toContain("ENOSPC");
    expect(store.saving).toBe(false);
    expect(store.dirty).toBe(true);
    expect(store.savedFingerprint).toBe(before);
  });
});

describe("P0-3：关标签不再静默丢草稿", () => {
  it("脏的活动标签：先把这一篇落盘，写成功了才真的关掉", async () => {
    const store = await openedStore();
    store.onEdit("还没保存的字\n");

    const outcome = await store.closeTab(DRAFT_A);

    expect(outcome.ok).toBe(true);
    expect(fx.writeDoc.mock.calls[0]).toEqual([DRAFT_A, "还没保存的字\n", "fp-a"]);
    expect(store.docTabs).toEqual([]);
    expect(store.activeDocTab).toBeNull();
  });

  it("落盘失败：标签留在原处、正文一个字不少、理由上屏", async () => {
    const store = await openedStore();
    store.onEdit("还没保存的字\n");
    fx.writeDoc.mockRejectedValueOnce(new Error("EPERM: 磁盘忙"));

    const outcome = await store.closeTab(DRAFT_A);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("没落成盘却判成关得掉，那几个字当场就没了");
    expect(store.docTabs).toEqual([DRAFT_A]);
    expect(store.activeDocTab).toBe(DRAFT_A);
    expect(store.draft).toBe("还没保存的字\n");
    expect(store.dirty).toBe(true);
    expect(store.notice).toContain("磁盘忙");
  });

  it("关的不是当前那一格：用它自己存档里的稿子与指纹落盘", async () => {
    const store = await openedStore();
    store.onEdit("甲篇的字\n");
    await store.openDocTab(DRAFT_B);
    store.onEdit("乙篇的字\n");
    fx.writeDoc.mockClear();

    const outcome = await store.closeTab(DRAFT_A);

    expect(outcome.ok).toBe(true);
    expect(fx.writeDoc.mock.calls[0]).toEqual([DRAFT_A, "甲篇的字\n", "fp-a"]);
    // 当前这一格（乙）不受牵连：它的未保存字一个都不动。
    expect(store.activeDocTab).toBe(DRAFT_B);
    expect(store.draft).toBe("乙篇的字\n");
    expect(store.dirty).toBe(true);
  });

  it("非活动标签落盘失败：它自己不许被删，活动那一格的脏稿照样留着", async () => {
    const store = await openedStore();
    store.onEdit("甲篇的字\n");
    await store.openDocTab(DRAFT_B);
    store.onEdit("乙篇的字\n");
    fx.writeDoc.mockRejectedValueOnce(new Error("ENOSPC"));

    const outcome = await store.closeTab(DRAFT_A);

    expect(outcome.ok).toBe(false);
    expect(store.docTabs).toEqual([DRAFT_A, DRAFT_B]);
    expect(store.draftsByPath[DRAFT_A]?.draft).toBe("甲篇的字\n");
    expect(store.draftsByPath[DRAFT_A]?.dirty).toBe(true);
  });

  it("干净的标签照旧直接关，一个写盘 IPC 都不发", async () => {
    const store = await openedStore();
    await store.openDocTab(DRAFT_B);

    const outcome = await store.closeTab(DRAFT_A);

    expect(outcome.ok).toBe(true);
    expect(fx.writeDoc).not.toHaveBeenCalled();
    expect(store.docTabs).toEqual([DRAFT_B]);
  });

  it("指纹冲突未处理的标签：绝不替用户覆盖外部改动，也就不关", async () => {
    const store = await openedStore();
    store.onEdit("还没保存的字\n");
    fx.writeDoc.mockResolvedValueOnce({ ok: false, reason: "stale", currentFingerprint: "fp-x" });
    await store.saveActive();
    expect(store.conflict).not.toBeNull();

    const outcome = await store.closeTab(DRAFT_A);

    expect(outcome.ok).toBe(false);
    expect(store.notice).toContain("冲突");
    expect(store.docTabs).toEqual([DRAFT_A]);
  });

  it("关标签落盘成功后：这一格的存档作废，重开时按盘上真身重读（不吃旧存档）", async () => {
    const store = await openedStore();
    store.onEdit("落盘的字\n");
    await store.closeTab(DRAFT_A);
    expect(store.docTabs).toEqual([]);

    await store.openDocTab(DRAFT_A);

    expect(store.dirty).toBe(false);
    expect(store.draft).toBe("正文\n");
  });
});

describe("P0-6：退出前的落盘兜底", () => {
  it("每一篇脏稿都先落盘；全成就 ok，主进程才放行退出", async () => {
    const store = await openedStore();
    store.onEdit("甲篇的字\n");
    await store.openDocTab(DRAFT_B);
    store.onEdit("乙篇的字\n");

    const result = await store.flushAllForQuit();

    expect(result.ok).toBe(true);
    expect(fx.writeDoc.mock.calls.map((c) => c[0])).toEqual([DRAFT_A, DRAFT_B]);
    expect(store.dirty).toBe(false);
  });

  it("有一篇落不下去：点名是哪一篇、为什么，其余的照旧救回来", async () => {
    const store = await openedStore();
    store.onEdit("甲篇的字\n");
    await store.openDocTab(DRAFT_B);
    store.onEdit("乙篇的字\n");
    fx.writeDoc.mockRejectedValueOnce(new Error("EPERM: 磁盘忙"));

    const result = await store.flushAllForQuit();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("有一篇没落盘却报成安全退出");
    expect(result.blocked.map((one) => one.relPath)).toEqual([DRAFT_A]);
    expect(result.blocked[0]?.message).toContain("磁盘忙");
    expect(store.dirty).toBe(false);
  });

  it("兜底写完之后，挂起的那次自动保存不许再发：退出时同一篇不能被写第二遍", async () => {
    const store = await openedStore();
    store.onEdit("刚写的字\n");

    const result = await store.flushAllForQuit();

    expect(result.ok).toBe(true);
    expect(fx.writeDoc).toHaveBeenCalledTimes(1);
    // 静默窗本来 2 秒后就该再来一次；`cancelAutoSave()` 没做，这里就变成 2 次。
    await vi.advanceTimersByTimeAsync(20000);
    expect(fx.writeDoc).toHaveBeenCalledTimes(1);
  });

  it("全都没有未保存的字：不发写盘，直接放行", async () => {
    const store = await openedStore();

    const result = await store.flushAllForQuit();

    expect(result.ok).toBe(true);
    expect(fx.writeDoc).not.toHaveBeenCalled();
  });
});

describe("P0-6 接线：主进程拦下的那一次", () => {
  it("收到「先把稿子落盘」：每篇脏稿真的落盘，回程递 { ok: true, blocked: [] }", async () => {
    const store = await openedStore();
    store.listenQuitFlush();
    store.onEdit("甲篇的字\n");
    await store.openDocTab(DRAFT_B);
    store.onEdit("乙篇的字\n");

    fx.quitRequests[0]?.();
    await vi.advanceTimersByTimeAsync(1);

    expect(fx.writeDoc.mock.calls.map((call) => call[0])).toEqual([DRAFT_A, DRAFT_B]);
    expect(fx.quitFlushDone.mock.calls.map((call) => call[0])).toEqual([{ ok: true, blocked: [] }]);
  });

  it("有一篇落不下去：回程点名是哪一篇、为什么——主进程据此问人，而不是自己猜", async () => {
    const store = await openedStore();
    store.listenQuitFlush();
    store.onEdit("甲篇的字\n");
    fx.writeDoc.mockRejectedValueOnce(new Error("EPERM: 磁盘忙"));

    fx.quitRequests[0]?.();
    await vi.advanceTimersByTimeAsync(1);

    const reply = fx.quitFlushDone.mock.calls[0]?.[0];
    expect(reply?.ok).toBe(false);
    expect(reply?.blocked.map((one: { relPath: string }) => one.relPath)).toEqual([DRAFT_A]);
    expect(reply?.blocked[0]?.message).toContain("磁盘忙");
    // 屏上同一条话也要有：用户回来点开窗口得知道刚才那次为什么没走成。
    expect(store.notice).toContain("磁盘忙");
  });

  it("重复装配只订阅一次：叠两层的后果是一次关闭落两遍盘、回两条话", async () => {
    const store = await openedStore();
    store.listenQuitFlush();
    store.listenQuitFlush();

    // 原先这条钉的是 `onQuitFlushRequest` 只被调了一次——那是机制的代理指标。
    // 换成句柄判据之后装配走的是「先摘旧再订新」，调用次数会变成两次，而标题里那句后果才是真要求：
    // 活着的监听只许有一只，点火一次只落一遍盘。量后果，别量代理。
    expect(fx.quitRequests).toHaveLength(1);
    store.onEdit("重复装配之后写的字\n");
    fx.quitRequests[0]?.();
    await vi.advanceTimersByTimeAsync(1);

    expect(fx.writeDoc).toHaveBeenCalledTimes(1);
    expect(fx.quitFlushDone).toHaveBeenCalledTimes(1);
  });

  it("书还没打开（没有一篇可落）：直接回 ok，别让主进程白等一趟超时", async () => {
    const store = useBookStore();
    store.listenQuitFlush();

    fx.quitRequests[0]?.();
    await vi.advanceTimersByTimeAsync(1);

    expect(fx.writeDoc).not.toHaveBeenCalled();
    expect(fx.quitFlushDone.mock.calls.map((call) => call[0])).toEqual([{ ok: true, blocked: [] }]);
  });

  /**
   * 下面三条钉的是**句柄有没有落地**（2026-10-11 收口，台账 `README.md:12` 那一族的第二处）。
   *
   * 原先那格存的是布尔，而 `installQuitFlushListener()` 交回的那只退订函数直接丢在地上——
   * preload 按引用摘 listener，只有这一只能摘掉已订的那一只（`preload/renderer-api.ts` 的 `createIpcOn`）。
   * 布尔版本下第三条是红的：订阅被摘走之后布尔还写着「在听」，重装配被静默跳过，握手就此永久断掉，
   * 用户点关闭时一个字都不会落盘。现在装配走「先摘旧再订新」，同一格既是判据也是摘法。
   */
  it("装配之后 store 里存的是那只退订函数，不是布尔", () => {
    const store = useBookStore();
    store.listenQuitFlush();

    expect(typeof store.quitFlushOff).toBe("function");
  });

  it("用存下的那只退订：监听真的从 preload 面上摘掉了，此后再无兜底与答话", async () => {
    const store = await openedStore();
    store.listenQuitFlush();

    store.quitFlushOff?.();
    expect(fx.quitRequests).toHaveLength(0);
    // 同一只再摘一次不许抛：preload 的 `removeListener` 对没挂上的引用是无操作。
    store.quitFlushOff?.();

    store.onEdit("退订之后写的字\n");
    // 只给「现在还活着的」监听点火。攥着摘掉之前那只旧闭包直接调一次是假场景——
    // 真身已被摘走，它在产品里再也收不到推送；量到的是测试自己留的后门，不是退订生效。
    fx.quitRequests.forEach((fire) => fire());
    await vi.advanceTimersByTimeAsync(1);

    expect(fx.writeDoc).not.toHaveBeenCalled();
    expect(fx.quitFlushDone).not.toHaveBeenCalled();
  });

  it("摘掉之后重新装配要真的重订：布尔判据在这儿会装作还在听，握手就此永久断掉", async () => {
    const store = await openedStore();
    store.listenQuitFlush();
    // 外部把订阅摘走（将来的窗口销毁通路、或任何按句柄退订的代码）。
    store.quitFlushOff?.();
    // 这条不是重复上一条用例：少了它，下面「重订成一只」在布尔版本里也会**通过**——
    // 因为那句 `?.()` 静默什么都不做，旧的监听从头到尾没被摘掉过，数目看着正好。
    expect(fx.quitRequests).toHaveLength(0);

    store.listenQuitFlush();
    expect(fx.quitRequests).toHaveLength(1);

    store.onEdit("重订之后写的字\n");
    fx.quitRequests[0]?.();
    await vi.advanceTimersByTimeAsync(1);
    expect(fx.writeDoc).toHaveBeenCalledTimes(1);
  });
});
