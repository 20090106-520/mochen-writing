import { onBeforeUnmount, onMounted, ref, type CSSProperties, type Ref } from "vue";
import { composerPopoverPlacement } from "../utils/composer-context-placement";

/**
 * #113c 阶段弹层的跟随与收起（真身：deepwrite composables/useComposerContextPopover.ts，Apache-2.0）。
 * 五个数值不在此文件：判定已经剥到 utils/composer-context-placement.ts（那里有测试），
 * 这里只负责把它套成 CSSProperties、挂监听、以及在卸载时把焦点还给触发钮。
 */
export function useComposerContextPopover(
  anchor: () => HTMLElement,
  panel: Ref<HTMLElement | undefined>,
  dismiss: () => void
) {
  const style = ref<CSSProperties>({ visibility: "hidden" });
  let restoreFocus = true;
  let observer: ResizeObserver | undefined;
  let frame = 0;

  function position(): void {
    const rect = anchor().getBoundingClientRect();
    const p = composerPopoverPlacement({
      anchor: rect,
      viewport: { innerWidth: window.innerWidth, innerHeight: window.innerHeight }
    });
    style.value = {
      position: "fixed",
      width: `${p.widthPx}px`,
      left: `${p.leftPx}px`,
      [p.side]: `${p.offsetPx}px`,
      maxHeight: `${p.maxHeightPx}px`,
      transformOrigin: p.transformOrigin
    };
  }

  function schedulePosition(): void {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(position);
  }

  function outside(event: Event): void {
    const target = event.target;
    if (target instanceof Node && !panel.value?.contains(target) && !anchor().contains(target)) {
      restoreFocus = false;
      dismiss();
    }
  }

  function close(): void {
    dismiss();
  }

  function tab(event: KeyboardEvent): void {
    if (event.key !== "Tab") return;
    const items = Array.from(
      panel.value?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)") ??
        []
    );
    if (document.activeElement === (event.shiftKey ? items[0] : items.at(-1))) {
      // Tab 触到边缘就交还给触发钮并收起：让浏览器从触发钮继续走进周围工作区，而不是困在浮层里。
      anchor().focus();
      dismiss();
    }
  }

  onMounted(() => {
    position();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("scroll", schedulePosition, true);
    window.addEventListener("resize", schedulePosition);
    observer = new ResizeObserver(schedulePosition);
    observer.observe(anchor());
    if (panel.value) observer.observe(panel.value);
  });

  onBeforeUnmount(() => {
    document.removeEventListener("pointerdown", outside);
    document.removeEventListener("focusin", outside);
    document.removeEventListener("scroll", schedulePosition, true);
    window.removeEventListener("resize", schedulePosition);
    observer?.disconnect();
    cancelAnimationFrame(frame);
    if (restoreFocus && panel.value?.contains(document.activeElement) && anchor().isConnected)
      anchor().focus();
  });

  return { style, close, tab };
}
