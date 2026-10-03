<!-- 右栏文件标签条（从 DocumentPane.vue 抽出，纯展示：判定与 store 调用都留在父组件）。 -->
<script setup lang="ts">
import AppIcon from "./AppIcon.vue";

defineProps<{
  /** 带名（「文稿标签」/「浏览标签」）：文案由父侧的 BAND_LABELS[mode] 传进来，这里不复制判定。 */
  label: string;
  /** 关闭按钮的 aria 文案：同样是父侧按 mode 选好的两句现成文案，不许在子组件里硬编码成单一句式。 */
  closeLabel: string;
  tabs: { id: string; title: string }[];
  activeId: string | null;
}>();
const emit = defineEmits<{ select: [id: string]; close: [] }>();
</script>

<template>
  <nav class="section-tabs-bar" :aria-label="label">
    <div class="section-tabs-scroll" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="section-tab"
        :class="{ 'is-active': tab.id === activeId }"
        type="button"
        role="tab"
        :aria-selected="tab.id === activeId"
        :title="tab.title"
        @click="emit('select', tab.id)"
      >
        {{ tab.title }}
      </button>
    </div>
    <button
      v-if="tabs.length"
      class="section-tabs-remove"
      type="button"
      :aria-label="closeLabel"
      @click="emit('close')"
    >
      <AppIcon name="minus" :size="16" />
    </button>
  </nav>
</template>
