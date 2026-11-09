<!-- 右栏「审稿」下拉（P0-5）。

     为什么要有这一层：右栏头部的内容盒只有 328px（1440 视口）。八枚平铺按钮时面包屑被压到
     0 宽、最右两枚还画进窗控预留带；把检查类收进这一颗按钮后，头部只剩「写作」四枚 +
     素材库 + 审稿 + 收起，拥挤才真正解决。**入口一个都没删**：五枚检查项全在下拉里。

     五块检查面板共用**触发钮**当锚点，不是菜单行：菜单一关菜单行就卸载，拿它当锚点的话
     面板会跟着一起消失。稳定锚点这件事落在 DocumentPane 的 reviewMenuAnchor 上。

     键位与权限档菜单同一份判据（useListHighlight + popoverOwnsKey）：↑↓ 走高亮、
     Enter 打开高亮那条、Esc 收菜单并把焦点交还触发钮。Esc 在这里 stopPropagation——
     全局 escape-policy 不该越过这一层去关别的东西。 -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { useBookStore } from "../stores/useBookStore";
import { useListHighlight } from "../composables/useListHighlight";
import { useComposerContextPopover } from "../composables/useComposerContextPopover";
import { imeOwnsKey, popoverOwnsKey } from "../utils/slash-commands";
import type { HotkeyMods } from "../utils/hotkeys";
import { REVIEW_TOOLS, type ReviewTool, type ReviewToolId } from "../utils/review-tools";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{ anchor: HTMLElement }>();
const emit = defineEmits<{ close: []; pick: [id: ReviewToolId] }>();

const book = useBookStore();
const panel = ref<HTMLElement>();
const { style, close, tab } = useComposerContextPopover(
  () => props.anchor,
  panel,
  () => emit("close"),
  { widthPx: 210 }
);

// 没开书时整组都点不动：与原来每一枚检查按钮各自的 `:disabled="!book.meta"` 同一条判据。
const disabled = computed(() => !book.meta);

function choose(tool: ReviewTool): void {
  if (disabled.value) return;
  emit("pick", tool.id);
}

const highlight = useListHighlight<ReviewTool>({
  items: () => REVIEW_TOOLS,
  onPick: (tool) => choose(tool),
  elementOf: (tool) => panel.value?.querySelector(`[data-tool="${tool.id}"]`) ?? null
});
const activeTool = computed<ReviewTool | null>(() => highlight.activeItem.value);

function onKeydown(event: KeyboardEvent): void {
  const mods: HotkeyMods = {
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey
  };
  if (popoverOwnsKey(event.key, mods, imeOwnsKey(event))) {
    event.stopPropagation();
    close();
    return;
  }
  // ↑ / ↓ 走高亮：与模型选择器、权限档菜单同一份判据（utils/list-highlight.ts）。
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    highlight.move(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  // 浮层会把第一颗按钮聚焦；Enter / 空格一律由**高亮**裁决，不让原生 click 再选一次
  // 「碰巧有焦点的那一行」——上下键改了高亮却没改焦点，两者在原生 click 下会分叉。
  if ((event.key === "Enter" || event.key === " ") && !imeOwnsKey(event)) {
    event.preventDefault();
    highlight.pickActive();
    return;
  }
  // Tab 在菜单里循环，不许跑到后面的正文输入框去（这层是真焦点陷阱）。
  if (event.key === "Tab") tab(event);
}
</script>

<template>
  <Teleport to="body">
    <div
      ref="panel"
      class="review-menu"
      :style="style"
      role="listbox"
      aria-label="审稿工具"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <button
        v-for="(tool, index) in REVIEW_TOOLS"
        :key="tool.id"
        class="permission-option"
        type="button"
        role="option"
        :class="{ 'is-selected': activeTool?.id === tool.id }"
        :aria-selected="activeTool?.id === tool.id"
        :disabled="disabled"
        :title="tool.hint"
        :data-tool="tool.id"
        @mouseenter="highlight.activate(index)"
        @click="choose(tool)"
      >
        <AppIcon :name="tool.icon" :size="15" />
        {{ tool.label }}
      </button>
      <p class="list-keys">
        <kbd>↑</kbd><kbd>↓</kbd> 选择 · <kbd>Enter</kbd> 打开 · <kbd>Esc</kbd> 关闭
      </p>
    </div>
  </Teleport>
</template>
