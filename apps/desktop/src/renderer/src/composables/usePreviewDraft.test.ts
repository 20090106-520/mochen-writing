import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { usePreviewDraft } from "./usePreviewDraft";
import { PREVIEW_DEBOUNCE_MS } from "../utils/preview-debounce";

/**
 * 「落后一拍」的预览草稿（2026-10-10 巡检）。判定与排程住在 composable 里之后，
 * 这四条行为用真 reactivity 跑出来（无 jsdom；watch 在组件外一样是真排程）：
 * 分栏态延迟跟、纯编辑立即跟、静默窗里连续打字只留最后一拍、离开分栏立即追平。
 * 少任何一条，分栏要么退回每键 437ms 的全量重算，要么预览永远停在上一个字。
 */
describe("usePreviewDraft", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("分栏态：草稿变动落后一个静默窗，静默后追上", async () => {
    const draft = ref("第一版");
    const mode = ref("split");
    const preview = usePreviewDraft(() => draft.value, mode);
    await nextTick();
    draft.value = "第二版";
    await nextTick();
    expect(preview.value).toBe("第一版");
    vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS);
    expect(preview.value).toBe("第二版");
  });

  it("纯编辑态：立即追平，不排定时器（看不见的预览不花钱）", async () => {
    const draft = ref("a");
    const mode = ref("edit");
    const preview = usePreviewDraft(() => draft.value, mode);
    await nextTick();
    draft.value = "b";
    await nextTick();
    expect(preview.value).toBe("b");
    vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS * 2);
    expect(preview.value).toBe("b");
  });

  it("静默窗里连打几字：只留最后一拍（debounce，不是 throttle）", async () => {
    const draft = ref("");
    const mode = ref("split");
    const preview = usePreviewDraft(() => draft.value, mode);
    await nextTick();
    draft.value = "一";
    await nextTick();
    vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS - 1);
    draft.value = "一二";
    await nextTick();
    vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS - 1);
    expect(preview.value).toBe("");
    vi.advanceTimersByTime(1);
    expect(preview.value).toBe("一二");
  });

  it("静默窗未到就切走分栏：挂起那一拍立即追平（预览要显示了，不能拿着旧稿）", async () => {
    const draft = ref("旧稿");
    const mode = ref("split");
    const preview = usePreviewDraft(() => draft.value, mode);
    await nextTick();
    draft.value = "新稿";
    await nextTick();
    mode.value = "preview";
    await nextTick();
    expect(preview.value).toBe("新稿");
  });
});
