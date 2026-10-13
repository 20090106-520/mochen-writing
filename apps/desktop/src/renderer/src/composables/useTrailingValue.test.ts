import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { useTrailingValue } from "./useTrailingValue";

/**
 * 「落后一拍」的通用静默层（2026-10-10 巡检，从 usePreviewDraft 长出来）。
 * 四条行为都拿真 reactivity 跑：延迟跟、零延迟立即跟、连续变更只留最后一拍、
 * 静默窗未到就切 0 档时挂起那一拍立即追平。少一条，预览/高亮要么退回每键几百毫秒，
 * 要么拿着旧稿上屏。
 */
describe("useTrailingValue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("延迟档：源变了先按住，静默窗到了才上屏", async () => {
    const src = ref("旧");
    const lagged = useTrailingValue(
      () => src.value,
      () => 250
    );
    await nextTick();
    src.value = "新";
    await nextTick();
    expect(lagged.value).toBe("旧");
    vi.advanceTimersByTime(250);
    expect(lagged.value).toBe("新");
  });

  it("0 档：立即追平，不排定时器", async () => {
    const src = ref("旧");
    const lagged = useTrailingValue(
      () => src.value,
      () => 0
    );
    await nextTick();
    src.value = "新";
    await nextTick();
    expect(lagged.value).toBe("新");
  });

  it("静默窗里连变几次：只留最后一拍（debounce，不是 throttle）", async () => {
    const src = ref("0");
    const lagged = useTrailingValue(
      () => src.value,
      () => 100
    );
    await nextTick();
    src.value = "1";
    await nextTick();
    vi.advanceTimersByTime(99);
    src.value = "2";
    await nextTick();
    vi.advanceTimersByTime(99);
    expect(lagged.value).toBe("0");
    vi.advanceTimersByTime(1);
    expect(lagged.value).toBe("2");
  });

  it("挂起那一拍未到就切 0 档：立即追平（值马上要给人看了，不能拿旧稿）", async () => {
    const src = ref("旧");
    const delay = ref(250);
    const lagged = useTrailingValue(
      () => src.value,
      () => delay.value
    );
    await nextTick();
    src.value = "新";
    await nextTick();
    delay.value = 0;
    await nextTick();
    expect(lagged.value).toBe("新");
  });

  it("同一拍里先 0 后非 0：上屏的是各自时刻拿到的值（延迟决定于事件时刻，不决定于追上时刻）", async () => {
    const src = ref("a");
    const delay = ref(0);
    const lagged = useTrailingValue(
      () => src.value,
      () => delay.value
    );
    await nextTick();
    src.value = "b";
    await nextTick();
    expect(lagged.value).toBe("b");
    delay.value = 500;
    src.value = "c";
    await nextTick();
    expect(lagged.value).toBe("b");
    vi.advanceTimersByTime(500);
    expect(lagged.value).toBe("c");
  });
});
