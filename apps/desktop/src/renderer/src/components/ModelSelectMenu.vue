<script lang="ts">
export type ModelMenuSection = "menu" | "models" | "levels";
</script>

<script setup lang="ts">
import { computed, watch } from "vue";
import type { ThinkingLevel } from "@mochen/contracts";
import { THINKING_LEVEL_COMPACT_LABELS } from "@mochen/contracts";
import AppIcon from "./AppIcon.vue";
import { useListHighlight } from "../composables/useListHighlight";

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

/**
 * 推理强度子菜单的键盘导航（2026-11-24）：同一族合成器第二实例，**不另写一套判定**
 * （铁律 6）。初始高亮落在当前那一档——用户最可能要改的就是它，↕ 一下就是相邻档。
 * Enter 不拦：焦点此刻就在高亮那颗选项上，浏览器原生 click 就是选中，再拦一份是第二判据。
 */
const levelEls = new Map<ThinkingLevel, HTMLElement>();
function setLevelRef(level: ThinkingLevel, el: unknown): void {
  if (el instanceof HTMLElement) levelEls.set(level, el);
  else levelEls.delete(level);
}
const levelHighlight = useListHighlight<ThinkingLevel>({
  items: () => props.levels,
  onPick: (level) => emit("pick-level", level),
  elementOf: (level) => levelEls.get(level) ?? null,
  initialIndex: () => {
    const index = props.levels.indexOf(props.level);
    return index < 0 ? 0 : index;
  }
});
const activeLevel = computed<ThinkingLevel | null>(() => levelHighlight.activeItem.value);

function setActiveLevel(level: ThinkingLevel): void {
  const index = props.levels.indexOf(level);
  if (index >= 0) levelHighlight.activate(index);
}

// 进子菜单那一刻高亮落在当前档（合成器的 initialIndex 只在建实例时算一次，
// 档位后来被模型能力表改了它不跟——每次进都重落一次才是「高亮指着现在」）。
watch(
  () => props.section,
  (section) => {
    if (section === "levels") setActiveLevel(props.level);
  }
);

/**
 * 子菜单自己管自己的键，`stop` 掉冒泡（panel 那层的 Esc 是「收整层」，语义不同）：
 * Esc / ← 回上级菜单（Windows / macOS 菜单同款分层），↕ 换档高亮，Home/End 跳端点。
 * ChatGPT 桌面端的模型与推理档控件同一条键盘模型（官方文档明说左右键调档）。
 */
function onSubmenuKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" || event.key === "ArrowLeft") {
    event.preventDefault();
    event.stopPropagation();
    emit("back");
    return;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    event.stopPropagation();
    levelHighlight.move(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    event.stopPropagation();
    levelHighlight.activate(event.key === "Home" ? 0 : props.levels.length - 1);
    levelHighlight.reveal();
  }
}
</script>

<template>
  <aside class="model-select-menu" :aria-label="`${modelLabel} 的设置`">
    <button
      class="model-select-menu-row"
      :class="{ 'is-open': props.section === 'models' }"
      type="button"
      :aria-expanded="props.section === 'models'"
      aria-haspopup="menu"
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
      :aria-haspopup="levelsEmpty ? undefined : 'menu'"
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

  <aside
    v-if="props.section === 'levels'"
    class="model-select-submenu"
    aria-label="推理强度"
    @keydown="onSubmenuKeydown"
  >
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
        <button
          :ref="(el) => setLevelRef(optionLevel, el)"
          type="button"
          class="model-select-option"
          :class="{ 'is-active': activeLevel === optionLevel }"
          @click="emit('pick-level', optionLevel)"
          @mouseenter="setActiveLevel(optionLevel)"
          @focus="setActiveLevel(optionLevel)"
        >
          <span>{{ THINKING_LEVEL_COMPACT_LABELS[optionLevel] }}</span>
          <AppIcon v-if="optionLevel === props.level" name="check" :size="14" />
        </button>
      </li>
    </ul>
    <p class="model-select-menu-note">仅显示当前模型实际支持的档位，选择后随模型档案保存。</p>
  </aside>
</template>
