<!-- 输入区：发送 / 打断 / 断流后续写。这里不含业务判断，一切交给 store。 -->
<script setup lang="ts">
import { ref } from "vue";
import AppIcon from "./AppIcon.vue";

defineProps<{ running: boolean; ready: boolean; canContinue: boolean }>();
const emit = defineEmits<{ send: [text: string]; stop: []; resume: [] }>();

const text = ref("");

function submit(): void {
  const value = text.value.trim();
  if (value === "") return;
  text.value = "";
  emit("send", value);
}

// 回车提交 / Shift+Enter 与 Ctrl+J 换行 / 运行中 Tab 排队的判断全部交回全局层
// （utils/hotkeys.ts + composables/useHotkeys.ts 经 [data-mochen-composer] 读写同一个 DOM 值，
// 与下面的 v-model 同源）。本组件不再自带 @keydown——两处监听就是两份裁决（spec §5 接线、裁定 G5）。
</script>

<template>
  <footer class="agent-composer">
    <textarea
      v-model="text"
      data-mochen-composer
      class="composer-box"
      rows="3"
      :placeholder="
        ready
          ? '想改哪一段？说给人话，别贴整篇正文——它会自己读文件。'
          : '先在左栏打开作品，或在右上角设置里配好模型。'
      "
    />
    <div class="composer-actions">
      <span class="composer-hint">Enter 发送 · Shift+Enter 换行 · Esc 打断</span>
      <button v-if="running" class="composer-stop" type="button" @click="emit('stop')">
        <AppIcon name="stop" :size="14" />
        <span>打断</span>
      </button>
      <button
        v-if="canContinue && !running"
        class="composer-resume"
        type="button"
        title="接着上一轮未写完的地方继续（残字已经在对话里）"
        @click="emit('resume')"
      >
        <AppIcon name="redo" :size="14" />
        <span>继续</span>
      </button>
      <button
        class="composer-send"
        type="button"
        :disabled="running || text.trim() === ''"
        @click="submit()"
      >
        <AppIcon name="arrow-up" :size="15" />
        <span>发送</span>
      </button>
    </div>
  </footer>
</template>
