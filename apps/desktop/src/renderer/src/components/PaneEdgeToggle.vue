<!-- 左栏收起后左缘那枚竖条（2026-10-17）。「展开左侧栏」这个动作在这里只有这一份。 -->
<script setup lang="ts">
import AppIcon from "./AppIcon.vue";

/**
 * 只递「点了」，不自己碰 store——与 LeftSidebar 的 `@collapse` 同款：
 * 组件不知道左栏怎么开，装配层（App.vue）知道。
 */
const emit = defineEmits<{ toggle: [] }>();
</script>

<template>
  <button
    class="pane-edge-toggle"
    type="button"
    aria-label="展开左侧栏"
    title="展开左侧栏"
    @click="emit('toggle')"
  >
    <AppIcon name="panel-left" :size="16" />
    <span class="pane-edge-toggle-label" aria-hidden="true">展开左侧栏</span>
  </button>
</template>
