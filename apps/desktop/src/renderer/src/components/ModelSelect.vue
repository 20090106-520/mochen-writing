<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { ModelListResult, ThinkingLevel } from "@mochen/contracts";
import AppIcon from "./AppIcon.vue";
import ModelSelectMenu from "./ModelSelectMenu.vue";
import type { ModelMenuSection } from "./ModelSelectMenu.vue";
import { useComposerContextPopover } from "../composables/useComposerContextPopover";
import { useListHighlight } from "../composables/useListHighlight";
import { imeOwnsKey, popoverOwnsKey } from "../utils/slash-commands";
import {
  MODEL_WRITABLE_ONLY_NOTE,
  modalityLabelOf,
  splitByCurrentModel,
  versionBadgeOf,
  writableModels
} from "../utils/model-picker";
import type { HotkeyMods } from "../utils/hotkeys";

const props = defineProps<{
  anchor: HTMLElement;
  result: ModelListResult | null;
  loading: boolean;
  current: string;
  switching: boolean;
  switchError: string;
  capabilityLevels: readonly ThinkingLevel[];
  capabilityLevel: ThinkingLevel;
  capabilityWriting: boolean;
}>();
const emit = defineEmits<{
  close: [];
  retry: [];
  "open-settings": [];
  select: [model: string];
  "set-level": [level: ThinkingLevel];
}>();
const panel = ref<HTMLElement>();
const MENU_WIDTH = 280;
const MODEL_LIST_WIDTH = 340;
const SUBMENU_WIDTH = 176;
const PANEL_MAX_HEIGHT = 560;
const menuSection = ref<ModelMenuSection>("menu");
const panelWidth = computed(() => {
  if (menuSection.value === "models") return MENU_WIDTH + MODEL_LIST_WIDTH + 8;
  if (menuSection.value === "levels") return MENU_WIDTH + SUBMENU_WIDTH + 8;
  return MENU_WIDTH;
});
const horizontalOffset = computed(() => (menuSection.value === "levels" ? SUBMENU_WIDTH + 8 : 0));

const allModels = computed<string[]>(() =>
  props.result !== null && props.result.ok ? props.result.models : []
);
const upstream = computed<string[]>(() => writableModels(allModels.value));
const failReason = computed(() =>
  props.result !== null && !props.result.ok ? props.result.reason : ""
);
const split = computed(() =>
  splitByCurrentModel(upstream.value, props.current, props.current !== "")
);
const visibleNames = computed<string[]>(() => [...split.value.current, ...split.value.rest]);
const countText = computed(() => `${upstream.value.length} 个`);

function pickLevel(level: ThinkingLevel): void {
  emit("set-level", level);
  menuSection.value = "menu";
}
function toggleModels(): void {
  menuSection.value = menuSection.value === "models" ? "menu" : "models";
}

const rowEls = new Map<string, HTMLElement>();
function setRowRef(name: string, el: unknown): void {
  if (el instanceof HTMLElement) rowEls.set(name, el);
  else rowEls.delete(name);
}
const highlight = useListHighlight<string>({
  items: () => visibleNames.value,
  onPick: (name) => pick(name),
  elementOf: (name) => rowEls.get(name) ?? null
});
const activeName = computed<string>(() => highlight.activeItem.value ?? "");

const { style, close, tab, reposition, focus } = useComposerContextPopover(
  () => props.anchor,
  panel,
  () => emit("close"),
  {
    focusSelector: () => {
      if (menuSection.value === "models") return ":scope";
      if (menuSection.value === "levels") return ".model-select-submenu .model-select-option";
      return ".model-select-menu-row";
    },
    widthPx: () => panelWidth.value,
    limitPx: PANEL_MAX_HEIGHT,
    align: "end",
    horizontalOffsetPx: () => horizontalOffset.value
  }
);

watch(menuSection, () => {
  void nextTick(() => {
    reposition();
    focus();
  });
});

function pick(name: string): void {
  if (name === props.current) {
    close();
    return;
  }
  emit("select", name);
}

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
  if (event.key === "Tab") tab(event);
  if (menuSection.value !== "models") return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    highlight.move(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    highlight.activate(event.key === "Home" ? 0 : visibleNames.value.length - 1);
    highlight.reveal();
    return;
  }
  const target = event.target;
  const ownsEnter =
    target === panel.value ||
    (target instanceof HTMLElement && target.classList.contains("model-select-row"));
  if (event.key === "Enter" && ownsEnter) {
    if (imeOwnsKey(event)) return;
    event.preventDefault();
    highlight.pickActive();
  }
}

function setActive(name: string): void {
  const index = visibleNames.value.indexOf(name);
  if (index >= 0) highlight.activate(index);
}
</script>

<template>
  <Teleport to="body">
    <section
      ref="panel"
      class="model-select"
      :style="style"
      aria-label="切换模型"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <div v-if="menuSection === 'models'" class="model-select-main">
        <header class="model-select-head">
          <strong>切换模型</strong>
          <span v-if="upstream.length" class="model-select-count">{{ countText }}</span>
          <button class="model-select-close" type="button" aria-label="关闭模型列表" @click="close">
            <AppIcon name="close" :size="14" />
          </button>
        </header>

        <p v-if="switching" class="model-select-note">正在写回模型名…</p>
        <p v-if="capabilityWriting" class="model-select-note">正在写入模型能力…</p>
        <p v-if="switchError" class="model-select-error" role="alert">{{ switchError }}</p>
        <p v-if="loading" class="model-select-note">正在拉取模型名单…</p>
        <ul
          v-else-if="visibleNames.length"
          class="model-select-list"
          role="listbox"
          aria-label="模型名单"
        >
          <li v-if="split.current.length" class="model-select-section-head" role="presentation">
            正在用
          </li>
          <li v-for="name in split.current" :key="name" role="presentation">
            <button
              :ref="(el) => setRowRef(name, el)"
              type="button"
              role="option"
              class="model-select-row is-current"
              :class="{ 'is-selected': activeName === name }"
              :aria-selected="activeName === name"
              aria-current="true"
              :disabled="switching || capabilityWriting"
              @click="pick(name)"
              @mouseenter="setActive(name)"
              @focus="setActive(name)"
            >
              <span class="model-select-row-icon" aria-hidden="true">
                <AppIcon name="model" :size="12" />
              </span>
              <span class="model-select-name">{{ name }}</span>
              <span v-if="modalityLabelOf(name)" class="model-select-tag">{{
                modalityLabelOf(name)
              }}</span>
              <span class="model-select-meta">{{ versionBadgeOf(name) }}</span>
              <AppIcon class="model-select-check" name="check" :size="14" />
            </button>
          </li>
          <li v-for="name in split.rest" :key="name" role="presentation">
            <button
              :ref="(el) => setRowRef(name, el)"
              type="button"
              role="option"
              class="model-select-row"
              :class="{ 'is-selected': activeName === name }"
              :aria-selected="activeName === name"
              :disabled="switching || capabilityWriting"
              @click="pick(name)"
              @mouseenter="setActive(name)"
              @focus="setActive(name)"
            >
              <span class="model-select-row-icon" aria-hidden="true">
                <AppIcon name="model" :size="12" />
              </span>
              <span class="model-select-name">{{ name }}</span>
              <span class="model-select-meta">{{ versionBadgeOf(name) }}</span>
            </button>
          </li>
        </ul>
        <p v-else-if="allModels.length" class="model-select-note">
          上游给的模型里没有能用来写这一轮的。{{ MODEL_WRITABLE_ONLY_NOTE }}
        </p>
        <template v-else>
          <p v-if="failReason" class="model-select-error">{{ failReason }}</p>
          <p v-else class="model-select-error">还没拿到名单。</p>
          <div class="model-select-actions">
            <button class="model-select-retry" type="button" @click="emit('retry')">
              再试一次
            </button>
            <button class="model-select-settings" type="button" @click="emit('open-settings')">
              去模型设置
            </button>
          </div>
        </template>

        <div v-if="upstream.length && !loading" class="model-select-footer-actions">
          <button
            class="model-select-refresh"
            type="button"
            :disabled="switching"
            title="重新拉取模型名单（provider:list-models）"
            @click="emit('retry')"
          >
            <AppIcon name="refresh" :size="13" />
            刷新模型列表
          </button>
        </div>
      </div>

      <ModelSelectMenu
        :model="props.current"
        :level="props.capabilityLevel"
        :levels="props.capabilityLevels"
        :section="menuSection"
        :capability-writing="props.capabilityWriting"
        :error="props.switchError"
        @open-models="toggleModels"
        @open-levels="menuSection = 'levels'"
        @back="menuSection = 'menu'"
        @pick-level="(level) => pickLevel(level)"
        @open-settings="emit('open-settings')"
      />
    </section>
  </Teleport>
</template>
