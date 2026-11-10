<!-- 行内引用菜单（#106）：打字时浮在输入卡上方的 `/` 命令与 `@` 素材菜单。
     DOM 骨架、类名、手势与页脚提示对齐 deepwritecomponents/ConversationComposer.vue 的
     composer-reference-* 段（其标题行放 Esc 的 kbd、页脚只有「↑↓ 选择 / Enter 插入」两枚 span），
     判定与状态在 utils/inline-reference-menu.ts + stores/useReferenceMenuStore.ts——本文件不吃键：
     菜单开着时 ↑↓ / Enter / Esc 全部由 utils/hotkeys.ts 与 utils/escape-policy.ts 那一条既有裁决链派下来（裁定 D2），
     所以这里没有 keydown、也没有第二处键位监听（裁定 G5）。 -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, watch } from "vue";
import AppIcon from "./AppIcon.vue";
import { COMPOSER_SELECTOR } from "../utils/hotkey-markers";
import { referenceGroupHeadingAt } from "../utils/inline-reference-menu";
import { threadKeyFor, useAgentStore } from "../stores/useAgentStore";
import { useBookStore } from "../stores/useBookStore";
import { useReferenceMenuStore } from "../stores/useReferenceMenuStore";

const agent = useAgentStore();
const book = useBookStore();
const menu = useReferenceMenuStore();

/** 菜单跟着这一格的草稿走：threadKey 变了（切章/切书）就等于换了一份输入现场。 */
const draftKey = computed(() => threadKeyFor(book.activeDocTab));
const draft = computed(() => agent.draftOf(draftKey.value));

/**
 * 光标位置只有 textarea 自己知道，store 不碰浏览器对象（见 store 首行注释），于是这里读好当参数传。
 * `focused` 一并传：焦点已经不在 composer 时直接收菜单，不让它飘在别人家的屏幕上。
 */
function composerElement(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>(COMPOSER_SELECTOR);
}

function sync(): void {
  const el = composerElement();
  if (el === null) {
    menu.close();
    return;
  }
  menu.syncFrom(
    draft.value,
    el.selectionStart ?? draft.value.length,
    document.activeElement === el
  );
}

/** deepwrite 在 selectReference 之后用 nextTick 把光标与新值一起摆好；这里把同一件事交给口信 caretRequest。 */
async function applyCaretRequest(): Promise<void> {
  const caret = menu.caretRequest;
  if (caret === null) return;
  menu.clearCaretRequest();
  await nextTick();
  const el = composerElement();
  if (el === null) return;
  el.focus();
  el.setSelectionRange(caret, caret);
  sync();
}

/** 键盘挪高亮时把那条滚进视野（deepwrite 的 scrollActiveReferenceOptionIntoView）。 */
async function scrollSelectedIntoView(): Promise<void> {
  await nextTick();
  document
    .getElementById(`composer-reference-option-${menu.activeIndex}`)
    ?.scrollIntoView({ block: "nearest" });
}

function onSelectionChange(): void {
  sync();
}

onMounted(() => {
  // 这不是键位监听：↑↓ 移动高亮、Enter 选中、Esc 收菜单全在 utils 那条裁决链里（裁定 D2/G5）。
  // 它只负责「光标自己动了」这一件事——打字之外的点击、方向键、全选都要重算一次行内匹配。
  document.addEventListener("selectionchange", onSelectionChange);
  sync();
});
onBeforeUnmount(() => document.removeEventListener("selectionchange", onSelectionChange));

watch(draft, () => sync());
watch(
  () => menu.caretRequest,
  () => void applyCaretRequest()
);
watch(
  () => menu.activeIndex,
  () => void scrollSelectedIntoView()
);
</script>

<template>
  <!-- 根条件用 menu.copy 而不是 menu.isOpen：两者同时为空/非空（copy 表按触发符全量，tsc 钉住），
       而 copy 非空才能保证下面 title/hint/icon 三处绑定非空——不给 AppIcon 喂可空值（空壳图标防线）。 -->
  <div
    v-if="menu.copy"
    id="composer-reference-menu"
    class="composer-reference-menu"
    role="listbox"
    :aria-label="menu.copy.title"
  >
    <div class="composer-reference-heading">
      <span class="composer-reference-trigger">{{ menu.trigger }}</span>
      <div>
        <strong>{{ menu.copy.title }}</strong>
        <span>{{ menu.copy.hint }}</span>
      </div>
      <kbd>Esc</kbd>
    </div>
    <div v-if="menu.visibleOptions.length" class="composer-reference-options">
      <template v-for="(option, index) in menu.visibleOptions" :key="option.id">
        <!-- 命令按用途分组，分组标题只在每组第一行画一次（判定在 utils 一处）。 -->
        <div
          v-if="referenceGroupHeadingAt(menu.visibleOptions, index)"
          class="composer-reference-group"
        >
          {{ referenceGroupHeadingAt(menu.visibleOptions, index) }}
        </div>
        <button
          :id="`composer-reference-option-${index}`"
          type="button"
          role="option"
          :title="option.detail"
          :aria-label="`${option.title ?? option.label}：${option.detail}`"
          :aria-selected="index === menu.activeIndex"
          :class="{ 'is-selected': index === menu.activeIndex }"
          @mouseenter="menu.activate(index)"
          @mousedown.prevent="menu.select(option)"
        >
          <span class="composer-reference-icon">
            <AppIcon :name="option.icon ?? menu.copy.icon" :size="17" />
          </span>
          <span class="composer-reference-copy">
            <strong>{{ option.title ?? option.label }}</strong>
            <small>{{ option.detail }}</small>
          </span>
          <span class="composer-reference-token">{{ option.token ?? menu.trigger }}</span>
        </button>
      </template>
    </div>
    <div v-else class="composer-reference-empty">{{ menu.emptyText }}</div>
    <div class="composer-reference-footer list-keys">
      <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
      <span><kbd>Enter</kbd> 插入</span>
    </div>
  </div>
</template>
