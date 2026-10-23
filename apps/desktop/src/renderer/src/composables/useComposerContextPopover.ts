import { nextTick, onBeforeUnmount, onMounted, ref, type CSSProperties, type Ref } from "vue";
import { composerPopoverPlacement, POPOVER_MAX_HEIGHT } from "../utils/composer-context-placement";

/**
 * #113c 阶段弹层的跟随与收起（真身：deepwrite composables/useComposerContextPopover.ts）。
 * 五个数值不在此文件：判定已经剥到 utils/composer-context-placement.ts（那里有测试），
 * 这里只负责把它套成 CSSProperties、挂监听、以及在卸载时把焦点还给触发钮。
 *
 * 【`limitPx` 是给「浏览面板」留的口子，2026-10-07 批次 5-㉖】
 * 默认封顶仍是 `POPOVER_MAX_HEIGHT`（380），下拉类浮层的观感一个字没变。
 * 技能库那一类要装下「页签 + 说明 + 分类筛选 + 结果 + 若干张卡 + 卡内正文预览」，380 不够，
 * 于是它显式要多高。**底线没有跟着放宽**：仍然是 `min(limitPx, spacePx)`，
 * 贴着窗口下沿打开时不会有一截跑到屏幕外面去。
 * 为什么不在样式表里写 `!important` 盖掉：那个 `max-height` 是内联样式，盖它就得靠
 * `!important`；这里加个可选参数就够——不必为一处例外在全局引入一个逃生口。
 */
export function useComposerContextPopover(
  anchor: () => HTMLElement,
  panel: Ref<HTMLElement | undefined>,
  dismiss: () => void,
  options?: { limitPx?: number; widthPx?: number }
) {
  const style = ref<CSSProperties>({ visibility: "hidden" });
  let restoreFocus = true;
  let observer: ResizeObserver | undefined;
  let frame = 0;

  function position(): void {
    const rect = anchor().getBoundingClientRect();
    const p = composerPopoverPlacement({
      anchor: rect,
      viewport: { innerWidth: window.innerWidth, innerHeight: window.innerHeight },
      ...(options?.widthPx === undefined ? {} : { preferredWidth: options.widthPx })
    });
    style.value = {
      position: "fixed",
      width: `${p.widthPx}px`,
      left: `${p.leftPx}px`,
      [p.side]: `${p.offsetPx}px`,
      maxHeight: `${Math.min(options?.limitPx ?? POPOVER_MAX_HEIGHT, p.spacePx)}px`,
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

  /**
   * 浮层里能吃到焦点的东西——与上面 `tab()` 收的是同两样（button / input），
   * 两处共用这一行字符串，别在下面再抄一份。
   */
  const POPOVER_FOCUSABLE = "button:not(:disabled), input:not(:disabled)";

  /**
   * 把焦点挪进浮层（批次 5-㊵）。
   *
   * 【为什么非做不可】这一族的 Esc 全部挂在面板根的 `@keydown` 上，而 keydown 走冒泡——
   * **焦点不在这棵子树里就收不到**。真机 p536n 量到：九枚入口里八枚的 Esc 按两下都不动，
   * 焦点全停在锚点那枚 chip 上。根因与 5-㊱ 在四个弹层上量到的是同一条，一份治。
   *
   * 【这里的完成判据是「焦点真的在层内」，不是「面板可见」】两个坑叠在一起，两个都是量出来的：
   *   ① 面板的 style 初值是 `{ visibility: "hidden" }`，由本文件的 onMounted 调 `position()` 换掉。
   *      对 visibility:hidden 的元素调 focus() 是**静默失败**：p536nb 逐帧量到 t≈40ms 时
   *      computed visibility 仍是 hidden、t≈120ms 才 visible；ComposerContextMenu 里那句
   *      `await nextTick(); search.value?.focus()` 正好落在那个窗口里，一次都没进去。
   *   ② **面板可见了也可能进不去**：埋点（p536nd）量到面板 visible、目标按钮 rects=1 /
   *      offsetParent=true / disabled=false、面板在场，focus() 也调了——
   *      可 `document.activeElement` 当场没动、下一帧也没动；同一时刻 t≈900ms 手动 focus
   *      同一个按钮却立刻进去了。
   * ⇒ 所以每次尝试都以 `el.contains(document.activeElement)` 为准：进去了才算成，
   * 没进去就下一帧再试。不猜时机，验到算数。
   */
  function focusFirstWhenVisible(): void {
    let attempts = 0;
    const tryOnce = (): boolean => {
      const el = panel.value;
      if (el === undefined) return true; // 面板已经没了，没什么可做的，也别再重试
      if (getComputedStyle(el).visibility === "hidden") return false; // ① 还没可见，focus 会静默失败
      const first = el.querySelector<HTMLElement>(POPOVER_FOCUSABLE) ?? el;
      first.focus();
      return el.contains(document.activeElement); // ② 浏览器拒了就是拒了，下一帧再试
    };
    const retry = (): void => {
      attempts += 1;
      if (tryOnce() || attempts >= 30) return;
      requestAnimationFrame(retry);
    };
    void nextTick(retry);
  }

  function tab(event: KeyboardEvent): void {
    if (event.key !== "Tab") return;
    const items = Array.from(panel.value?.querySelectorAll<HTMLElement>(POPOVER_FOCUSABLE) ?? []);
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
    focusFirstWhenVisible();
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
