import type { ComputedRef, Ref } from "vue";
import { useTrailingValue } from "./useTrailingValue";
import { previewDelayMs } from "../utils/preview-debounce";

/**
 * 「落后一拍」的预览草稿（2026-10-10 巡检）。
 *
 * markdownToSimpleHtml 全篇重算 + v-html 全量重挂，十万字开着分栏每敲一个字实测
 * 437ms——预览把打字拖死了。排程、追平与定时器清理的真身在 `useTrailingValue`，
 * 这里只剩「等多久」的口径（分栏开着等静默窗，其余立即追平，真身在
 * utils/preview-debounce）。
 *
 * @param draft    活动草稿（store 的响应式源，传 getter 即可）
 * @param viewMode 右栏视图档（'edit' | 'split' | 'preview'）
 * @returns 预览真正吃的草稿 ref——比 draft 至多落后一个静默窗
 */
export function usePreviewDraft(
  draft: () => string,
  viewMode: ComputedRef<string> | Ref<string>
): ReturnType<typeof useTrailingValue<string>> {
  return useTrailingValue(draft, () => previewDelayMs(viewMode.value));
}
