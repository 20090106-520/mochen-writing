<!-- 输入区：发送 / 打断 / 断流后续写。这里不含业务判断，一切交给 store；输入值本身也由 store 持有（F-A 前置）。 -->
<script setup lang="ts">
import { computed } from "vue";
import type { PermissionMode, ThinkingLevel } from "@mochen/contracts";
import AppIcon from "./AppIcon.vue";
import {
  composerChips,
  composerCounter,
  CHIP_EMIT,
  type ComposerChipId
} from "../utils/composer-chips";

const props = defineProps<{
  running: boolean;
  ready: boolean;
  canContinue: boolean;
  modelValue: string;
  hasBook: boolean;
  permissionMode: PermissionMode | null; // 档位联合一律从 contracts 来，不在组件里手抄三元（铁律 6）
  permissionSaving: boolean;
  thinkingLevel: ThinkingLevel;
  webSearchEnabled: boolean;
  modelLabel: string;
  baseURL: string;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: string];
  send: [text: string];
  stop: [];
  resume: [];
  "open-permission-menu": [];
  "cycle-thinking": [];
  "toggle-web-search": [];
  "open-tool-roster": [];
  "open-model-select": [];
  "open-palette": [];
}>();

// 值只有一份：读写都经 props/emit 走 store.composerDrafts，且必须用 v-model——裸 :value + @input 会丢掉 Vue 的 IME 组合守卫。
const draft = computed({
  get: () => props.modelValue,
  set: (value: string) => emit("update:modelValue", value)
});

// F-D chip 行：六枚真开关/入口，判定全部下沉 composerChips（权限侧内部只调 permissionChipView 一次）。
const chips = computed(() =>
  composerChips({
    hasBook: props.hasBook,
    mode: props.permissionMode,
    saving: props.permissionSaving,
    thinkingLevel: props.thinkingLevel,
    webSearchEnabled: props.webSearchEnabled,
    modelLabel: props.modelLabel,
    baseURL: props.baseURL
  })
);
// 计数条与主进程边界共用 USER_TEXT_MAX_LEN：这里说没超，发出去就不会被拒。
const counter = computed(() => composerCounter(props.modelValue));

// 模板不做判定、不出现第二份事件字面量（T9-4③）。CHIP_EMIT 映射表住在 composer-chips.ts：
// 本仓 verify 用裸 tsc，`.vue` 不进类型程序，穷尽性关卡只有落在 `.ts` 才咬得住（定义处注释有 WHY 与变异实测）。
function onChipClick(id: ComposerChipId): void {
  emit(CHIP_EMIT[id]);
}

// 发送只抛事件，清格由装配处（CenterColumn）负责：那里才是「发出去 = 清这一格」的唯一收口。
function submit(): void {
  const value = props.modelValue.trim();
  if (value === "") return;
  emit("send", value);
}

// 回车提交 / Shift+Enter 与 Ctrl+J 换行 / 运行中 Tab 排队全在 utils/hotkeys + composables/useHotkeys 判定（裁定 G5）。
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
        :aria-pressed="chip.active"
        @click="onChipClick(chip.id)"
      >
        {{ chip.text }}
      </button>
      <!-- 裁定 C：这一句是纯静态键位说明——不读计数、不带 click、不是徽标；队列数字唯一真身在状态行。 -->
      <span class="composer-chip-hint">运行中按 Tab 可排队指令</span>
    </div>
    <div class="composer-actions">
      <!-- 计数条：超上限时换成中文理由并翻红，同时禁用发送——主进程边界本来就会拒，这里不让你白按一次。 -->
      <span class="composer-counter" :class="{ 'composer-counter--over': counter.over }">
        {{ counter.over ? `已超出上限，先删一点（${counter.text}）` : counter.text }}
      </span>
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
      <!-- 发送键的 disabled 不配 title：Chromium 不给 disabled 按钮弹提示，理由由上面那行计数条说给人看。 -->
      <button
        class="composer-send"
        type="button"
        :disabled="running || modelValue.trim() === '' || counter.over"
        @click="submit()"
      >
        <AppIcon name="arrow-up" :size="15" />
        <span>发送</span>
      </button>
    </div>
  </footer>
</template>
