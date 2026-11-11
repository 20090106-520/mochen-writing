<!--
  应用内统一 Tooltip（2026-11-11）。

  全站 137 处 `title` 原本交给浏览器画提示：要等一秒、字色圆角跟系统走、
  深色皮肤下是一块刺眼的白膏药，路径那种多行文本还挤成一行。
  macOS / Figma / Linear / Ant Design 都不这么干 —— 提示是应用自己的一层 UI。

  【为什么不改那 137 处源码】它们大多数是 `:title="表达式"`，也有几枚是传给子组件的 prop。
  逐处改成 data-tip 要动几十个组件、还会把「title 作可访问名」这条语义一起搬走。
  这里改成**一次装配、事件委托**：挂载后把 DOM 上所有 title 搬到 data-mochen-tip，
  MutationObserver 兜住 Vue 重渲染重新写回来的那些；hover / 键盘聚焦时按锚点定位画自家提示。
  组件源码一行不动，提示却全站换了一层皮。

  【不碰键盘】全局 keydown 有且只有 useHotkeys 一处（裁定 G5）。这里连 Esc 都不监听：
  关面板导致锚点消失、窗口失焦、指针离开、按下、滚动 —— 五条被动通路足够收起一层提示，
  Esc 收面板时锚点自然从 DOM 掉出去，observer 顺手收掉提示。
-->
<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import {
  TOOLTIP_ATTR,
  TOOLTIP_HOVER_DELAY_MS,
  adoptTooltipTitle,
  placeTooltip
} from "../utils/tooltip-placement";

interface TipView {
  text: string;
  left: number;
  top: number;
  side: "top" | "bottom";
  arrowLeft: number;
  /** 先画一帧透明的量尺寸，再按实测宽高定位；这一帧不参与点击也不该被看见。 */
  measuring: boolean;
}

const view = ref<TipView | null>(null);
const tipEl = ref<HTMLElement | null>(null);

let anchorEl: Element | null = null;
let hoverTimer: ReturnType<typeof setTimeout> | null = null;
let observer: MutationObserver | null = null;
/** 每次 show 递增：异步量完尺寸回来时，锚点可能早换了，旧的那次不许再写。 */
let showToken = 0;

function clearHoverTimer(): void {
  if (hoverTimer !== null) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
}

function hide(): void {
  clearHoverTimer();
  showToken += 1;
  anchorEl = null;
  view.value = null;
}

/** 把一枚 title 搬走；顺手给纯图标按钮补一条可访问名。 */
function adoptOne(el: Element): void {
  const title = el.getAttribute("title");
  if (title === null) return;
  const decision = adoptTooltipTitle(
    title,
    el.hasAttribute("aria-label"),
    (el.textContent ?? "").trim().length > 0
  );
  el.removeAttribute("title");
  if (decision === null) return;
  el.setAttribute(TOOLTIP_ATTR, decision.text);
  if (decision.ariaLabel !== null) el.setAttribute("aria-label", decision.ariaLabel);
}

function adoptSubtree(root: Document | Element): void {
  for (const el of root.querySelectorAll(`[title]`)) adoptOne(el);
}

function tipAnchorOf(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  return target.closest(`[${TOOLTIP_ATTR}]`);
}

async function show(el: Element, text: string): Promise<void> {
  clearHoverTimer();
  if (el === anchorEl && view.value !== null && view.value.text === text) return;
  anchorEl = el;
  const token = ++showToken;
  // 第一帧只用来量宽高：透明度 0，仍在布局里，getBoundingClientRect 读得到。
  view.value = { text, left: 0, top: 0, side: "top", arrowLeft: 0, measuring: true };
  await nextTick();
  const boxEl = tipEl.value;
  if (token !== showToken || anchorEl !== el || boxEl === null) return;
  const rect = el.getBoundingClientRect();
  const placement = placeTooltip(
    { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    { width: boxEl.offsetWidth, height: boxEl.offsetHeight },
    { width: window.innerWidth, height: window.innerHeight }
  );
  view.value = { text, ...placement, measuring: false };
}

function onPointerOver(event: PointerEvent): void {
  const el = tipAnchorOf(event.target);
  if (el === null) return;
  if (el === anchorEl && view.value !== null) return;
  const text = el.getAttribute(TOOLTIP_ATTR);
  if (text === null || text.trim().length === 0) return;
  clearHoverTimer();
  // 换锚点时先收掉旧提示，别让上一枚在新提示量尺寸的那一帧里还挂着。
  if (view.value !== null) hide();
  hoverTimer = setTimeout(() => {
    hoverTimer = null;
    void show(el, text);
  }, TOOLTIP_HOVER_DELAY_MS);
}

function onFocusIn(event: FocusEvent): void {
  const el = tipAnchorOf(event.target);
  if (el === null) return;
  const text = el.getAttribute(TOOLTIP_ATTR);
  if (text === null || text.trim().length === 0) return;
  // 键盘用户不需要再等 320ms：焦点已经明确表达了「我在这里」。
  void show(el, text);
}

function stillInside(related: EventTarget | null): boolean {
  return anchorEl !== null && related instanceof Node && anchorEl.contains(related);
}

function onPointerOut(event: PointerEvent): void {
  if (!stillInside(event.relatedTarget)) hide();
}

function onFocusOut(event: FocusEvent): void {
  if (!stillInside(event.relatedTarget)) hide();
}

function onScroll(): void {
  if (anchorEl !== null) hide();
}

/**
 * Esc 不在这里监听：全局 keydown 有且只有 useHotkeys 一处（裁定 G5），
 * 为一枚提示再开第二路会把 Esc 的裁决劈成两半。
 * 改成被动通路：按 Esc 关掉某个面板 ⇒ 锚点随 DOM 一起消失 ⇒ 下面 observer 里收起；
 * 窗口失焦也收起。两条都不碰键盘事件。
 */
onMounted(() => {
  // 首屏已有的 title 先搬一遍；之后 Vue 新建/重写的节点交给 observer。
  adoptSubtree(document);
  observer = new MutationObserver((records) => {
    for (const record of records) {
      if (anchorEl !== null && !anchorEl.isConnected) hide();
      if (record.type === "attributes") {
        adoptOne(record.target as Element);
      } else {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.hasAttribute("title")) adoptOne(node);
          adoptSubtree(node);
        }
      }
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["title"]
  });

  document.addEventListener("pointerover", onPointerOver);
  document.addEventListener("pointerout", onPointerOut);
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  document.addEventListener("pointerdown", hide);
  // scroll 不冒泡，捕获取 true 才收得到某个面板内部的滚动。
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);
  window.addEventListener("blur", hide);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  clearHoverTimer();
  document.removeEventListener("pointerover", onPointerOver);
  document.removeEventListener("pointerout", onPointerOut);
  document.removeEventListener("focusin", onFocusIn);
  document.removeEventListener("focusout", onFocusOut);
  document.removeEventListener("pointerdown", hide);
  window.removeEventListener("scroll", onScroll, true);
  window.removeEventListener("resize", onScroll);
  window.removeEventListener("blur", hide);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="view"
      ref="tipEl"
      class="mochen-tooltip"
      :class="{ 'is-measuring': view.measuring }"
      :data-side="view.side"
      :style="{ left: `${view.left}px`, top: `${view.top}px` }"
      role="tooltip"
    >
      <span class="mochen-tooltip-text">{{ view.text }}</span>
      <span class="mochen-tooltip-arrow" :style="{ left: `${view.arrowLeft}px` }" />
    </div>
  </Teleport>
</template>
