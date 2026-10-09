<!-- 文档内查找替换面板（Ctrl+F）。UI 层只管渲染、派发动作；匹配与高亮真身全在 store。 -->
<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useFindReplaceStore } from "../stores/useFindReplaceStore";
import AppIcon from "./AppIcon.vue";
import { imeOwnsKey } from "../utils/slash-commands";

/**
 * `undo-notice` 由父层（DocumentPane）给：文案的唯一真身在 `utils/edit-undo.ts` 的 `undoNotice`，
 * 面板这里只负责显示与把「撤销」这个动作发回去——面板自己拼一句「已替换 N 处」就是第二份实现。
 */
defineProps<{ undoNotice: string }>();

const emit = defineEmits<{
  replace: [nextText: string, count: number];
  "replace-all": [nextText: string, count: number];
  undo: [];
}>();

const find = useFindReplaceStore();
const { query, replacement, caseSensitive, useRegex, wholeWord, matchCount, currentIndex } =
  storeToRefs(find);

const queryInput = ref<HTMLInputElement | null>(null);
const replaceInput = ref<HTMLInputElement | null>(null);

// 面板打开时自动聚焦查找输入
watch(
  () => find.visible,
  (vis) => {
    if (vis) {
      void microfocus();
    }
  }
);

function microfocus(): void {
  requestAnimationFrame(() => queryInput.value?.focus());
}

function onQueryKeydown(e: KeyboardEvent): void {
  // 组合态里那一下回车/上档是输入法在选词，不是「查找下一个」也不是「收起面板」。
  // 真机 P536O 量到过 defaultPrevented 从 false 翻成 true、拼音留在框里的样子。
  if (imeOwnsKey(e)) return;
  if (e.key === "Enter") {
    e.preventDefault();
    // Shift+Enter 反方向查找；Enter 正方向。
    if (e.shiftKey) find.prevMatch();
    else find.nextMatch();
  } else if (e.key === "Escape") {
    // Esc 留在 escape-policy 链里；不在组件内自己做，避免双轨。
    // 这里只 blur，让冒泡的键走全局通道。
    queryInput.value?.blur();
  }
}

function onReplaceKeydown(e: KeyboardEvent): void {
  if (imeOwnsKey(e)) return;
  if (e.key === "Enter") {
    e.preventDefault();
    doReplace();
  }
}

function doReplace(): void {
  if (matchCount.value === 0) return;
  // 单处替换的处数恒为 1：这是语义，不是"当前匹配数"（匹配 12 处也只换光标那 1 处）。
  emit("replace", find.replaceCurrent(), 1);
}

function doReplaceAll(): void {
  if (matchCount.value === 0) return;
  // 处数必须在替换**之前**取：`replaceAll` 内部会按新文本重算 positions，反序就只剩 0，
  // 于是提示会写成"已替换 0 处"——一件确实发生了 12 次的事被界面报成没发生。
  const count = matchCount.value;
  emit("replace-all", find.replaceAll(), count);
}

/** 撤销那一下不在这儿做判定：文案与栈都在父层，这里只把动作发回去。 */
function doUndo(): void {
  emit("undo");
}

onMounted(() => microfocus());
</script>

<template>
  <div class="find-replace-panel" role="dialog" aria-label="文档内查找替换">
    <div class="find-replace-row">
      <div class="find-input-wrap">
        <AppIcon name="search" :size="13" class="find-replace-icon" />
        <input
          ref="queryInput"
          v-model="query"
          class="find-replace-input"
          type="text"
          spellcheck="false"
          placeholder="查找…"
          aria-label="查找内容"
          @keydown="onQueryKeydown($event)"
        />
        <span class="find-replace-counter">
          <template v-if="matchCount > 0">{{ currentIndex + 1 }}/{{ matchCount }}</template>
          <template v-else-if="query.length > 0">无匹配</template>
        </span>
      </div>

      <div class="find-replace-toggles">
        <button
          type="button"
          class="find-toggle"
          :class="{ 'is-active': caseSensitive }"
          title="区分大小写（Aa）"
          aria-label="区分大小写"
          @click="find.toggleCaseSensitive()"
        >
          Aa
        </button>
        <button
          type="button"
          class="find-toggle"
          :class="{ 'is-active': useRegex }"
          title="正则表达式（.*）"
          aria-label="正则表达式"
          @click="find.toggleUseRegex()"
        >
          .*
        </button>
        <button
          type="button"
          class="find-toggle"
          :class="{ 'is-active': wholeWord }"
          title="全词匹配（\b）"
          aria-label="全词匹配"
          @click="find.toggleWholeWord()"
        >
          W
        </button>
      </div>

      <div class="find-replace-nav">
        <button
          type="button"
          class="find-nav-btn"
          title="上一个匹配"
          aria-label="上一个匹配"
          @click="find.prevMatch()"
        >
          <AppIcon name="arrow-up" :size="12" />
        </button>
        <button
          type="button"
          class="find-nav-btn"
          title="下一个匹配"
          aria-label="下一个匹配"
          @click="find.nextMatch()"
        >
          <AppIcon name="chevron" :size="12" style="transform: rotate(90deg)" />
        </button>
      </div>

      <button
        type="button"
        class="find-close-btn"
        title="关闭（Esc）"
        aria-label="关闭查找替换"
        @click="find.close()"
      >
        <AppIcon name="close" :size="14" />
      </button>
    </div>

    <div class="find-replace-row find-replace-row--replace">
      <div class="find-input-wrap">
        <input
          ref="replaceInput"
          v-model="replacement"
          class="find-replace-input"
          type="text"
          spellcheck="false"
          placeholder="替换为…"
          aria-label="替换内容"
          @keydown="onReplaceKeydown($event)"
        />
      </div>
      <div class="find-replace-actions">
        <button
          type="button"
          class="find-action-btn"
          :disabled="matchCount === 0"
          @click="doReplace()"
        >
          替换
        </button>
        <button
          type="button"
          class="find-action-btn find-action-btn--muted"
          :disabled="matchCount === 0"
          @click="doReplaceAll()"
        >
          全部替换
        </button>
      </div>
    </div>

    <!-- 替换之后的退路（2026-10-09 扫描总单·不存在表）。
         文案来自父层那份 undoNotice，这里只显示；没有可撤销的东西时整行不进 DOM。 -->
    <p v-if="undoNotice" class="find-undo-row">
      <span class="find-undo-notice">{{ undoNotice }}</span>
      <button type="button" class="find-undo-btn" title="退回替换前的文本" @click="doUndo()">
        撤销（Ctrl+Z）
      </button>
    </p>
  </div>
</template>

<style scoped>
.find-replace-panel {
  display: grid;
  gap: 6px;
  padding: 8px 13px;
  border-bottom: 1px solid var(--line-soft, rgba(255, 255, 255, 0.08));
  background: var(--surface-muted, rgba(40, 42, 54, 0.92));
  backdrop-filter: blur(4px);
}

.find-replace-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.find-replace-row--replace {
  padding-left: 0;
}

.find-input-wrap {
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
  gap: 6px;
  padding: 3px 9px;
  border: 1px solid var(--line-soft, rgba(255, 255, 255, 0.1));
  border-radius: 6px;
  background: var(--surface-main, #21222c);
}

.find-input-wrap:focus-within {
  border-color: var(--accent, #7c5c3e);
  outline: 1px solid color-mix(in srgb, var(--accent, #7c5c3e) 55%, transparent);
  outline-offset: -1px;
}

.find-replace-icon {
  color: var(--text-tertiary, #717378);
  flex-shrink: 0;
}

.find-replace-input {
  flex: 1 1 auto;
  min-width: 0;
  background: transparent;
  border: 0;
  outline: 0;
  color: var(--text-primary, #e8e8e8);
  font-family: var(--editor-font, inherit);
  font-size: 0.821429rem;
  padding: 3px 0;
}

.find-replace-input::placeholder {
  color: var(--text-tertiary, #717378);
}

.find-replace-counter {
  flex-shrink: 0;
  min-width: 36px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-size: 0.714286rem;
  color: var(--text-tertiary, #999);
}

.find-replace-toggles {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}

.find-toggle {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 5px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-tertiary, #999);
  font-size: 0.75rem;
  font-weight: 600;
  font-family: var(--editor-font, monospace);
  cursor: pointer;
}

.find-toggle:hover {
  background: var(--surface-hover, rgba(255, 255, 255, 0.05));
  color: var(--text-secondary, #ccc);
}

.find-toggle.is-active {
  background: var(--surface-selected, rgba(124, 92, 62, 0.14));
  color: var(--accent, #7c5c3e);
  border-color: color-mix(in srgb, var(--accent, #7c5c3e) 40%, transparent);
}

.find-replace-nav {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.find-nav-btn {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 5px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-secondary, #ccc);
  cursor: pointer;
}

.find-nav-btn:hover {
  background: var(--surface-hover, rgba(255, 255, 255, 0.05));
  color: var(--text-primary, #e8e8e8);
}

.find-nav-btn:active {
  background: var(--surface-selected, rgba(124, 92, 62, 0.14));
}

.find-close-btn {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 5px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-tertiary, #999);
  cursor: pointer;
  flex-shrink: 0;
}

.find-close-btn:hover {
  background: var(--surface-hover, rgba(255, 255, 255, 0.06));
  color: var(--text-primary, #e8e8e8);
}

.find-replace-actions {
  display: flex;
  gap: 5px;
  flex-shrink: 0;
}

.find-action-btn {
  height: 26px;
  padding: 0 10px;
  border-radius: 5px;
  background: var(--accent, #7c5c3e);
  border: 0;
  color: var(--neutral-solid-contrast, #fff);
  font-size: 0.714286rem;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.find-action-btn:hover:not(:disabled) {
  filter: brightness(1.1);
}

.find-action-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.find-action-btn--muted {
  background: transparent;
  border: 1px solid var(--line-soft, rgba(255, 255, 255, 0.1));
  color: var(--text-secondary, #ccc);
}

.find-action-btn--muted:hover:not(:disabled) {
  background: var(--surface-hover, rgba(255, 255, 255, 0.05));
  filter: none;
}

/* 替换后的退路那一行：文案在左、按钮在右，字号与「替换/全部替换」那两枚同档。
   颜色一律取本文件已经在用的 token，不引入没定义过的变量名（theme-token-guard 会咬）。 */
.find-undo-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0;
}

.find-undo-notice {
  color: var(--text-secondary, #ccc);
  font-size: 0.714286rem;
}

.find-undo-btn {
  height: 22px;
  padding: 0 9px;
  border-radius: 5px;
  background: transparent;
  border: 1px solid var(--line-soft, rgba(255, 255, 255, 0.1));
  color: var(--text-secondary, #ccc);
  font-size: 0.714286rem;
  cursor: pointer;
  white-space: nowrap;
}

.find-undo-btn:hover {
  background: var(--surface-hover, rgba(255, 255, 255, 0.05));
  color: var(--neutral-solid-contrast, #fff);
}
</style>
