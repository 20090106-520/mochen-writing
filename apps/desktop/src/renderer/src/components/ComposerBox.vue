<!-- 输入区：一张圆角卡，结构对齐 deepwrite 的 ConversationComposer——
     composer-wrap/composer/composer-input-surface 三层骨架、rows=1 + field-sizing 自增高、
     toolbar 左右分栏、同一位置的 发送↔stop 形变、忙态整卡 is-disabled 压暗。
     裁定的落点：A 计数条常态不占位、只在接近/超限显形（超限有看得见的理由）；
     B 忙态只压暗不禁用 textarea（Tab 排队通路原样保留）；
     C（#112 改判）`＋` 与麦克风照参考图进卡：＋ 接的是本仓真有的「引用素材」通路（与手打 @ 同一个入口）。
     麦克风这一枚（语音输入，2026-10-06）不再是 disabled 占位：它接的是 Web Speech API 的真通路，
     判定全部下沉 composables/voice-input.ts（能不能按 / 错误码翻人话 / 怎么追加截断），
     本组件只渲染 `voice.button` / `voice.hint` 并转发 `voice.toggle()`。
     **诚实边界**（2026-10-06 真机实测后改过一次）：本机（Electron 42.5 / Chromium 148）里
     `SpeechRecognition` **在**、能构造、`start()` 成功、麦克风真开了（`audiostart` 有来），
     只是 9 秒静默后回 `no-speech` + `end` —— 没有 network / service-not-allowed，所以识别服务是通的。
     另一台机器仍可能落到降级支，那时按钮禁用 + 卡下那行**看得见**的理由，
     不靠 title 兜（Chromium 不给 disabled 元素弹 title）。绝不允许画成可点、点了没反应。
     这里不含业务判断，一切交给 store；输入值本身也由 store 持有（F-A 前置）。 -->
<script setup lang="ts">
import { computed, ref } from "vue";
import type { PermissionMode, ThinkingLevel, WorkMode } from "@mochen/contracts";
import AppIcon from "./AppIcon.vue";
import ComposerContextBar from "./ComposerContextBar.vue";
import ComposerReferenceMenu from "./ComposerReferenceMenu.vue";
import PermissionMenu from "./PermissionMenu.vue";
import { useVoiceInput } from "../composables/useVoiceInput";
import {
  composerChips,
  composerCounter,
  CHIP_EMIT,
  type ComposerChipId
} from "../utils/composer-chips";

const props = defineProps<{
  running: boolean;
  ready: boolean;
  modelValue: string;
  hasBook: boolean;
  // #113c：绑定条只在「已开书 + 这一格还没消息」时显形，判定住装配处（CenterColumn 用 utils 的 showContextBar）。
  contextBarVisible: boolean;
  permissionMode: PermissionMode | null; // 档位联合一律从 contracts 来，不在组件里手抄三元（铁律 6）
  // 先计划后动手（2026-10-05 批次 4）。没开书时读老书那一格：workModeOf 兜成「直接动手」。
  workMode: WorkMode;
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
  "open-permission-menu": [];
  "close-permission-menu": [];
  "toggle-work-mode": [];
  "cycle-thinking": [];
  "toggle-web-search": [];
  "open-tool-roster": [];
  "open-model-select": [anchor: HTMLElement];
  "open-palette": [];
  "open-mention": [];
}>();

/**
 * 模型 chip 的 DOM 元素（2026-10-07）。
 *
 * 下拉浮层贴在 chip 下面，而 chip 在**这个组件的模板里**，所以锚点只能从这里交上去：
 * `composer-chips` 那张表只有 id / 文案 / 图标，元素是渲染期才有的东西，表里放不了。
 * 装配处（CenterColumn）拿到它转手当 ModelSelect 的 `anchor` prop——浮层自己不去 DOM 里搜按钮，
 * 那样一旦 chip 重排或改名，锚点会静默指空、浮层跟着飞到屏幕角落。
 */
const modelChip = ref<HTMLElement | null>(null);

function setChipRef(id: ComposerChipId, el: unknown): void {
  if (id === "model" && el instanceof HTMLElement) modelChip.value = el;
}

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
    workMode: props.workMode,
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

// 语音输入：值仍只有 draft 那一份（不新开一条状态），判定与文案全在 composables/voice-input.ts。
// 这里只交出三件事：读现有值、写回现有值、这一轮是否在生成（开始生成时交还麦克风）。
const voice = useVoiceInput({
  read: () => draft.value,
  write: (text: string) => {
    draft.value = text;
  },
  running: () => props.running
});

// 模板不做判定、不出现第二份事件字面量（T9-4③）。CHIP_EMIT 映射表住在 composer-chips.ts：
// 本仓 verify 用裸 tsc，`.vue` 不进类型程序，穷尽性关卡只有落在 `.ts` 才咬得住（定义处注释有 WHY 与变异实测）。
// 模型 chip 是唯一的例外分支：它是七枚里唯一一枚要把**自己**交出去的（下拉浮层要拿它当锚点），
// 所以载荷在那一条上补；其余六枚仍原样走表，窄化后 `CHIP_EMIT[id]` 的类型也不再含它。
function onChipClick(id: ComposerChipId): void {
  if (id === "model") {
    // 元素还没挂上就什么都不做：宁可不弹，也不弹一个没有锚点的浮层。
    if (modelChip.value !== null) emit("open-model-select", modelChip.value);
    return;
  }
  emit(CHIP_EMIT[id]);
}

// 发送只抛事件，清格由装配处（CenterColumn）负责：那里才是「发出去 = 清这一格」的唯一收口。
function submit(): void {
  const value = props.modelValue.trim();
  if (value === "") return;
  emit("send", value);
}

// 回车提交 / Shift+Enter 与 Ctrl+J 换行 / 运行中 Tab 排队全在 utils/hotkeys + composables/useHotkeys 判定（裁定 G5）。
// 卡下键位提示行已按用户裁定删除；同一套键位在快捷键设置页仍有一份（hotkey-guide 数据表）。
</script>

<template>
  <footer class="composer-wrap">
    <div class="composer" :class="{ 'is-disabled': running }">
      <!-- #113c 对齐 deepwrite 的挂载点：绑定条是 .composer 的第一个孩子，住在输入面之上、卡片圆角之内，
           且只在空线程时显形（他的 v-if="messagesEmpty"）。它自己读 store，这里只交出可见性与忙态。 -->
      <ComposerContextBar v-if="contextBarVisible" :running="running" />
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
              ? '随心输入，输入 / 唤出命令，输入 @ 引用素材……'
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
        <!-- 语音提示行（2026-10-06）：与计数条同一手法——常态不占位（voice.hint.text 为空串时不渲染），
             出错或降级时才显形。文案由 voice-input.ts 判好（浏览器 error 码已翻成人话）；
             Chromium 不给 disabled 元素弹 title，所以「为什么按不了」必须是看得见的文字。 -->
        <div
          v-if="voice.hint.text"
          class="composer-voice-hint"
          :class="{ 'composer-voice-hint--warn': voice.hint.warn }"
        >
          {{ voice.hint.text }}
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
              :ref="(el) => setChipRef(chip.id, el)"
              class="composer-chip"
              :class="{ 'composer-chip--model': chip.id === 'model' }"
              type="button"
              :data-chip="chip.id"
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
            <!-- 两端 chip 都挂同一个 ref 收集器：模型 chip 现在住在左端，但它哪天挪到右端时锚点不该跟着断。
                 setChipRef 按 id 取，右端那枚是权限档，收集器会自己跳过。 -->
            <button
              v-for="chip in chipsRight"
              :key="chip.id"
              :ref="(el) => setChipRef(chip.id, el)"
              class="composer-chip"
              type="button"
              :data-chip="chip.id"
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
            <!-- 麦克风＝语音输入（2026-10-06 从 disabled 占位接成真通路）。
                 位置、形状、aria 语义都照参考图那一枚；判定不在这里：disabled / aria-pressed /
                 录音态全部读 voice.button（真身在 composables/voice-input.ts 的 voiceButtonView），
                 再点一次就 voice.toggle()。本机内核不支持时它是禁用的，理由在卡下那行可见提示里。 -->
            <button
              class="round-tool-button"
              :class="{ 'is-recording': voice.button.recording }"
              type="button"
              :disabled="voice.button.disabled"
              :aria-label="voice.button.label"
              :aria-pressed="voice.button.pressed"
              :title="voice.button.title"
              @click="voice.toggle()"
            >
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
  </footer>
</template>
