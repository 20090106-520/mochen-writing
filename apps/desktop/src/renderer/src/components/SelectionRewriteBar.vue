<!-- 选中即改写（2026-10-11）：正文 textarea 里划选一段，这一条浮在编辑区右上角——
     「扩写 / 收着写 / 更口语」三枚按钮，点了把选段与要求预填进智能体输入区，
     展开右栏面板，**不自动发送**（与 ai-check 审核同一条纪律：发送权在用户）。
     判定与提示词真身在 utils/selection-rewrite；这里只管监听选区、摆按钮、递话。 -->
<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { useBookStore } from "../stores/useBookStore";
import { threadKeyFor, useAgentStore } from "../stores/useAgentStore";
import { useLayoutStore } from "../stores/layoutStore";
import {
  SELECTION_REWRITE_ACTIONS,
  SELECTION_REWRITE_MAX_CHARS,
  selectionRewritePrompt,
  selectionWorthy
} from "../utils/selection-rewrite";

const props = defineProps<{ editor: HTMLTextAreaElement | null }>();

const book = useBookStore();
const agent = useAgentStore();
const layout = useLayoutStore();

/**
 * 当前选区的展示态；null = 条子收着（没有选区 / 选区全是空白 / 太短不值得动用智能体）。
 * worthy 在 refresh 里一次算清——模板只摆真身算好的结果，不自己再判一遍。
 */
const selection = ref<{ chars: number; worthy: boolean } | null>(null);

function refresh(): void {
  const el = props.editor;
  if (el === null) {
    selection.value = null;
    return;
  }
  const text = el.value.slice(el.selectionStart, el.selectionEnd).trim();
  if (text.length < 2) {
    // 两字以下多半是拖动途中的路过选区，条子闪没闪出都难看，直接不出。
    selection.value = null;
    return;
  }
  selection.value = { chars: text.length, worthy: selectionWorthy(text) };
}

/** 监听收拢在 watch 里做：editor 是模板 ref，挂载后才有值；换篇不清实例。 */
function bind(el: HTMLTextAreaElement | null, old: HTMLTextAreaElement | null | undefined): void {
  for (const event of ["select", "mouseup", "keyup", "input"] as const) {
    old?.removeEventListener(event, refresh);
    el?.addEventListener(event, refresh);
  }
}

watch(
  () => props.editor,
  (el, old) => {
    bind(el, old);
    refresh();
  },
  { immediate: true }
);
onBeforeUnmount(() => bind(null, props.editor));

/**
 * 点按钮：重读一遍真实选区（state 可能是旧快照），预填进当前章的对话线程，
 * 展开右栏，然后把选区收起——条子随选区消失，光标落回正文。
 */
function run(kind: (typeof SELECTION_REWRITE_ACTIONS)[number]["kind"]): void {
  const el = props.editor;
  if (el === null || book.activeDocTab === null) return;
  const text = el.value.slice(el.selectionStart, el.selectionEnd);
  if (!selectionWorthy(text)) return;
  agent.prefillComposer(threadKeyFor(book.activeDocTab), selectionRewritePrompt(kind, text));
  layout.setPaneCollapsed("right", false);
  el.focus();
  el.setSelectionRange(el.selectionEnd, el.selectionEnd);
  refresh();
}
</script>

<template>
  <div v-if="selection !== null" class="selection-rewrite-bar" role="toolbar" aria-label="选段改写">
    <template v-if="selection.worthy">
      <span class="selection-rewrite-count">已选 {{ selection.chars }} 字</span>
      <button
        v-for="action in SELECTION_REWRITE_ACTIONS"
        :key="action.kind"
        class="selection-rewrite-button"
        type="button"
        :title="action.hint"
        @click="run(action.kind)"
      >
        {{ action.label }}
      </button>
    </template>
    <span v-else class="selection-rewrite-hint">
      选了 {{ selection.chars }} 字——太长了，分两次来，每次别超过
      {{ SELECTION_REWRITE_MAX_CHARS }} 字。
    </span>
  </div>
</template>
