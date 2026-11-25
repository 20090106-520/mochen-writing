<script lang="ts">
export type ModelMenuSection = "menu" | "models" | "levels";
</script>

<script setup lang="ts">
import { computed } from "vue";
import type { ThinkingLevel } from "@mochen/contracts";
import { THINKING_LEVEL_COMPACT_LABELS } from "@mochen/contracts";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{
  model: string;
  level: ThinkingLevel;
  levels: readonly ThinkingLevel[];
  section: ModelMenuSection;
  capabilityWriting: boolean;
  error: string;
}>();

const emit = defineEmits<{
  "open-models": [];
  "open-levels": [];
  back: [];
  "pick-level": [level: ThinkingLevel];
  "open-settings": [];
}>();

const levelsEmpty = computed(() => props.levels.length === 0);
const modelLabel = computed(() => (props.model === "" ? "未配置模型" : props.model));
const levelLabel = computed(() =>
  levelsEmpty.value ? "不适用" : THINKING_LEVEL_COMPACT_LABELS[props.level]
);
</script>

<template>
  <aside class="model-select-menu" :aria-label="`${modelLabel} 的设置`">
    <button
      class="model-select-menu-row"
      :class="{ 'is-open': props.section === 'models' }"
      type="button"
      :aria-expanded="props.section === 'models'"
      @click="emit('open-models')"
    >
      <span class="model-select-menu-name">模型</span>
      <span class="model-select-menu-value" :title="modelLabel">{{ modelLabel }}</span>
      <AppIcon class="model-select-menu-chevron" name="chevron" :size="11" />
    </button>
    <button
      class="model-select-menu-row"
      :class="{ 'is-open': props.section === 'levels' }"
      type="button"
      :disabled="levelsEmpty"
      :aria-expanded="props.section === 'levels'"
      @click="emit('open-levels')"
    >
      <span class="model-select-menu-name">推理强度</span>
      <span class="model-select-menu-value">{{ levelLabel }}</span>
      <AppIcon v-if="!levelsEmpty" class="model-select-menu-chevron" name="chevron" :size="11" />
    </button>
    <button class="model-select-menu-row" type="button" @click="emit('open-settings')">
      <span class="model-select-menu-name">自定义模型</span>
      <span class="model-select-menu-value"></span>
    </button>
    <p v-if="props.error && props.section !== 'models'" class="model-select-error" role="alert">
      {{ props.error }}
    </p>
    <p v-if="levelsEmpty" class="model-select-menu-note">
      这个模型按厂商官方口径不认 reasoning_effort（它用别的字段控制思考，或根本不是推理模型）——
      思考深度由模型自己定。
    </p>
    <p v-if="props.capabilityWriting && props.section !== 'models'" class="model-select-menu-note">
      正在写入模型能力…
    </p>
  </aside>

  <aside v-if="props.section === 'levels'" class="model-select-submenu" aria-label="推理强度">
    <header class="model-select-menu-head">
      <button
        class="model-select-menu-back"
        type="button"
        aria-label="回到菜单"
        @click="emit('back')"
      >
        <AppIcon name="arrow-left" :size="12" />
      </button>
      <span>推理强度</span>
    </header>
    <ul class="model-select-options">
      <li v-for="optionLevel in props.levels" :key="optionLevel" role="presentation">
        <button type="button" class="model-select-option" @click="emit('pick-level', optionLevel)">
          <span>{{ THINKING_LEVEL_COMPACT_LABELS[optionLevel] }}</span>
          <AppIcon v-if="optionLevel === props.level" name="check" :size="14" />
        </button>
      </li>
    </ul>
    <p class="model-select-menu-note">仅显示当前模型实际支持的档位，选择后随模型档案保存。</p>
  </aside>
</template>
