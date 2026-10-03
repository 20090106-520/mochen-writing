<!-- 输入区：一张圆角卡，结构照搬 deepwrite 的 ConversationComposer（Apache-2.0）——
     composer-wrap/composer/composer-input-surface 三层骨架、rows=1 + field-sizing 自增高、
     toolbar 左右分栏、同一位置的 发送↔stop 形变、忙态整卡 is-disabled 压暗。
     裁定的落点：A 计数条常态不占位、只在接近/超限显形（超限有看得见的理由）；
     B 忙态只压暗不禁用 textarea（Tab 排队通路原样保留）；
     C（#112 改判）`＋` 与麦克风照参考图进卡：＋ 接的是本仓真有的「引用素材」通路（与手打 @ 同一个入口），
       麦克风仍是参考仓自己那一枚 disabled 占位——它的理由写在卡下那行可见提示里，不靠 title 兜。
     这里不含业务判断，一切交给 store；输入值本身也由 store 持有（F-A 前置）。 -->
<script setup lang="ts">
import { computed } from "vue";
import type { PermissionMode, ThinkingLevel } from "@mochen/contracts";
import AppIcon from "./AppIcon.vue";
import ComposerReferenceMenu from "./ComposerReferenceMenu.vue";
import PermissionMenu from "./PermissionMenu.vue";
import {
  composerChips,
  composerCounter,
  COMPOSER_HINT,
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
  "open-mention": [];
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
// 键位提示只有卡下那一行常驻真身（COMPOSER_HINT，#112 照参考图）：textarea 的 title 已删——
// 同一套键位在 hover 里再说一遍是第二份文案，而 disabled 元素 Chromium 根本不弹 title，靠它兜理由等于没有。
</script>

<template>
  <footer class="composer-wrap">
    <div class="composer" :class="{ 'is-disabled': running }">
      <div class="composer-input-surface">
        <!-- #106：行内引用菜单锚在这层 surface（它本就 position:relative），整卡宽、向上开——
             与 deepwrite 的 .composer-stack + .composer-reference-menu 同一形态（裁定 D4）。
             刻意不放进 .composer-toolbar-right：那是权限弹层的定位祖先，抢了它弹层就会跟着菜单跑。 -->
        <ComposerReferenceMenu />
        <textarea
          v-model="draft"
          data-mochen-composer
          class="composer-textarea"
          rows="1"
          :placeholder="
            ready
              ? '随心输入，输入 / 调用技能，输入 @ 引用素材……'
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
            <!-- #112 照参考图：`＋` 是左端第一枚圆钮。他那里是「上传附件」，本仓没有附件通道（contracts 无
                 attachment 字段、无落盘通路），所以这枚钮接的是我们真有的那条：与手打 @ 同一个入口 ⇒ 名字如实叫「引用素材」。 -->
            <button
              class="round-tool-button"
              type="button"
              aria-label="引用素材"
              title="引用本书里的素材（与直接输入 @ 同一个入口）"
              @click="emit('open-mention')"
            >
              <AppIcon name="plus" :size="18" />
            </button>
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
              <AppIcon class="composer-chip-icon" :name="chip.icon" :size="14" />
              <span class="composer-chip-label">{{ chip.text }}</span>
              <AppIcon v-if="chip.caret" class="composer-chip-caret" name="chevron" :size="11" />
            </button>
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
              <AppIcon class="composer-chip-icon" :name="chip.icon" :size="14" />
              <span class="composer-chip-label">{{ chip.text }}</span>
              <AppIcon v-if="chip.caret" class="composer-chip-caret" name="chevron" :size="11" />
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
            <!-- 麦克风：照搬参考图那一枚 disabled 占位（他在源码里也是 disabled + 「语音功能后续开放」）。
                 禁用的理由必须看得见 ⇒ 那句写在卡下 COMPOSER_HINT 里，不靠 Chromium 根本不弹的 title。 -->
            <button class="round-tool-button" type="button" disabled aria-label="语音功能后续开放">
              <AppIcon name="mic" :size="18" />
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
    <!-- 卡下常驻键位提示（#112 照参考图）：文案真身是 composer-chips.ts 的 COMPOSER_HINT，这里只渲染它。 -->
    <p class="composer-hint">{{ COMPOSER_HINT }}</p>
  </footer>
</template>
