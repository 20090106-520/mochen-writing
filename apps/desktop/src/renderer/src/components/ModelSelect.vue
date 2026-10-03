<!-- 模型 ▾ 的浮层（#104）：候选名单只来自 provider:list-models（主进程按自己的配置出网，密钥不进 URL）。
     当前模型那一行刻意做成徽章而不是按钮——再点一次只是把同一个值存回去，那是「按了没反应的按钮」。
     地址与密钥不在这里改：这里没有那两个输入格，能改的只有模型名。 -->
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { ModelListResult } from "@mochen/contracts";

const props = defineProps<{
  result: ModelListResult | null;
  loading: boolean;
  current: string;
  switching: boolean;
}>();
const emit = defineEmits<{ close: []; retry: []; select: [model: string] }>();
const panel = ref<HTMLElement | null>(null);

/** 名单与理由都从 props 来：本组件不碰 window.mochen，出网判定全在主进程。 */
const rows = computed<string[]>(() =>
  props.result !== null && props.result.ok ? props.result.models : []
);
const failReason = computed(() =>
  props.result !== null && !props.result.ok ? props.result.reason : ""
);

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  emit("close");
}

onMounted(() => panel.value?.focus());
</script>

<template>
  <div class="model-select-mask" @click.self="emit('close')">
    <div
      ref="panel"
      class="model-select"
      role="dialog"
      aria-modal="true"
      aria-label="选择模型"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <h3 class="model-select-title">这一轮用哪个模型</h3>
      <p v-if="loading" class="model-select-note">正在拉取模型名单…</p>
      <ul v-else-if="rows.length" class="model-select-list">
        <li v-for="name in rows" :key="name" class="model-select-row">
          <code class="model-select-name">{{ name }}</code>
          <span v-if="name === current" class="model-select-badge">当前</span>
          <button
            v-else
            class="model-select-pick"
            type="button"
            :disabled="switching"
            @click="emit('select', name)"
          >
            改用
          </button>
        </li>
      </ul>
      <template v-else>
        <p v-if="failReason" class="model-select-error">{{ failReason }}</p>
        <p v-else class="model-select-error">还没拿到名单。</p>
        <button class="model-select-retry" type="button" @click="emit('retry')">再试一次</button>
      </template>
      <!-- 忙态理由必须是看得见的文字：disabled 按钮在 Chromium 里不弹 title，光靠禁用等于没说。 -->
      <p v-if="switching" class="model-select-note">正在写回模型名…</p>
      <p class="model-select-foot">
        名单来自 provider:list-models（主进程按模型设置里的 baseURL
        出网）。改地址、换密钥或手填模型名，都在模型设置里做。
      </p>
      <button class="model-select-close" type="button" @click="emit('close')">关闭</button>
    </div>
  </div>
</template>
