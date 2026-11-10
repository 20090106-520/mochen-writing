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
import type { ContextMeterRow, ContextPressureReading } from "../utils/context-meter";

const props = defineProps<{
  anchor: HTMLElement;
  rows: readonly ContextMeterRow[];
  profileName: string;
  /**
   * 窗口压力 + 已挂入项数那一行：整句由 utils/context-meter.ts 组好（连「该不该显形」都由
   * 它判），面板只渲染。与 historyNotice 同一条纪律——面板不许自己除窗口、数挂入条目。
   */
  pressure?: ContextPressureReading;
  /**
   * P1-3 截断提示：那句话整句由 utils/history-window.ts 组好，面板只渲染。
   * 可选——空串/缺省都不显形；面板不许自己碰条数字（判据只许一处）。
   */
  historyNotice?: string;
}>();
const emit = defineEmits<{ close: [] }>();

const titleId = useId();
const panel = ref<HTMLElement>();
const { style, close, tab } = useComposerContextPopover(
  () => props.anchor,
  panel,
  () => emit("close"),
  { widthPx: 420 }
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
      <!-- 窗口压力：主读一行（百分比 + tokens，不折行）＋ 分项一行（设定 / 挂入 / 技能 / 库索引）。
           2026-11-10 拆两行：分项加到六项之后，一行在 460px 面板里必然折，且断在数字中间。 -->
      <p v-if="pressure?.visible" class="context-meter-pressure" :title="pressure.title">
        <span class="context-meter-pressure-main">{{ pressure.text }}</span>
        <span v-if="pressure.detail" class="context-meter-pressure-sub">{{ pressure.detail }}</span>
      </p>
      <ul class="context-meter-list">
        <li v-for="row in rows" :key="row.key" :class="{ 'is-active': row.active }">
          <span class="context-meter-kind">{{ row.label }}</span>
          <span class="context-meter-title" :title="row.title">{{ row.title }}</span>
          <span class="context-meter-chars">{{ row.charsLabel }}</span>
        </li>
      </ul>
      <!-- P1-3 截断提示：整句话由 util 组好递进来，面板不数条数（v-if 挂在值上，空串即不显形）。 -->
      <p v-if="historyNotice" class="context-meter-history-notice">{{ historyNotice }}</p>
    </section>
  </Teleport>
</template>
