<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import AppIcon from "./AppIcon.vue";
import { useComposerContextPopover } from "../composables/useComposerContextPopover";
import { imeOwnsKey, popoverOwnsKey } from "../utils/slash-commands";
import { useBookStore } from "../stores/useBookStore";
import { useSubmissionChecklistStore } from "../stores/useSubmissionChecklistStore";
import {
  CHECKLIST_STATUSES,
  CLEAN_TEXT,
  COVERAGE_TEXT,
  LOADING_TEXT,
  NO_CHAPTER_TEXT,
  STATUS_HINT_TEXT,
  STATUS_LABELS,
  castNoteText,
  foreshadowNoteText,
  groupChecklist,
  timelineNoteText,
  type ChecklistItem
} from "../utils/submission-checklist";
import { revealEditorLine } from "../utils/editor-reveal";

/**
 * 交稿体检浮层（2026-11-09 W-04）。
 *
 * 挂载在 W-03「本章参考」标题行的「体检」按钮上，Teleport 到 body：
 * 参考栏本身仍只占原来那一行，清单浮层不新增网格行，也不挤正文区。
 * 只读汇总，不写盘、不调模型；「待修/已修/忽略」只写进本会话的 store。
 */

const props = defineProps<{
  anchor: HTMLElement;
  chapterRelPath: string;
  chapterTitle: string;
}>();

const emit = defineEmits<{ close: [] }>();

const book = useBookStore();
const checklist = useSubmissionChecklistStore();
const panel = ref<HTMLElement>();
const jumpNotice = ref("");

const { style, close, tab } = useComposerContextPopover(
  () => props.anchor,
  panel,
  () => emit("close"),
  { widthPx: 480 }
);

const groups = computed(() => groupChecklist(checklist.items));

/** 换章/换书：先清空旧清单；等新正文真的载进来了（`docLoading` 落回 false）再重算。 */
watch(
  () => [props.chapterRelPath, book.docLoading] as const,
  ([relPath, loading]) => {
    checklist.clearFor(relPath);
    if (relPath === "" || loading) return;
    void checklist.load(relPath, book.draft);
  },
  { immediate: true }
);

function keydown(event: KeyboardEvent): void {
  const mods = {
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey
  };
  if (popoverOwnsKey(event.key, mods, imeOwnsKey(event))) {
    event.preventDefault();
    close();
    return;
  }
  if (event.key === "Tab") tab(event);
}

/** 跳到条目说的那一处：行级选中整行；文稿级只打开那一篇。跳不动就如实说出来。 */
async function jumpTo(item: ChecklistItem): Promise<void> {
  if (item.locate === "none" || item.relPath === "") return;
  jumpNotice.value = "";
  const switching = item.relPath !== book.activeDocTab;
  // 预览态没有 textarea；先切回编辑，否则没地方落选中的行。
  if (item.locate === "line" && book.editorViewMode === "preview") {
    book.editorViewMode = "edit";
  }
  if (switching) await book.openDocTab(item.relPath);
  if (item.locate === "line") {
    await nextTick();
    if (switching) await nextTick();
    if (!revealEditorLine(item.line)) {
      jumpNotice.value = `已打开这一篇，但没能定位到第 ${item.line} 行（正文可能已经改过）。`;
      return;
    }
  }
  close();
}

async function refresh(): Promise<void> {
  jumpNotice.value = "";
  await checklist.load(props.chapterRelPath, book.draft);
}
</script>

<template>
  <Teleport to="body">
    <section
      ref="panel"
      class="submission-check"
      :style="style"
      role="dialog"
      aria-label="交稿体检"
      tabindex="-1"
      @keydown="keydown"
    >
      <div class="submission-check-head">
        <strong>交稿体检</strong>
        <span v-if="chapterTitle !== ''" class="submission-check-who">《{{ chapterTitle }}》</span>
        <span class="submission-check-count">
          {{ checklist.todoCount }} 待修 · {{ checklist.fixedCount }} 已修 ·
          {{ checklist.ignoredCount }} 忽略
        </span>
        <button
          class="submission-check-refresh"
          type="button"
          title="重新汇总本章的既有检查"
          :disabled="checklist.loading || props.chapterRelPath === ''"
          @click="refresh"
        >
          <AppIcon name="refresh" :size="11" />
        </button>
        <button
          class="submission-check-close"
          type="button"
          aria-label="关闭交稿体检"
          @click="close"
        >
          <AppIcon name="close" :size="12" />
        </button>
      </div>

      <p class="submission-check-note">{{ COVERAGE_TEXT }}</p>

      <p v-if="props.chapterRelPath === ''" class="submission-check-empty">{{ NO_CHAPTER_TEXT }}</p>
      <p v-else-if="checklist.loading" class="submission-check-empty">{{ LOADING_TEXT }}</p>

      <template v-else>
        <p v-if="checklist.notice !== ''" class="submission-check-error">{{ checklist.notice }}</p>
        <p v-if="checklist.items.length === 0" class="submission-check-empty">{{ CLEAN_TEXT }}</p>

        <section v-for="group in groups" :key="group.source" class="submission-check-group">
          <h4 class="submission-check-group-title">
            {{ group.label }}（{{ group.items.length }}）
          </h4>
          <ul class="submission-check-list">
            <li v-for="item in group.items" :key="item.id" class="submission-check-item">
              <div class="submission-check-row">
                <button
                  v-if="item.locate !== 'none'"
                  class="submission-check-jump"
                  type="button"
                  :title="`跳到：${item.locateLabel}`"
                  @click="jumpTo(item)"
                >
                  {{ item.title }}
                </button>
                <span v-else class="submission-check-title">{{ item.title }}</span>
                <span
                  class="submission-check-where"
                  :class="{ 'is-blind': item.locate === 'none' }"
                >
                  {{ item.locateLabel }}
                </span>
              </div>
              <p v-if="item.detail !== ''" class="submission-check-detail">{{ item.detail }}</p>
              <div class="submission-check-status" role="group" aria-label="处理状态">
                <button
                  v-for="status in CHECKLIST_STATUSES"
                  :key="status"
                  class="submission-check-mark"
                  :class="{
                    'is-todo': status === 'todo',
                    'is-fixed': status === 'fixed',
                    'is-ignored': status === 'ignored',
                    'is-active': checklist.statusOf(item.id) === status
                  }"
                  type="button"
                  :aria-pressed="checklist.statusOf(item.id) === status"
                  @click="checklist.setStatus(item.id, status)"
                >
                  {{ STATUS_LABELS[status] }}
                </button>
              </div>
            </li>
          </ul>
        </section>

        <p v-if="jumpNotice !== ''" class="submission-check-error">{{ jumpNotice }}</p>

        <p class="submission-check-foot">{{ timelineNoteText(checklist.timelineOther) }}</p>
        <p class="submission-check-foot">
          {{ castNoteText(checklist.cardCount, checklist.castGap) }}
        </p>
        <p class="submission-check-foot">
          {{ foreshadowNoteText(checklist.foreshadowTotal) }}
        </p>
      </template>

      <p class="submission-check-hint">{{ STATUS_HINT_TEXT }}</p>
    </section>
  </Teleport>
</template>
