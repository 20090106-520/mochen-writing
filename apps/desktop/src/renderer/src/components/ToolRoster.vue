<!--
  工具 ▾ 的浮层（2026-10-21 改造）。
  这一版起每一行**真的能关**：关掉的工具在 `toolsFor` / `toolGateOf` 两处同时摘掉，
  模型既看不到它、仿历史里硬调也会被闸住并画一张「被关掉」的工具卡——不是「按了没反应的按钮」。
  行集仍来自 toolRoster(联网开关)（唯一名单在 contracts 的 AGENT_TOOL_NAMES）；
  联网关着时 web_search 本来就不出站，那一行跟着从清单里消失。
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import { toolRoster } from "../utils/tool-roster";
import { useModalFocus } from "../composables/useModalFocus";

const props = defineProps<{ webSearchEnabled: boolean; disabledTools: readonly string[] }>();
const emit = defineEmits<{ close: []; toggle: [name: string] }>();
const panel = ref<HTMLElement>();
const rows = computed(() => toolRoster(props.webSearchEnabled));
const enabledCount = computed(() => rows.value.filter((row) => !isOff(row.name)).length);

function isOff(name: string): boolean {
  return props.disabledTools.includes(name);
}

// 焦点进出、Esc、Tab 困在层内、焦点归位、顶层栈：全在 useModalFocus 一处（批次 5-㊱，5-㊵ 收编本枚）。
// 本组件由 CenterColumn 的 v-if 挂载，所以不传 isOpen —— 挂载即开、卸载即关。
useModalFocus({ root: panel, close: () => emit("close") });
</script>

<template>
  <div class="tool-roster-mask" @click.self="emit('close')">
    <div
      ref="panel"
      class="tool-roster"
      role="dialog"
      aria-modal="true"
      aria-label="它带的工具"
      tabindex="-1"
    >
      <header class="tool-roster-head">
        <div class="tool-roster-heading">
          <h3 class="tool-roster-title">它带的工具</h3>
          <p class="tool-roster-sub">
            这一轮带出 {{ enabledCount }} / {{ rows.length }} 枚 · 关掉的这一轮不会出站
          </p>
        </div>
        <button class="tool-roster-x" type="button" aria-label="关闭" @click="emit('close')">
          ×
        </button>
      </header>

      <ul class="tool-roster-list">
        <li
          v-for="row in rows"
          :key="row.name"
          class="tool-roster-row"
          :class="{ 'is-off': isOff(row.name) }"
        >
          <div class="tool-roster-text">
            <span class="tool-roster-line">
              <strong>{{ row.label }}</strong>
              <code class="tool-roster-name">{{ row.name }}</code>
              <span class="tool-roster-kind" :data-kind="row.kind">{{ row.kind }}</span>
            </span>
            <p>{{ row.effect }}</p>
          </div>
          <button
            class="tool-roster-switch"
            type="button"
            role="switch"
            :aria-checked="!isOff(row.name)"
            :aria-label="`${row.label}：${isOff(row.name) ? '这一轮关闭' : '这一轮带上'}`"
            @click="emit('toggle', row.name)"
          >
            {{ isOff(row.name) ? "已关" : "带上" }}
          </button>
        </li>
      </ul>

      <p class="tool-roster-foot">
        工具由模型自己挑，你只管把不该用的摘掉；能改盘的那几枚仍要过输入区的权限档。
      </p>
    </div>
  </div>
</template>
