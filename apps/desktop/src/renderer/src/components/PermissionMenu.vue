<!-- 权限档 popover：档位名全部来自 PERMISSION_LABELS，本文件不出现第二份中文档名。 -->
<script setup lang="ts">
import { computed } from "vue";
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_LABELS,
  PERMISSION_MODES,
  type PermissionMode
} from "@mochen/contracts";
import { useBookStore } from "../stores/useBookStore";
import { matchPermissionMode } from "../utils/slash-commands";

const book = useBookStore();
const emit = defineEmits<{ close: [] }>();

// 判定全在 stores/utils（本仓没有组件测试）：这里只把表画出来、把点击接到唯一动作上。
const current = computed<PermissionMode>(
  () => book.meta?.permissionMode ?? DEFAULT_PERMISSION_MODE
);
const presetMode = computed<PermissionMode | null>(() =>
  matchPermissionMode(book.permissionPreset)
);
const busy = computed(() => book.saving || book.meta === null);

async function choose(mode: PermissionMode): Promise<void> {
  if (busy.value) return;
  await book.setPermissionMode(mode);
  emit("close");
}
</script>

<template>
  <div class="permission-menu" role="menu" aria-label="权限档">
    <button
      v-for="mode in PERMISSION_MODES"
      :key="mode"
      type="button"
      role="menuitem"
      :class="[
        'permission-option',
        { 'is-current': mode === current, 'is-preset': mode === presetMode }
      ]"
      :disabled="busy"
      @click="choose(mode)"
    >
      {{ PERMISSION_LABELS[mode] }}
      <span v-if="mode === current">（当前）</span>
    </button>
    <p class="permission-hint">
      {{
        book.meta ? "切档只改之后的判断，不复活已经被拒绝或取消的提案。" : "先打开作品才能切档。"
      }}
    </p>
    <p class="permission-hint">
      已经拒绝或取消的提案不会回来，切档后请在新一轮里重新提出；仍留在待审的提案，切档后可以马上批准。
    </p>
  </div>
</template>
