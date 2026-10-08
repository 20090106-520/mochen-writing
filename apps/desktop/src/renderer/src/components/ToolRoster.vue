<!-- 工具 ▾ 的浮层：只读清单，行集来自 toolRoster(联网开关)（唯一名单在 contracts 的 AGENT_TOOL_NAMES）。
     这里刻意没有任何**逐枚**开关——列出来的工具一并交给模型自选（tool_choice: "auto"），
     画成能一枚一枚点掉的样子就是「按了没反应的按钮」。唯一的例外是联网：它本来就是输入区那枚真开关，
     关掉那一轮 web_search 根本不出站，所以这一行跟着从清单里消失（清单报的是真带出去的那几枚）。 -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { toolRoster } from "../utils/tool-roster";
import { useModalFocus } from "../composables/useModalFocus";

const props = defineProps<{ webSearchEnabled: boolean }>();
const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLElement>();
const rows = computed(() => toolRoster(props.webSearchEnabled));

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
      <h3 class="tool-roster-title">这一轮带出去的工具（{{ rows.length }} 枚）</h3>
      <ul class="tool-roster-list">
        <li v-for="row in rows" :key="row.name" class="tool-roster-row">
          <code class="tool-roster-name">{{ row.name }}</code>
          <span class="tool-roster-kind" :data-kind="row.kind">{{ row.kind }}</span>
          <div class="tool-roster-text">
            <strong>{{ row.label }}</strong>
            <p>{{ row.effect }}</p>
          </div>
        </li>
      </ul>
      <p class="tool-roster-foot">
        工具由模型自己挑，这一格不能单独禁用某一枚；能控的是权限档与输入区的思考 / 联网开关。
      </p>
      <button class="tool-roster-close" type="button" @click="emit('close')">关闭</button>
    </div>
  </div>
</template>
