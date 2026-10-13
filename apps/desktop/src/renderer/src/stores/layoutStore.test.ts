// 源自 deepwrite，同源实现其分栏测试：docs/ATTRIBUTION.md
// 仅删去本项目没有的功能导航用例（主功能高亮/视图切换）。

import { createPinia, setActivePinia, storeToRefs } from "pinia";
import { isReactive, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RIGHT_PANE_PREFERENCES_STORAGE_KEY } from "../utils/rightPanePreferences";
import {
  LEFT_PANE_MAX,
  NARROW_AUTO_COLLAPSE_WIDTH,
  RIGHT_PANE_MAX,
  defaultLeftPaneWidth,
  defaultRightPaneWidth,
  shouldAutoCollapseRightPane,
  shouldAutoCollapseRightPaneWithoutBook,
  useLayoutStore
} from "./layoutStore";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

interface RuntimeFixture {
  storage: MemoryStorage;
  animationFrames: FrameRequestCallback[];
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

function installRuntime(viewportWidth = 1400): RuntimeFixture {
  const storage = new MemoryStorage();
  const animationFrames: FrameRequestCallback[] = [];
  const addEventListener = vi.fn();
  const removeEventListener = vi.fn();
  vi.stubGlobal("window", {
    innerWidth: viewportWidth,
    localStorage: storage,
    addEventListener,
    removeEventListener,
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    }),
    cancelAnimationFrame: vi.fn(),
    getComputedStyle: vi.fn(
      () =>
        ({
          getPropertyValue: (property: string) => (property === "--center-pane-min" ? "320" : "")
        }) as CSSStyleDeclaration
    )
  } satisfies Partial<Window>);
  return { storage, animationFrames, addEventListener, removeEventListener };
}

function shell(width: number, left = 100): HTMLElement {
  return {
    getBoundingClientRect: () => ({
      x: left,
      y: 0,
      left,
      top: 0,
      right: left + width,
      bottom: 800,
      width,
      height: 800,
      toJSON: () => ({})
    })
  } as HTMLElement;
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("layout store", () => {
  it("exposes typed view switching and pane toggles through Pinia refs", async () => {
    installRuntime();
    const store = useLayoutStore();
    const refs = storeToRefs(store);

    expect(refs.currentView.value).toBe("workspace");
    expect(refs.leftPaneWidth.value).toBe(defaultLeftPaneWidth(1400));
    expect(refs.rightPaneWidth.value).toBe(defaultRightPaneWidth(1400));

    store.showSettings();
    expect(refs.currentView.value).toBe("settings");
    store.showWorkspace();
    expect(refs.currentView.value).toBe("workspace");

    store.togglePane("left");
    store.setPaneCollapsed("right", true);
    expect(refs.leftCollapsed.value).toBe(true);
    expect(refs.rightCollapsed.value).toBe(true);
    await nextTick();
    store.$dispose();
  });

  /**
   * 2026-10-05 窄窗自动折叠右栏。分三段钉，每段管一条边界：
   * 阈值本身 / 初始态 / 手动优先。只测阈值的话，把 reconcile 里的那行删掉照样全绿。
   */
  it("窄窗阈值是个纯函数：低于 NARROW_AUTO_COLLAPSE_WIDTH 才收，且阈值不小于两栏固定宽之和", () => {
    expect(shouldAutoCollapseRightPane(NARROW_AUTO_COLLAPSE_WIDTH - 1)).toBe(true);
    expect(shouldAutoCollapseRightPane(NARROW_AUTO_COLLAPSE_WIDTH)).toBe(false);
    expect(shouldAutoCollapseRightPane(1920)).toBe(false);
    // 判据是「中栏还剩得下」，所以阈值必须大于 左 262 + 右 395。
    expect(NARROW_AUTO_COLLAPSE_WIDTH).toBeGreaterThan(262 + 395);
  });

  it("窄窗一进来右栏就是收起的；宽窗不受影响", () => {
    installRuntime(1000);
    expect(useLayoutStore().rightCollapsed).toBe(true);

    // 换宽窗重来一个干净的 store —— pinia 是 active 单例，不重建会拿到上面那个。
    setActivePinia(createPinia());
    installRuntime(1600);
    expect(useLayoutStore().rightCollapsed).toBe(false);
  });

  it("用户手动动过右栏就把闸门上锁：此后窗口再窄也不自动干预（只收不展那条同理——reconcile 里没有展开分支）", async () => {
    installRuntime(1000);
    const store = useLayoutStore();
    const refs = storeToRefs(store);
    expect(refs.rightCollapsed.value, "窄窗初始应自动收起").toBe(true);
    expect(refs.rightPaneManuallyToggled.value, "初始不该算手动").toBe(false);

    // 用户自己把它展开 —— 即使视口仍窄，也不再被按回去。
    store.togglePane("right");
    expect(refs.rightCollapsed.value).toBe(false);
    expect(refs.rightPaneManuallyToggled.value).toBe(true);

    store.reconcilePaneWidths();
    await nextTick();
    expect(refs.rightCollapsed.value, "手动意图优先，自动策略不得推翻").toBe(false);
    store.$dispose();
  });

  /**
   * 2026-10-11 没打开作品时收右栏。同样分三段钉，每段管一条边界：
   * 判据本身 / 空作品确实收 / 手动优先与只收不展。
   * 只测判据的话，把 App.vue 里那条 watch 删掉照样全绿——所以第二段量的是 store 的真实行为。
   */
  it("判据是个纯函数：没有作品一律收，与视口宽窄无关；有作品则退回窄窗那条", () => {
    // 无作品时无论多宽都收：那一格摆出来的是「点一篇文稿就能在这儿写」，没有一个像素有用。
    expect(shouldAutoCollapseRightPaneWithoutBook(1920, false)).toBe(true);
    expect(shouldAutoCollapseRightPaneWithoutBook(1000, false)).toBe(true);
    // 有作品时不得比窄窗那条更激进（否则就把既有行为改了）。
    expect(shouldAutoCollapseRightPaneWithoutBook(1000, true)).toBe(
      shouldAutoCollapseRightPane(1000)
    );
    expect(shouldAutoCollapseRightPaneWithoutBook(1920, true)).toBe(false);
  });

  it("无作品时确实把右栏收起来：宽窗进来也是收的（此前宽窗是展开的）", () => {
    installRuntime(1920);
    const store = useLayoutStore();
    const refs = storeToRefs(store);
    // 宽窗 + 无作品：既有窄窗判据为假，右栏本该是展开的。
    expect(refs.rightCollapsed.value, "宽窗起步不该被窄窗判据收起").toBe(false);
    // 装配层在挂载与每次 hasBook 变化时打这一下。
    store.setRightCollapsedByEmptyBook(shouldAutoCollapseRightPaneWithoutBook(1920, false));
    expect(refs.rightCollapsed.value, "无作品时右栏必须收").toBe(true);
    store.$dispose();
  });

  it("手动优先 + 只收不展：用户折过就交权；有作品时也不擅自把右栏推回来", () => {
    installRuntime(1920);
    const store = useLayoutStore();
    const refs = storeToRefs(store);

    // ① 手动交权：宽窗起步右栏是展开的，用户手动折过一次后闸门上锁。
    expect(refs.rightCollapsed.value).toBe(false);
    store.togglePane("right");
    expect(refs.rightCollapsed.value, "手动折起应生效").toBe(true);
    expect(refs.rightPaneManuallyToggled.value).toBe(true);
    // 用户又自己展开——此后自动策略不得再把它按下去，哪怕此刻没有作品。
    store.togglePane("right");
    expect(refs.rightCollapsed.value).toBe(false);
    store.setRightCollapsedByEmptyBook(true);
    expect(refs.rightCollapsed.value, "手动意图优先，自动策略不得推翻").toBe(false);

    // ② 只收不展：判据转假（打开作品）时，store 这一层什么都不做。
    //    展开是用户的动作，不该由「书打开了」替他决定。
    setActivePinia(createPinia());
    installRuntime(1920);
    const store2 = useLayoutStore();
    const refs2 = storeToRefs(store2);
    store2.setRightCollapsedByEmptyBook(true);
    expect(refs2.rightCollapsed.value).toBe(true);
    store2.setRightCollapsedByEmptyBook(false); // 书打开了
    expect(refs2.rightCollapsed.value, "打开作品后不擅自推回来").toBe(true);
    store2.$dispose();
  });

  it("按**真实布局宽度**判，不按 window.innerWidth：Electron 缩放下两者能差一倍以上（真机 1280 vs 877）", async () => {
    // innerWidth 报 1280（看起来很宽，不该收），但 shell 实测只有 900 —— 实际是窄窗。
    installRuntime(1280);
    const store = useLayoutStore();
    const refs = storeToRefs(store);
    expect(refs.rightCollapsed.value, "1280 起步时按 innerWidth 判为宽窗").toBe(false);

    store.desktopShell = shell(900, 0);
    await nextTick();
    await nextTick();
    expect(refs.rightCollapsed.value, "shell 挂上后必须按实测宽度改为收起").toBe(true);
    store.$dispose();
  });

  it("shell 变宽也不自动展开（只收不展），且手动意图依旧优先", async () => {
    installRuntime(900);
    const store = useLayoutStore();
    const refs = storeToRefs(store);
    expect(refs.rightCollapsed.value).toBe(true);

    // 窗口拉宽 —— 右栏保持收起，不擅自把用户眼前的视图改回去。
    store.desktopShell = shell(1600, 0);
    await nextTick();
    await nextTick();
    expect(refs.rightCollapsed.value, "变宽不自动展开").toBe(true);

    // 手动展开后，闸门继续压着自动策略。
    store.togglePane("right");
    store.desktopShell = shell(800, 0);
    await nextTick();
    await nextTick();
    expect(refs.rightCollapsed.value, "手动意图优先").toBe(false);
    store.$dispose();
  });

  // 【5-㊳ 真机量到的】从皮肤广场点齿轮进设置：屏幕上是设置中心，
  // 左栏「皮肤广场」那枚却还亮着——active 唯一的工作是说「你在这儿」，说错了比不说更糟。
  // showSettings 原来只切 currentView，centerView 留在原地，于是那一枚就一直亮着。
  it("showSettings 顺手复位 centerView：左栏不许停在原地亮着", async () => {
    installRuntime();
    const store = useLayoutStore();
    const refs = storeToRefs(store);

    store.showCenter("skins");
    expect(refs.centerView.value).toBe("skins");
    store.showSettings();
    expect(refs.currentView.value).toBe("settings");
    // 复位之后一枚都不亮是对的：设置视图的指示器是左下角那颗齿轮，它不在 nav-row 里。
    expect(refs.centerView.value).toBe("chat");
    // 回程落点与 showWorkspace 同一口径（都是对话），不因从哪一页进设置而变。
    store.showWorkspace();
    expect(refs.centerView.value).toBe("chat");
    store.$dispose();
  });

  it("showSettings 可指名页签：不带参默认模型页，外观入口显式传 appearance", async () => {
    installRuntime();
    const store = useLayoutStore();
    const refs = storeToRefs(store);

    expect(refs.settingsTab.value).toBe("model");
    store.showSettings();
    expect(refs.currentView.value).toBe("settings");
    expect(refs.settingsTab.value).toBe("model");

    store.showWorkspace();
    store.showSettings("appearance");
    expect(refs.currentView.value).toBe("settings");
    expect(refs.settingsTab.value).toBe("appearance");
    store.$dispose();
  });

  it("keeps DOM handles and preference snapshots shallow", () => {
    installRuntime();
    const refs = storeToRefs(useLayoutStore());

    refs.desktopShell.value = shell(1200);
    expect(isReactive(refs.desktopShell.value)).toBe(false);
    expect(isReactive(refs.rightPanePreferences.value)).toBe(false);
  });

  it("clamps panes against their own limits and the remaining center width", () => {
    installRuntime(1200);
    const store = useLayoutStore();
    store.desktopShell = shell(1200);

    store.setPaneCollapsed("right", true);
    store.setPaneWidth("left", 2_000);
    expect(store.leftPaneWidth).toBe(LEFT_PANE_MAX);

    store.setPaneCollapsed("right", false);
    store.setPaneCollapsed("left", true);
    store.setPaneWidth("right", 2_000);
    expect(store.rightPaneWidth).toBe(880);
    expect(store.rightPaneWidth).toBeLessThan(RIGHT_PANE_MAX);
  });

  it("lets the divider pass the old editor cap while preserving a 320px chat column", () => {
    installRuntime(1920);
    const store = useLayoutStore();
    store.desktopShell = shell(1920, 0);
    store.setPaneCollapsed("left", true);
    store.startPaneResize("right", {
      preventDefault: vi.fn()
    } as unknown as PointerEvent);
    store.handleResizeMove({ clientX: 100 } as PointerEvent);
    expect(store.rightPaneWidth).toBe(1600);
    expect(store.writingRightPaneViewModel.maxWidth).toBe(1600);
    store.stopPaneResize();

    store.desktopShell = shell(1000, 0);
    store.reconcilePaneWidths();
    store.setPaneWidth("right", 1600);
    expect(store.rightPaneWidth).toBe(680);
    expect(store.writingRightPaneViewModel.maxWidth).toBe(680);
  });

  it("tracks pointer resizing and removes global listeners on completion", () => {
    const runtime = installRuntime(1200);
    const store = useLayoutStore();
    store.desktopShell = shell(1000, 100);
    store.setPaneCollapsed("right", true);
    const preventDefault = vi.fn();

    store.startPaneResize("left", {
      preventDefault
    } as unknown as PointerEvent);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(store.resizingPane).toBe("left");
    expect(runtime.addEventListener).toHaveBeenCalledTimes(3);

    store.handleResizeMove({ clientX: 450 } as PointerEvent);
    expect(store.leftPaneWidth).toBe(350);
    store.stopPaneResize();

    expect(store.resizingPane).toBeNull();
    expect(runtime.removeEventListener.mock.calls.map(([type]) => type)).toEqual(
      expect.arrayContaining(["pointermove", "pointerup", "pointercancel"])
    );
  });

  it.each(["pointerup", "pointercancel", "lostpointercapture", "dispose"])(
    "captures the separator while dragging across chat controls and releases on %s",
    (completion) => {
      const runtime = installRuntime(1400);
      const store = useLayoutStore();
      store.desktopShell = shell(1400, 0);
      const target = new EventTarget();
      const setPointerCapture = vi.fn();
      const releasePointerCapture = vi.fn();
      Object.assign(target, {
        setPointerCapture,
        hasPointerCapture: () => true,
        releasePointerCapture
      });

      store.startPaneResize("right", {
        currentTarget: target,
        pointerId: 7,
        preventDefault: vi.fn()
      } as unknown as PointerEvent);
      expect(setPointerCapture).toHaveBeenCalledWith(7);
      store.handleResizeMove({ clientX: 800 } as PointerEvent);
      expect(store.rightPaneWidth).toBe(600);
      expect(releasePointerCapture).not.toHaveBeenCalled();

      if (completion === "dispose") store.$dispose();
      else if (completion === "lostpointercapture") {
        target.dispatchEvent(new Event(completion));
      } else {
        runtime.addEventListener.mock.calls.find(([type]) => type === completion)?.[1]();
      }
      expect(store.resizingPane).toBeNull();
      expect(releasePointerCapture).toHaveBeenCalledExactlyOnceWith(7);
      store.stopPaneResize();
      expect(releasePointerCapture).toHaveBeenCalledOnce();
    }
  );

  it("persists keyboard-resized right-pane widths by workspace key", () => {
    const runtime = installRuntime(1400);
    const store = useLayoutStore();
    store.desktopShell = shell(1400);
    store.setActiveRightPanePreferenceKey("short:plot", false);
    const previousWidth = store.rightPaneWidth;
    const preventDefault = vi.fn();

    store.handleResizeKeydown("right", {
      key: "ArrowLeft",
      preventDefault
    } as unknown as KeyboardEvent);

    expect(preventDefault).toHaveBeenCalledOnce();
    const expectedWidth = Math.round(previousWidth + 12);
    expect(store.rightPaneWidth).toBe(expectedWidth);
    expect(JSON.parse(runtime.storage.getItem(RIGHT_PANE_PREFERENCES_STORAGE_KEY) ?? "{}")).toEqual(
      {
        version: 1,
        widths: { "short:plot": expectedWidth }
      }
    );
  });

  it("suppresses transitions until a restored width has painted", async () => {
    const runtime = installRuntime(1400);
    runtime.storage.setItem(
      RIGHT_PANE_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ version: 1, widths: { "short:draft": 610 } })
    );
    const store = useLayoutStore();
    store.desktopShell = shell(1400);

    store.setActiveRightPanePreferenceKey("short:draft");
    expect(store.rightPaneWidth).toBe(610);
    expect(store.paneTransitionSuppressed).toBe(true);
    await nextTick();

    expect(runtime.animationFrames).toHaveLength(1);
    runtime.animationFrames.shift()?.(0);
    expect(store.paneTransitionSuppressed).toBe(true);
    expect(runtime.animationFrames).toHaveLength(1);
    runtime.animationFrames.shift()?.(16);
    expect(store.paneTransitionSuppressed).toBe(false);
  });
});
