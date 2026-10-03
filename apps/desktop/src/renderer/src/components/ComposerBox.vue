<!-- 输入区：一张圆角卡，结构照搬 deepwrite 的 ConversationComposer（Apache-2.0）——
     composer-wrap/composer/composer-input-surface 三层骨架、rows=1 + field-sizing 自增高、
     toolbar 左右分栏、同一位置的 发送↔stop 形变、忙态整卡 is-disabled 压暗。
     三条裁定的落点：A 计数条常态不占位、只在接近/超限显形（超限有看得见的理由）；
     B 忙态只压暗不禁用 textarea（Tab 排队通路原样保留）；C 附件(+)/麦克风没有通道，不进 UI。
     这里不含业务判断，一切交给 store；输入值本身也由 store 持有（F-A 前置）。 -->
<script setup lang="ts">
import { computed } from "vue";
import type { PermissionMode, ThinkingLevel } from "@mochen/contracts";
import AppIcon from "./AppIcon.vue";
import PermissionMenu from "./PermissionMenu.vue";
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
  // #105：权限档弹层真身挂到卡右端（deepwrite 的「更多」那一端）；开合仍由装配处的 useBookStore 裁决。
  permissionMenuOpen: boolean;
  thinkingLevel: ThinkingLevel;
  webSearchEnabled: boolean;
  modelLabel: string;
  // prop 名必须是 `baseUrl` 而不是 `baseURL`：模板里的 kebab 绑定 `:base-url` 被 Vue camelize 成 `baseUrl`，
  // 声明成 `baseURL` 时它根本收不到值（真机实测：chip 的 title 拼出 `undefined/models`）。
  // 往里交给 composerChips 的参数仍叫 `baseURL`，那是对齐 contracts 的 ProviderView 字段名。
  baseUrl: string;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: string];
  send: [text: string];
  stop: [];
  resume: [];
  "open-permission-menu": [];
  "close-permission-menu": [];
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
    baseURL: props.baseUrl
  })
);
// #105 左右分栏：栏位是 composerChips 表里的 slot 字段，这里只过滤——模板不养第二份顺序表（铁律 6）。
const chipsLeft = computed(() => chips.value.filter((c) => c.slot === "left"));
const chipsRight = computed(() => chips.value.filter((c) => c.slot === "right"));
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
// 键位提示按 deepwrite 的做法住在 title 里，不再单独占一行静态文字（textarea 的 title 见模板）。
</script>

<template>
  <footer class="composer-wrap">
    <div class="composer" :class="{ 'is-disabled': running }">
      <div class="composer-input-surface">
        <textarea
          v-model="draft"
          data-mochen-composer
          class="composer-textarea"
          rows="1"
          title="Enter 发送 · Shift+Enter 换行 · Esc 打断 · 运行中按 Tab 排队指令"
          :placeholder="
            ready
              ? '想改哪一段？说给人话，别贴整篇正文——它会自己读文件。'
              : '先在左栏打开作品，或在右上角设置里配好模型。'
          "
        />
        <!-- 裁定 A：常态不占位；接近上限显计数，超限翻红 + 禁用发送 + 中文理由（Chromium 不给 disabled 弹 title，理由必须是看得见的文字）。 -->
        <div
          v-if="counter.over || counter.near"
          class="composer-counter"
          :class="{ 'composer-counter--over': counter.over }"
        >
          {{
            counter.over ? `已超出上限，先删一点（${counter.text}）` : `接近上限（${counter.text}）`
          }}
        </div>
        <div class="composer-toolbar">
          <div class="composer-toolbar-left" role="group" aria-label="输入区开关">
            <button
              v-for="chip in chipsLeft"
              :key="chip.id"
              class="composer-chip"
              type="button"
              :disabled="chip.disabled || running"
              :title="chip.title"
              :aria-pressed="chip.active"
              @click="onChipClick(chip.id)"
            >
              <AppIcon v-if="chip.badge === 'globe'" name="globe" :size="11" />
              {{ chip.text }}
            </button>
            <!-- 裁定 C/B：这一句是纯静态键位说明——不读计数、不带 click、不是徽标；队列数字唯一真身在状态行。 -->
            <span class="composer-chip-hint">运行中按 Tab 可排队指令</span>
          </div>
          <div class="composer-toolbar-right" role="group" aria-label="模型与发送">
            <button
              v-for="chip in chipsRight"
              :key="chip.id"
              class="composer-chip"
              type="button"
              :disabled="chip.disabled || running"
              :title="chip.title"
              :aria-pressed="chip.active"
              @click="onChipClick(chip.id)"
            >
              <AppIcon v-if="chip.badge === 'globe'" name="globe" :size="11" />
              {{ chip.text }}
            </button>
            <!-- 权限档弹层真身（#105）：开关与关闭都由装配处经 props/emit 交给 useBookStore 裁决。 -->
            <PermissionMenu v-if="permissionMenuOpen" @close="emit('close-permission-menu')" />
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
            <!-- 同一枚位置的 发送↔stop 形变（deepwrite）：v-if/v-else 互斥，不是并排两枚。 -->
            <button
              v-if="running"
              class="send-button stop-button"
              type="button"
              aria-label="停止生成"
              title="停止生成"
              @click="emit('stop')"
            >
              <AppIcon name="stop" :size="15" />
            </button>
            <button
              v-else
              class="send-button"
              type="button"
              aria-label="发送消息"
              :disabled="modelValue.trim() === '' || counter.over"
              @click="submit()"
            >
              <AppIcon name="arrow-up" :size="18" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </footer>
</template>
