<!-- 二级选项列表（2026-11-09 用户裁定）。
     多稿 / 工具 / `/ 命令` / 工作模式四组共用这一个组件、同一张版式、同一套键位：
     点首层任一行都展开同款卡片，不再有「有的点一下就切档、有的弹全屏遮罩」的混杂形态。
     2026-11-10「自动技能不要在里面」：自动技能也用这一张版式，但入口是输入卡首行的
     独立 chip，不经过「更多」首层（standalone=true 时返回键改成收起）。
     条目全部来自 utils/composer-more.ts 那张决策表，本文件只渲染、只把选中的那条交回去；
     命令名、说明、档位、工具清单没有第二份副本。 -->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import type { DraftSampleCount, WorkMode } from "@mochen/contracts";
import AppIcon from "./AppIcon.vue";
import {
  autoSkillSheetView,
  groupHeadingAt,
  moreSheetView,
  type ComposerSheetGroup,
  type MoreOption
} from "../utils/composer-more";
import { imeOwnsKey, type SlashCommand } from "../utils/slash-commands";
import { useAutoSkillStore } from "../stores/useAutoSkillStore";
import { useAgentStore, threadKeyFor } from "../stores/useAgentStore";
import { useBookStore } from "../stores/useBookStore";

const props = defineProps<{
  group: ComposerSheetGroup;
  /** 从独立 chip 打开（没有上一层的「更多」首层可回）：返回键画成收起，父级直接关弹层。 */
  standalone: boolean;
  hasBook: boolean;
  sampleCount: DraftSampleCount;
  workMode: WorkMode;
  webSearchEnabled: boolean;
  disabledTools: readonly string[];
  commands: readonly SlashCommand[];
  running: boolean;
}>();

const emit = defineEmits<{ pick: [option: MoreOption]; back: [] }>();

const root = ref<HTMLElement | null>(null);
const autoSkill = useAutoSkillStore();
const book = useBookStore();
const agent = useAgentStore();

/**
 * 技能那张卡的现场直接读 store，不再从 ComposerBox / CenterColumn 层层传 prop：
 * 判据（rankSkills）已经产出了带理由的榜单，这里只把「是不是真挂上了」补上。
 * 技能名取技能库里那一份显示名，保证与卡片上看到的同一句话。
 *
 * 2026-11-10 用户裁定：这张卡要能**自己选用哪个技能**，所以带的是整库而不是
 * 只带「自动识别到的那几枚」。自动挑中的那几枚在列表里只是带「自动」角标。
 * 顺序也是刻意排的：已挂的在前（用户最关心这一轮到底带了什么），其余在后。
 */
const autoSkills = computed(() => {
  const threadKey = threadKeyFor(book.activeDocTab);
  const pinned = new Set(agent.skillPathsOf(threadKey));
  const autoPinned = new Set(autoSkill.pinnedOf(threadKey));
  // 自动挑它的理由（「阶段『正文』匹配」那种）比 frontmatter 的用途更贴这一轮，
  // 两者都有时把理由摆前面——用户点开这张卡想知道的是「为什么是它」。
  const reasons = new Map(autoSkill.picksOf(threadKey).map((pick) => [pick.id, pick.reasons]));
  const rows = agent.skills.map((skill) => {
    const why = (reasons.get(skill.id) ?? []).join("；");
    return {
      id: skill.id,
      name: skill.displayName || skill.dirName,
      detail: why !== "" ? why : skill.description,
      pinned: pinned.has(skill.id),
      auto: autoPinned.has(skill.id)
    };
  });
  // 分组顺序：自动挑的 → 你亲手挂的 → 库里其余。
  // 自动与手动混着排会读成一串「自动/手动/自动」，看不出哪几枚是关总开关就会消失的。
  const pinnedRows = rows.filter((one) => one.pinned);
  return {
    enabled: autoSkill.enabled,
    paused: autoSkill.autoPausedByThread[threadKey] === true,
    library: [
      ...pinnedRows.filter((one) => one.auto),
      ...pinnedRows.filter((one) => !one.auto),
      ...rows.filter((one) => !one.pinned)
    ],
    blockedCount: autoSkill.autoBlockedByThread[threadKey]?.length ?? 0
  };
});

const sheetState = computed(() => ({
  hasBook: props.hasBook,
  sampleCount: props.sampleCount,
  workMode: props.workMode,
  webSearchEnabled: props.webSearchEnabled,
  disabledTools: props.disabledTools,
  commands: props.commands,
  autoSkills: autoSkills.value
}));

/** 自动技能不属于「更多」四组，视图走自己那一处导出；版式仍是这一个组件。 */
const view = computed(() =>
  props.group === "auto-skills"
    ? autoSkillSheetView(sheetState.value)
    : moreSheetView(props.group, sheetState.value)
);

/** 只吃这一层自己的三枚键，其余一律放行（Tab 要能走出弹层，输入法组合态更不能拦）。 */
function onKeydown(event: KeyboardEvent): void {
  if (imeOwnsKey(event)) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    emit("back");
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  event.stopPropagation();
  const buttons = Array.from(
    root.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []
  );
  if (buttons.length === 0) return;
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const step = event.key === "ArrowDown" ? 1 : -1;
  buttons[at === -1 ? 0 : (at + step + buttons.length) % buttons.length]?.focus();
}

onMounted(() => {
  void nextTick(() => {
    root.value?.querySelector<HTMLButtonElement>(".composer-sheet-option:not(:disabled)")?.focus();
  });
});
</script>

<template>
  <div
    ref="root"
    class="composer-sheet"
    role="listbox"
    :aria-label="view.title"
    tabindex="-1"
    @keydown="onKeydown"
  >
    <div class="composer-sheet-heading">
      <button
        class="composer-sheet-back"
        type="button"
        :aria-label="standalone ? '收起' : '返回'"
        @click="emit('back')"
      >
        <AppIcon :name="standalone ? 'close' : 'arrow-left'" :size="15" />
      </button>
      <span class="composer-sheet-icon"><AppIcon :name="view.icon" :size="17" /></span>
      <div class="composer-sheet-heading-copy">
        <strong>{{ view.title }}</strong>
        <span>{{ view.hint }}</span>
      </div>
      <kbd>Esc</kbd>
    </div>

    <div class="composer-sheet-options">
      <template v-for="(option, index) in view.options" :key="option.id">
        <div v-if="groupHeadingAt(view.options, index)" class="composer-sheet-group">
          {{ groupHeadingAt(view.options, index) }}
        </div>
        <button
          class="composer-sheet-option"
          type="button"
          role="option"
          :aria-selected="option.selected"
          :class="{
            'is-selected': option.selected,
            'is-off': !option.selected && group === 'tools'
          }"
          :disabled="option.disabled || running"
          :title="option.detail"
          @click="emit('pick', option)"
        >
          <span class="composer-sheet-option-icon">
            <AppIcon :name="option.icon" :size="15" />
          </span>
          <span class="composer-sheet-copy">
            <strong>{{ option.label }}</strong>
            <small>{{ option.detail }}</small>
          </span>
          <span v-if="option.badge" class="composer-sheet-badge">{{ option.badge }}</span>
          <AppIcon v-if="option.selected" class="composer-sheet-check" name="check" :size="13" />
        </button>
      </template>
      <div v-if="view.options.length === 0" class="composer-sheet-empty">{{ view.empty }}</div>
    </div>

    <div class="composer-sheet-footer list-keys">
      <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
      <span><kbd>Enter</kbd> 生效</span>
      <span class="composer-sheet-footnote">{{ view.foot }}</span>
    </div>
  </div>
</template>
