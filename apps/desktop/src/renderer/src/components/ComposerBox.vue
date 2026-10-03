<!-- 输入区：发送 / 打断 / 断流后续写。这里不含业务判断，一切交给 store；输入值本身也由 store 持有（F-A 前置）。 -->
<script setup lang="ts">
import { computed } from "vue";
import type { PermissionMode } from "@mochen/contracts";
import AppIcon from "./AppIcon.vue";
import { composerChips, type ComposerChipId } from "../utils/composer-chips";

const props = defineProps<{
  running: boolean;
  ready: boolean;
  canContinue: boolean;
  modelValue: string;
  hasBook: boolean;
  permissionMode: PermissionMode | null; // 档位联合一律从 contracts 来，不在组件里手抄三元（铁律 6）
  permissionSaving: boolean;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: string];
  send: [text: string];
  stop: [];
  resume: [];
  "open-permission-menu": [];
  "open-palette": [];
}>();

// 值只有一份：读写都经 props/emit 走 store.composerDrafts，且必须用 v-model——
// 裸 :value + @input 会丢掉 Vue 的 IME 组合守卫，拼音候选期间的任何一次 store 写入都会打断输入。
const draft = computed({
  get: () => props.modelValue,
  set: (value: string) => emit("update:modelValue", value)
});

// F-D chip 行：只放两枚真开关，判定全部下沉 composerChips（权限侧内部只调 permissionChipView 一次）。
const chips = computed(() =>
  composerChips({
    hasBook: props.hasBook,
    mode: props.permissionMode,
    saving: props.permissionSaving
  })
);

// 模板不做判定、不出现第二份事件字面量（T9-4③）：id→事件的映射表由 Record 的穷尽性当编译关卡。
const CHIP_EMIT: Record<ComposerChipId, "open-permission-menu" | "open-palette"> = {
  permission: "open-permission-menu",
  palette: "open-palette"
};
function onChipClick(id: ComposerChipId): void {
  emit(CHIP_EMIT[id]);
}

// 发送只抛事件，清格由装配处（CenterColumn）负责：那里才是「发出去 = 清这一格」的唯一收口。
function submit(): void {
  const value = props.modelValue.trim();
  if (value === "") return;
  emit("send", value);
}

// 回车提交 / Shift+Enter 与 Ctrl+J 换行 / 运行中 Tab 排队全在 utils/hotkeys + composables/useHotkeys 判定，
// 值经 store 的 composerDrafts 与本 textarea 同源（v-model 计算属性），不再有第二份监听（裁定 G5）。
</script>

<template>
  <footer class="agent-composer">
    <textarea
      v-model="draft"
      data-mochen-composer
      class="composer-box"
      rows="3"
      :placeholder="
        ready
          ? '想改哪一段？说给人话，别贴整篇正文——它会自己读文件。'
          : '先在左栏打开作品，或在右上角设置里配好模型。'
      "
    />
    <div class="composer-chips" role="group" aria-label="输入区开关">
      <button
        v-for="chip in chips"
        :key="chip.id"
        class="composer-chip"
        type="button"
        :disabled="chip.disabled"
        :title="chip.title"
        @click="onChipClick(chip.id)"
      >
        {{ chip.text }}
      </button>
      <!-- 裁定 C：这一句是纯静态键位说明——不读计数、不带 click、不是徽标；队列数字唯一真身在状态行。 -->
      <span class="composer-chip-hint">运行中按 Tab 可排队指令</span>
    </div>
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
        :disabled="running || modelValue.trim() === ''"
        @click="submit()"
      >
        <AppIcon name="arrow-up" :size="15" />
        <span>发送</span>
      </button>
    </div>
  </footer>
</template>
