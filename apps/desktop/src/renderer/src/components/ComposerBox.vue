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
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import type {
  DraftSampleCount,
  PermissionMode,
  ThinkingLevel,
  ThinkingWire,
  WorkMode
} from "@mochen/contracts";
import AppIcon from "./AppIcon.vue";
import brandMark from "../assets/brand/mochen-lockup.jpg";
import { welcomeGreeting } from "../utils/welcome-home";
import { useBookStore } from "../stores/useBookStore";
import { useLayoutStore } from "../stores/layoutStore";
import { useReferenceMenuStore } from "../stores/useReferenceMenuStore";
import { useAutoSkillStore } from "../stores/useAutoSkillStore";
import { useAgentStore, threadKeyFor } from "../stores/useAgentStore";
import ComposerContextBar from "./ComposerContextBar.vue";
import ComposerProjectBar from "./ComposerProjectBar.vue";
import ComposerMoreSheet from "./ComposerMoreSheet.vue";
import ComposerReferenceMenu from "./ComposerReferenceMenu.vue";
import PermissionMenu from "./PermissionMenu.vue";
import { useVoiceInput } from "../composables/useVoiceInput";
import {
  composerChips,
  composerCounter,
  CHIP_EMIT,
  type ComposerChipId
} from "../utils/composer-chips";
import {
  MORE_GROUP_IDS,
  draftSampleSteps,
  type ComposerSheetGroup,
  type MoreGroupId,
  type MoreOption
} from "../utils/composer-more";
import type { SlashCommand } from "../utils/slash-commands";

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
  /** 启用中那条连接把「深度」在线上叫什么（Agnes 那类端点叫 xhigh）；只影响 chip 的提示。 */
  thinkingWire: ThinkingWire;
  webSearchEnabled: boolean;
  /** 多稿档（P0-②）：1 = 关。chip 的文案与 title 判定全在 composerChips 那一处，这里只收值。 */
  sampleCount: DraftSampleCount;
  /** 二级工具目录里被摘下的那几枚（真身在 agent.disabledTools）。 */
  disabledTools: readonly string[];
  modelLabel: string;
  // prop 名必须是 `baseUrl` 而不是 `baseURL`：模板里的 kebab 绑定 `:base-url` 被 Vue camelize 成 `baseUrl`，
  // 声明成 `baseURL` 时它根本收不到值（真机实测：chip 的 title 拼出 `undefined/models`）。
  // 往里交给 composerChips 的参数仍叫 `baseURL`，那是对齐 contracts 的 ProviderView 字段名。
  baseUrl: string;
  /** 2026-11-09 参考图首页：欢迎态下这一格带 logo + 问候语 + 卡下快捷入口。 */
  welcome?: boolean;
}>();

// 欢迎首页那一组（只在 welcome 为真时渲染）。**五枚都是真入口**：书务走 book / layout 的同一真身，
// 换页走 layout.showCenter —— 参考图那行 chips 不照抄成点了没反应的装饰按钮。
const book = useBookStore();
const layout = useLayoutStore();
const agent = useAgentStore();
const autoSkill = useAutoSkillStore();
const greeting = computed(() => welcomeGreeting(new Date().getHours()));

/**
 * 自动挂入必须看得见：这一行把「这一轮替你挂了哪几枚」摆在输入卡上，
 * 名字取技能库同一份显示名，点「管理」直接进那张同款二级卡片。
 * 只显示自动挂的那几枚——用户亲手挂的、书级默认的不冒充自动的功劳。
 */
const autoPinned = computed(() => {
  const threadKey = threadKeyFor(book.activeDocTab);
  return autoSkill.pinnedOf(threadKey).map((id) => ({
    id,
    name: agent.skills.find((skill) => skill.id === id)?.displayName ?? id
  }));
});
// 不附加 hasBook：没打开作品时自动识别照样会挂技能，挂了却不显示就成了黑箱。
// 只要这一轮真有自动挂入的，就把名字摆出来。
const autoHintVisible = computed(() => autoSkill.enabled && autoPinned.value.length > 0);
/** 首页那张窄卡的占位文案照参考图的「输入 @ 引用…」；非首页仍走原来那两档真身。 */
const placeholder = computed(() => {
  if (props.welcome) return "输入 @ 引用素材、文稿和设定，或者直接说想写什么";
  return props.ready
    ? "输入正文，/ 唤出命令，@ 引用素材……"
    : "先在左栏打开作品；模型在左下角齿轮（设置）里配。";
});
const welcomeShortcuts = [
  { id: "open", label: "打开作品目录", icon: "directory", run: () => void book.pickAndOpen() },
  { id: "new", label: "新建作品", icon: "plus", run: () => layout.openNewBook() },
  { id: "model", label: "模型设置", icon: "model", run: () => layout.showSettings("model") },
  // 2026-11-10 用户裁定：这一枚**就地开技能卡**，不再跳到中栏技能库页。
  // 他要的是「这一轮用哪几枚」——那是输入卡上的事；装新的/改正文才属于技能库页（卡片里有出口）。
  { id: "skills", label: "技能库", icon: "wand", run: () => openAutoSkills() },
  { id: "skins", label: "皮肤广场", icon: "image", run: () => layout.showCenter("skins") }
] as const;

const emit = defineEmits<{
  "update:modelValue": [value: string];
  send: [text: string];
  stop: [];
  "open-permission-menu": [];
  "close-permission-menu": [];
  "toggle-work-mode": [];
  "cycle-thinking": [];
  "toggle-web-search": [];
  "cycle-draft-sample": [];
  "open-tool-roster": [];
  "toggle-tool": [name: string];
  "open-model-select": [anchor: HTMLElement];
  "open-palette": [];
  "run-command": [command: SlashCommand];
  "open-mention": [];
  // 自动技能常驻首行，点击就地展开自己的卡片；声明只为 CHIP_EMIT 穷尽表有真身。
  "open-auto-skills": [];
}>();

// 命令目录读的仍是行内菜单那道可用性闸过滤出来的名单，不另造第二份命令表。
const referenceMenu = useReferenceMenuStore();

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

// F-D chip 行：八枚真开关/入口，判定全部下沉 composerChips（权限侧内部只调 permissionChipView 一次）。
const chips = computed(() =>
  composerChips({
    hasBook: props.hasBook,
    mode: props.permissionMode,
    workMode: props.workMode,
    saving: props.permissionSaving,
    thinkingLevel: props.thinkingLevel,
    thinkingWire: props.thinkingWire,
    webSearchEnabled: props.webSearchEnabled,
    sampleCount: props.sampleCount,
    modelLabel: props.modelLabel,
    baseURL: props.baseUrl
  })
);
// #105 左右分栏：栏位是 composerChips 表里的 slot 字段，这里只过滤——模板不养第二份顺序表（铁律 6）。
const chipsLeft = computed(() => chips.value.filter((c) => c.slot === "left"));
const chipsRight = computed(() => chips.value.filter((c) => c.slot === "right"));
// 2026-11-08 首行常驻 + 更多弹层：低频开关住在 slot === "more"，由这一组收进弹层渲染。
// 功能一个不丢；弹层里的每一行仍走同一张 CHIP_EMIT 表与同一份 click 处理器（见 onMoreChipClick）。
const chipsMore = computed(() => chips.value.filter((c) => c.slot === "more"));
// 藏在弹层里的开关只要有一枚在生效，入口自己亮一档——否则卡面上没有任何地方说「它们开着」。
const moreHasActive = computed(() => chipsMore.value.some((c) => c.active && !c.disabled));

/**
 * 「更多」弹层（2026-11-08）。
 *
 * 为什么不是又一枚平铺 chip：1440 窗口右栏展开时工具行容器只有 664px，
 * 八枚平铺放不下（2026-10-22 的旧裁定是折两行，代价是右组整组掉到第二行）。
 * 收成「首行常驻 + 一层弹层」后，664 与 840 都一行放得下，且低频开关仍可到达。
 *
 * 键盘：打开即把焦点落到第一枚可用项；Tab 继续在弹层里走；↑/↓ 在项间移动；
 * Esc 收起并把焦点还回触发钮（不把焦点丢到 body）。点弹层外面也收起（pointerdown 捕获）。
 */
const moreOpen = ref(false);
const moreWrap = ref<HTMLElement | null>(null);
const moreTrigger = ref<HTMLElement | null>(null);
const morePanel = ref<HTMLElement | null>(null);
/** 2026-11-09：「更多」四组展开同款二级列表；null = 首层。
 *  "auto-skills" 不在这四组里：2026-11-10 用户裁定「不要在里面」，它由首行独立 chip 打开，
 *  只是复用同一个弹层容器与同一张卡片版式。 */
const moreGroup = ref<ComposerSheetGroup | null>(null);
/** 这次展开是不是从独立入口进来的：决定返回键是「回更多首层」还是「直接收起」。 */
const moreStandalone = ref(false);

/** 弹层里可用的行（直接子元素就是那些按钮，不用 querySelector 搜 DOM——模型锚点那条纪律同样适用于焦点收口）。 */
function moreItems(): HTMLButtonElement[] {
  const panel = morePanel.value;
  if (panel === null) return [];
  return Array.from(panel.children).filter(
    (child): child is HTMLButtonElement => child instanceof HTMLButtonElement && !child.disabled
  );
}

function openMore(): void {
  moreStandalone.value = false;
  moreOpen.value = true;
  void nextTick(() => {
    (moreItems()[0] ?? moreTrigger.value)?.focus();
  });
}

function closeMore(returnFocus: boolean): void {
  if (!moreOpen.value) return;
  moreOpen.value = false;
  moreGroup.value = null;
  moreStandalone.value = false;
  if (returnFocus) moreTrigger.value?.focus();
}

function toggleMore(): void {
  if (moreOpen.value) closeMore(true);
  else openMore();
}

function onMoreKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeMore(true);
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  const items = moreItems();
  if (items.length === 0) return;
  const at = items.indexOf(document.activeElement as HTMLButtonElement);
  const step = event.key === "ArrowDown" ? 1 : -1;
  const next = at === -1 ? 0 : (at + step + items.length) % items.length;
  items[next]?.focus();
}

/**
 * 2026-11-09 用户裁定：首层四行**一律**是「展开下一层」的入口，
 * 不再有「工具/命令点开浮层、多稿/工作模式按一下就切档」的混杂形态。
 * 二级列表由 ComposerMoreSheet 统一渲染：同款卡片、同款键位、同款选中反馈。
 */
function onMoreChipClick(id: ComposerChipId): void {
  if (!MORE_GROUP_IDS.includes(id as MoreGroupId)) return;
  moreStandalone.value = false;
  moreGroup.value = id as MoreGroupId;
}

function backToMore(): void {
  // 独立 chip 进来的卡片没有上一层可回：返回键画成 X，这里直接收起并把焦点还回去。
  if (moreStandalone.value) {
    closeMore(true);
    return;
  }
  moreGroup.value = null;
  void nextTick(() => {
    (moreItems()[0] ?? moreTrigger.value)?.focus();
  });
}

/** 二级列表选中一项：按 option.action 走既有真身，模板里不写第二份分派。 */
function onSheetPick(option: MoreOption): void {
  switch (option.action) {
    case "draft": {
      const target = Number(option.id) as DraftSampleCount;
      const steps = draftSampleSteps(props.sampleCount, target);
      // 唯一写入口仍是 agent.cycleDraftSample()：把档位按到位，不另造一个 setter。
      // 父组件对每次 emit 同步调一次 store 动作，档序判定在 contracts 那一处。
      for (let i = 0; i < steps; i += 1) emit("cycle-draft-sample");
      closeMore(false);
      return;
    }
    case "work-mode":
      // 只有两档：选中另一档就是走一次既有的 toggleWorkMode()，选中当前档什么都不做。
      if (option.id !== props.workMode) emit("toggle-work-mode");
      closeMore(false);
      return;
    case "tools":
      // 不收起：摘完一枚还能接着摘下一枚，列表即时反映最新开关态。
      emit("toggle-tool", option.id);
      return;
    case "roster":
      emit("open-tool-roster");
      closeMore(false);
      return;
    case "command":
      emit("run-command", option.id as SlashCommand);
      closeMore(false);
      return;
    case "summon":
      // 仍是 / 键、chip、工作台 pill 共用的那一个行内菜单真身。
      emit("open-palette");
      closeMore(false);
      return;
    case "skills-page":
      // 卡片里那个出口：装新的、改正文、看全部技能库的正文——那些只有技能库页能做。
      layout.showCenter("skills");
      closeMore(false);
      return;
    case "auto-toggle":
      autoSkill.setEnabled(!autoSkill.enabled);
      return;
    case "auto-clear":
      autoSkill.clearAll(threadKeyFor(book.activeDocTab));
      return;
    case "auto-reset":
      autoSkill.resetBlocked(threadKeyFor(book.activeDocTab));
      return;
    case "skill-toggle":
      // 挂上/取下都走这一处真身：它会顺手记下「这是你亲手做的」（否决名单/解除否决），
      // 所以卡片上的手动操作与技能库页的勾选是同一条写入口，不会两边说法不一。
      agent.toggleSkillForThread(threadKeyFor(book.activeDocTab), option.id);
      return;
  }
}

/** 提示行上的「管理」与首行那枚独立 chip：都直接展开自动技能卡片，不经「更多」首层。
 *  焦点由 ComposerMoreSheet 的 onMounted 落到卡片第一枚可选项，所以这里不调 openMore()
 *  （那会把焦点先送到四行首层，而首层此刻并不渲染）。 */
function openAutoSkills(): void {
  // 这张卡现在列的是**整库**，所以必须先有那张表：以前只列「识别到的几枚」，
  // 表没列过时卡片看着也像「这一轮没挑到」，看不出缺口；现在会直接空一片。
  // 失败不拦（refreshSkills 自己会写 notice），卡片照开，至少总开关还能用。
  if (!agent.skillsListed) void agent.refreshSkills();
  moreStandalone.value = true;
  moreGroup.value = "auto-skills";
  moreOpen.value = true;
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (event.target instanceof Node && moreWrap.value?.contains(event.target)) return;
  closeMore(false);
}

/**
 * 指针高光（2026-11-10）。
 *
 * 液态玻璃要读成玻璃，靠的是「光会动」：指针在卡上走到哪，那枚高光跟到哪
 * （样式表里 `--lg-pointer` 的圆心就是这两个变量，见 liquid-glass.css）。
 *
 * 三件事值得写明：
 * ① **只写两个 CSS 变量**，不碰 DOM 结构、不读尺寸以外的任何东西——每次 pointermove
 *    只付一次样式重算，没有重排。
 * ② 不套 rAF：Chromium 的 pointermove **本身就按帧合并**（一帧最多一件），
 *    再包一层只是把「这一帧的光」推迟到下一帧，看起来反而粘手。
 * ③ 材质关掉时直接返回——`data-liquid-glass="off"` 时那条规则根本不命中，
 *    写了也没人读，白白让每个移动事件都进一次 `setProperty`。
 */
function onSurfacePointerMove(event: PointerEvent): void {
  if (document.documentElement.dataset.liquidGlass !== "on") return;
  const surface = event.currentTarget;
  if (!(surface instanceof HTMLElement)) return;
  const rect = surface.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  const y = ((event.clientY - rect.top) / rect.height) * 100;
  surface.style.setProperty("--lg-pointer-x", `${x}%`);
  surface.style.setProperty("--lg-pointer-y", `${y}%`);
}

/** 指针离开：光斑回静置位（顶部正中）。删掉两个内联值就退回根上那对默认值。 */
function onSurfacePointerLeave(event: PointerEvent): void {
  const surface = event.currentTarget;
  if (!(surface instanceof HTMLElement)) return;
  surface.style.removeProperty("--lg-pointer-x");
  surface.style.removeProperty("--lg-pointer-y");
}

watch(moreOpen, (open) => {
  if (open) document.addEventListener("pointerdown", onDocumentPointerDown, true);
  else document.removeEventListener("pointerdown", onDocumentPointerDown, true);
});

// 开始生成时收起：弹层里的开关此刻都是禁用的，留着一层死菜单只会挡路。
watch(
  () => props.running,
  (running) => {
    if (running) closeMore(false);
  }
);

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocumentPointerDown, true);
});
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
// 模型 chip 是唯一的例外分支：它是八枚里唯一一枚要把**自己**交出去的（下拉浮层要拿它当锚点），
// 所以载荷在那一条上补；其余七枚仍原样走表，窄化后 `CHIP_EMIT[id]` 的类型也不再含它。
function onChipClick(id: ComposerChipId): void {
  if (id === "auto-skills") {
    // 首行独立入口：不经过「更多」首层，也不发出没人接的事件变成死键。
    openAutoSkills();
    return;
  }
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
    <!-- 2026-11-09 参考图首页：小 logo + 一句问候，紧贴下面的输入卡。
         放在 composer-wrap 里而不是中栏滚动区，是为了让「标题 + 卡 + 快捷行」成一整组，
         由 welcome-home.css 在栅格第 2 行里垂直居中；拆成两个兄弟就贴不拢。 -->
    <div v-if="welcome" class="welcome-hero">
      <img class="welcome-hero-mark" :src="brandMark" alt="" width="44" height="44" />
      <h1 class="welcome-hero-title">{{ greeting }}</h1>
    </div>
    <div class="composer" :class="{ 'is-disabled': running }">
      <!-- #113c 对齐 deepwrite 的挂载点：绑定条是 .composer 的第一个孩子，住在输入面之上、卡片圆角之内，
           且只在空线程时显形（他的 v-if="messagesEmpty"）。它自己读 store，这里只交出可见性与忙态。 -->
      <ComposerContextBar v-if="contextBarVisible" :running="running" />
      <!-- 自动技能是这一轮真会发出去的东西，所以挂了哪几枚必须上屏、可一键管理（不是黑箱）。 -->
      <div v-if="autoHintVisible" class="composer-auto-skills" role="status">
        <AppIcon name="sparkles" :size="13" />
        <span>已自动挂入</span>
        <span
          v-for="one in autoPinned"
          :key="one.id"
          class="composer-auto-skill-name"
          :title="one.id"
          >{{ one.name }}</span
        >
        <button class="composer-auto-manage" type="button" @click="openAutoSkills()">管理</button>
      </div>
      <div
        class="composer-input-surface"
        @pointermove="onSurfacePointerMove"
        @pointerleave="onSurfacePointerLeave"
      >
        <!-- #106：行内引用菜单锚在这层 surface（它本就 position:relative），整卡宽、向上开——
             与 deepwrite 的 .composer-stack + .composer-reference-menu 同一形态（裁定 D4）。
             刻意不放进 .composer-toolbar-right：那是权限弹层的定位祖先，抢了它弹层就会跟着菜单跑。 -->
        <ComposerReferenceMenu />
        <!-- 输入行（2026-10-17 设计稿；2026-10-24 撤掉前缀）：这一行原本以装饰性 `/` 起头
             （设计稿的 .prefix-char）。真机上它读起来像「我自己打了一个斜杠」——用户点名去掉。
             它是纯装饰（原来就 aria-hidden），撤掉不影响 placeholder 与任何数据通路；
             `.composer-input-zone` 留着，它管的是这一行的内边距与最小高度。 -->
        <div class="composer-input-zone">
          <textarea
            v-model="draft"
            data-mochen-composer
            class="composer-textarea"
            rows="1"
            :placeholder="placeholder"
          />
        </div>
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
        <!-- Esc 在工具行任意位置都能收起「更多」弹层（焦点跑到别枚钮上时也不失效）。 -->
        <div class="composer-toolbar" @keydown.esc="closeMore(true)">
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
              <AppIcon name="plus" :size="16" />
            </button>
            <button
              v-for="chip in chipsLeft"
              :key="chip.id"
              :ref="(el) => setChipRef(chip.id, el)"
              class="composer-chip"
              type="button"
              :data-chip="chip.id"
              :disabled="chip.disabled || running"
              :title="chip.title"
              :aria-label="chip.text"
              :aria-pressed="chip.active"
              @click="onChipClick(chip.id)"
            >
              <AppIcon class="composer-chip-icon" :name="chip.icon" :size="14" />
              <span class="composer-chip-label">{{ chip.text }}</span>
              <AppIcon v-if="chip.caret" class="composer-chip-caret" name="chevron" :size="11" />
            </button>
            <!-- 2026-11-08 首行常驻 + 更多弹层（参照 MiniMax Code 输入卡的分区逻辑）：
                 首行左端留「引用素材 / 思考 / 联网」，右端留「模型 / 权限档 / 麦克风 / 发送」
                 （2026-11-09 参考图②：模型名落在发送键左侧）；多稿、工具清单、命令面板、
                 工作模式收进这一枚「更多」。664 容器因此不再折行。
                 弹层挂在这一枚触发钮上（它自己是定位祖先），向上开——输入卡贴着视口底部。 -->
            <div ref="moreWrap" class="composer-more" :class="{ 'is-open': moreOpen }">
              <button
                ref="moreTrigger"
                class="round-tool-button composer-more-trigger"
                :class="{ 'is-active': moreHasActive }"
                type="button"
                aria-label="更多输入选项"
                title="多稿、工具清单、命令面板与工作模式"
                aria-haspopup="true"
                :aria-expanded="moreOpen"
                :disabled="running"
                @click="toggleMore()"
              >
                <AppIcon name="ellipsis" :size="16" />
              </button>
              <div
                v-if="moreOpen"
                ref="morePanel"
                class="composer-more-menu"
                :class="{ 'is-sheet': moreGroup !== null }"
                role="group"
                aria-label="更多输入选项"
                @keydown="onMoreKeydown"
              >
                <!-- 首层：四行全是入口，点任一行都展开下一层（2026-11-09 用户裁定）。 -->
                <template v-if="moreGroup === null">
                  <button
                    v-for="chip in chipsMore"
                    :key="chip.id"
                    class="composer-more-item"
                    type="button"
                    :data-chip="chip.id"
                    :class="{ 'is-unavailable': chip.disabled }"
                    :disabled="running"
                    :title="chip.title"
                    :aria-label="chip.text"
                    :aria-disabled="chip.disabled"
                    :aria-haspopup="true"
                    :aria-expanded="false"
                    :aria-pressed="chip.active"
                    @click="onMoreChipClick(chip.id)"
                  >
                    <AppIcon class="composer-chip-icon" :name="chip.icon" :size="14" />
                    <span class="composer-more-label">{{ chip.text }}</span>
                    <AppIcon
                      v-if="chip.caret"
                      class="composer-chip-caret"
                      name="chevron"
                      :size="11"
                    />
                  </button>
                </template>
                <ComposerMoreSheet
                  v-else
                  :group="moreGroup"
                  :standalone="moreStandalone"
                  :has-book="hasBook"
                  :sample-count="sampleCount"
                  :work-mode="workMode"
                  :web-search-enabled="webSearchEnabled"
                  :disabled-tools="disabledTools"
                  :commands="referenceMenu.commandCatalog"
                  :running="running"
                  @pick="onSheetPick"
                  @back="backToMore"
                />
              </div>
            </div>
          </div>
          <div class="composer-toolbar-right" role="group" aria-label="权限、语音与发送">
            <!-- 两端 chip 都挂同一个 ref 收集器：模型 chip 住在右端（2026-11-09 参考图②），
                 锚点仍按 id 收集；权限档那一枚跳过。 -->
            <button
              v-for="chip in chipsRight"
              :key="chip.id"
              :ref="(el) => setChipRef(chip.id, el)"
              class="composer-chip"
              :class="{ 'composer-chip--model': chip.id === 'model' }"
              type="button"
              :data-chip="chip.id"
              :disabled="chip.disabled || running"
              :title="chip.title"
              :aria-label="chip.text"
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
              <AppIcon name="mic" :size="16" />
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
              <AppIcon name="stop" :size="13" />
            </button>
            <button
              v-else
              class="send-button"
              type="button"
              aria-label="发送消息"
              :disabled="modelValue.trim() === '' || counter.over"
              @click="submit()"
            >
              <AppIcon name="arrow-up" :size="16" />
            </button>
          </div>
        </div>
        <!-- 2026-11-09 参考图③＋用户裁定「要的是这样」：选择作品行收进卡内作**贴合底条**——
             与输入面共用同一圈描边与圆角、一条发丝线分隔，读起来是一整块卡，
             不再是「一张卡＋下面散着一行」。不开书时也在，所以没有 v-if。 -->
        <ComposerProjectBar :running="running" />
      </div>
    </div>
    <!-- 参考图里输入卡下方那一行胶囊快捷入口（五枚都接真身，见 script 的 welcomeShortcuts）。 -->
    <nav v-if="welcome" class="welcome-shortcuts" aria-label="快捷入口">
      <button
        v-for="item in welcomeShortcuts"
        :key="item.id"
        class="welcome-shortcut"
        type="button"
        @click="item.run()"
      >
        <AppIcon :name="item.icon" :size="14" />
        <span>{{ item.label }}</span>
      </button>
    </nav>
  </footer>
</template>
