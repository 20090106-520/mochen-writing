<!-- 权限档 popover：档位名全部来自 PERMISSION_LABELS，本文件不出现第二份中文档名。
     判定（哪个键归弹层、忙碌态、当前档）全在 stores/utils——本仓没有组件测试，这里只接线。 -->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_LABELS,
  PERMISSION_MODES,
  type PermissionMode
} from "@mochen/contracts";
import { useBookStore } from "../stores/useBookStore";
import { popoverOwnsKey } from "../utils/slash-commands";
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

// 只有裸 Esc 归弹层（关掉它，不切档）；键的判定走 popoverOwnsKey 纯函数，模板里不写裸比较。
function onKeydown(event: KeyboardEvent): void {
  const mods: HotkeyMods = {
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey
  };
  if (!popoverOwnsKey(event.key, mods, event.isComposing === true)) return;
  event.stopPropagation();
  emit("close");
}

onMounted(() => {
  void nextTick(() => menuEl.value?.focus());
});
</script>

<template>
  <div
    ref="menuEl"
    class="permission-menu"
    role="menu"
    aria-label="权限档"
    tabindex="-1"
    @keydown="onKeydown"
  >
    <button
      v-for="mode in PERMISSION_MODES"
      :key="mode"
      type="button"
      role="menuitem"
      :class="['permission-option', { 'is-current': mode === current }]"
      :disabled="busy"
      @click="choose(mode)"
    >
      {{ PERMISSION_LABELS[mode] }}
      <span v-if="mode === current">（当前）</span>
    </button>
    <p class="permission-hint">
      {{
        book.meta
          ? "切档只改之后的判断，不复活已经被拒绝或取消的提案。"
          : "还没打开作品目录，权限档改不了。"
      }}
    </p>
    <p class="permission-hint">
      已经拒绝或取消的提案不会回来，切档后请在新一轮里重新提出；仍留在待审的提案，切档后可以马上批准。
    </p>
  </div>
</template>
