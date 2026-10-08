<!-- 上下文占用条的展开面板（折叠态那一枚在 ContextMeter.vue）。
     真身：utils/context-meter.ts 的 contextMeterRows——条目、类别标签、字数都在那边算好，
     这里只渲染。定位与「点外面/Esc/Tab 触边就收起」走 useComposerContextPopover，
     与阶段弹层、权限档弹层同一份实现，不另造一套。

     独立成组件而不是塞回 ContextMeter：popover 那个 composable 在 onMounted 就去量锚点，
     而折叠态那枚钮是等主进程回包之后才渲染的——两者同处一个组件会量到 undefined。 -->
<script setup lang="ts">
import { ref, useId } from "vue";
import AppIcon from "./AppIcon.vue";
import { useComposerContextPopover } from "../composables/useComposerContextPopover";
import { imeOwnsKey, popoverOwnsKey } from "../utils/slash-commands";
import type { ContextMeterRow } from "../utils/context-meter";

const props = defineProps<{
  anchor: HTMLElement;
  rows: readonly ContextMeterRow[];
  profileName: string;
}>();
const emit = defineEmits<{ close: [] }>();

const titleId = useId();
const panel = ref<HTMLElement>();
const { style, close, tab } = useComposerContextPopover(
  () => props.anchor,
  panel,
  () => emit("close")
);

function keydown(event: KeyboardEvent): void {
  const mods = {
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey
  };
  // 裸 Esc（且不在输入法组合中）才归弹层：与阶段弹层共用 popoverOwnsKey，模板里不写裸比较。
  if (popoverOwnsKey(event.key, mods, imeOwnsKey(event))) {
    event.stopPropagation();
    close();
    return;
  }
  tab(event);
}
</script>

<template>
  <Teleport to="body">
    <section
      ref="panel"
      class="context-meter-panel"
      :style="style"
      tabindex="-1"
      role="dialog"
      :aria-labelledby="titleId"
      @keydown="keydown"
    >
      <header class="context-meter-head">
        <strong :id="titleId">这一轮会带这些上下文</strong>
        <button
          class="context-picker-close"
          type="button"
          aria-label="关闭上下文清单"
          @click="close"
        >
          <AppIcon name="close" :size="15" />
        </button>
      </header>
      <p class="context-meter-note">按当前档案「{{ profileName }}」装配</p>
      <ul class="context-meter-list">
        <li v-for="row in rows" :key="row.key" :class="{ 'is-active': row.active }">
          <span class="context-meter-kind">{{ row.label }}</span>
          <span class="context-meter-title" :title="row.title">{{ row.title }}</span>
          <span class="context-meter-chars">{{ row.charsLabel }}</span>
        </li>
      </ul>
    </section>
  </Teleport>
</template>
