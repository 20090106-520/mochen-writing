<!-- 权限档 popover：档位名全部来自 PERMISSION_LABELS，本文件不出现第二份中文档名。
     判定（哪个键归弹层、忙碌态、当前档）全在 stores/utils——本仓没有组件测试，这里只接线。

     【2026-10-25 按墨宸自己那份 @ 引用菜单的范式重做】
     改之前这个浮层**只有 Esc**：↑↓ 选不了、Enter 也选不了，键盘用户只能伸手去点。
     同一族浮层（模型选择器 / 阶段选择 / 引用菜单）都能用键盘，唯独它不能——
     这不是「各有风格」，是同一件事有多份实现（铁律 6）。
     ⇒ 现在与那一族同一形状：↑↓ 走**高亮**（下标）、Enter 选高亮那条、悬停与高亮同步、
       名单是 listbox/option + aria-selected、底部一枚 kbd 提示行。
       高亮判据只有一份（composables/useListHighlight.ts + utils/list-highlight.ts）。
     焦点：这个浮层没有搜索框，焦点留在菜单容器上（onMounted 聚焦它），
     ↑↓ 改的是**高亮**而不是真焦点——真焦点搬走就点不到「当前」那枚了。 -->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_LABELS,
  PERMISSION_MODES,
  type PermissionMode
} from "@mochen/contracts";
import { useBookStore } from "../stores/useBookStore";
import { useListHighlight } from "../composables/useListHighlight";
import { imeOwnsKey, popoverOwnsKey } from "../utils/slash-commands";
import type { HotkeyMods } from "../utils/hotkeys";

const book = useBookStore();
const emit = defineEmits<{ close: [] }>();
const menuEl = ref<HTMLElement | null>(null);

// 判定全在 stores/utils（本仓没有组件测试）：这里只把表画出来、把点击接到唯一动作上。
const current = computed<PermissionMode>(
  () => book.meta?.permissionMode ?? DEFAULT_PERMISSION_MODE
);
const busy = computed(() => book.metaSaving || !book.hasBook);

async function choose(mode: PermissionMode): Promise<void> {
  if (busy.value) return;
  // 收起与否由 store 裁决：成功它自己关；失败或同档必须留着，给用户一条当场重试的路。
  await book.setPermissionMode(mode);
}

/**
 * 高亮（2026-10-25）：这一族浮层共用的那一份。
 * 初值落在「当前那一档」上——用户最可能要改的正是现在这一档，
 * ↑↓ 一按就是邻近的另一档，而不是从第一项一路按过去。
 */
const highlight = useListHighlight<PermissionMode>({
  items: () => PERMISSION_MODES,
  initialIndex: () => PERMISSION_MODES.indexOf(current.value),
  onPick: (mode) => {
    void choose(mode);
  }
});
/** 屏幕上高亮的那一档。 */
const activeMode = computed<PermissionMode | null>(() => highlight.activeItem.value);

/** 鼠标划过就把高亮挪过去（键盘与鼠标共用同一个高亮）。 */
function setActive(mode: PermissionMode): void {
  const index = PERMISSION_MODES.indexOf(mode);
  if (index >= 0) highlight.activate(index);
}

// 只有裸 Esc 归弹层（关掉它，不切档）；键的判定走 popoverOwnsKey 纯函数，模板里不写裸比较。
function onKeydown(event: KeyboardEvent): void {
  const mods: HotkeyMods = {
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey
  };
  if (popoverOwnsKey(event.key, mods, imeOwnsKey(event))) {
    event.stopPropagation();
    emit("close");
    return;
  }
  // ↑ / ↓ 走高亮：与模型选择器、阶段选择同一份判据（utils/list-highlight.ts）。
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    highlight.move(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  // Enter 选**高亮那一档**，不是第一档——这一条是改之前最难受的地方。
  if (event.key === "Enter" && !imeOwnsKey(event)) {
    event.preventDefault();
    highlight.pickActive();
  }
}

onMounted(() => {
  void nextTick(() => menuEl.value?.focus());
});
</script>

<template>
  <div
    ref="menuEl"
    class="permission-menu"
    role="listbox"
    aria-label="权限档"
    tabindex="-1"
    @keydown="onKeydown"
  >
    <button
      v-for="mode in PERMISSION_MODES"
      :key="mode"
      type="button"
      role="option"
      class="permission-option"
      :class="{ 'is-current': mode === current, 'is-selected': activeMode === mode }"
      :aria-selected="activeMode === mode"
      :aria-current="mode === current ? 'true' : undefined"
      :disabled="busy"
      @click="choose(mode)"
      @mouseenter="setActive(mode)"
    >
      {{ PERMISSION_LABELS[mode] }}
      <span v-if="mode === current">（当前）</span>
    </button>
    <!-- 键位提示行（2026-10-25）：与 @ 引用菜单、模型选择器同一枚形状，
         排版走 styles.css 的 `.list-keys` 一处。 -->
    <p class="permission-keys list-keys">
      <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
      <span><kbd>Enter</kbd> 切换</span>
      <span><kbd>Esc</kbd> 关闭</span>
    </p>
  </div>
</template>
