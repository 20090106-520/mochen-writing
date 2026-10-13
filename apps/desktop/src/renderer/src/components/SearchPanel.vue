<!-- 全文搜索面板：浮层，快捷键 Ctrl+Shift+F 唤起 -->
<script setup lang="ts">
import { computed, ref, watch, toRef } from "vue";
import { storeToRefs } from "pinia";
import { useSearchStore, type SearchHit } from "../stores/useSearchStore";
import { useBookStore } from "../stores/useBookStore";
import { useLayoutStore } from "../stores/layoutStore";
import { BOOK_KIND_LABELS } from "../utils/book-kinds";
import { useModalFocus } from "../composables/useModalFocus";
import AppIcon from "./AppIcon.vue";
import { imeOwnsKey } from "../utils/slash-commands";
import { loadAllDocContents } from "../utils/doc-checkup";

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ close: [] }>();

/**
 * 焦点与 Esc 的真身在 useModalFocus（批次 5-㊲）。
 * 这一层是整屏遮罩 + role="dialog"，功能上就是模态层；真机量测（p536g）实测六处一模一样：
 * 焦点从不在层内、Esc 一次也收不掉（连 OutlinePanel 那一处 @keydown.esc 也够不着——
 * 它挂在搜索框上，而焦点压根没进过面板）。
 * Esc 与焦点进出统一由那一处接管，本组件不再留第二份判定。
 */
const panelRoot = ref<HTMLElement>();
useModalFocus({
  root: panelRoot,
  close: () => emit("close"),
  isOpen: toRef(() => props.visible)
});

const search = useSearchStore();
const book = useBookStore();
const layout = useLayoutStore();

const { lastResult, isSearching, searchHistory } = storeToRefs(search);
const inputRef = ref<HTMLInputElement | null>(null);
const localQuery = ref("");
const selectedIndex = ref(0);

// 打开时把焦点接进面板这一件事由 useModalFocus 一处提供（5-㊲ 撤掉了这里那处 setTimeout 聚焦）
watch(
  () => props.visible,
  (vis) => {
    if (vis) {
      localQuery.value = search.query;
    }
  }
);

// 防抖搜索
let debounceTimer: number | undefined;
function onInput(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(async () => {
    if (localQuery.value.trim().length >= 2) {
      // 需要全文内容，一次并行拉所有文档最新版本
      const docs = await loadAllDocContents(book.docs);
      search.search(docs, localQuery.value);
      selectedIndex.value = 0;
    } else if (localQuery.value.trim().length === 0) {
      search.clear();
    }
  }, 200);
}

const groupedHits = computed(() => {
  if (!lastResult.value) return [];
  const map = new Map<
    string,
    { docTitle: string; docKind: string; docRelPath: string; hits: SearchHit[] }
  >();
  for (const hit of lastResult.value.hits) {
    const key = hit.docRelPath;
    if (!map.has(key)) {
      map.set(key, {
        docTitle: hit.docTitle,
        docKind: hit.docKind,
        docRelPath: hit.docRelPath,
        hits: []
      });
    }
    map.get(key)!.hits.push(hit);
  }
  return [...map.values()];
});

function jumpToHit(hit: SearchHit): void {
  const ref = book.refOf(hit.docRelPath);
  if (!ref) return;
  if (ref.kind === "chapter") {
    void book.openDocTab(hit.docRelPath);
  } else {
    book.browse(ref);
  }
  // 通知右栏滚动到对应行（后续 IPC 支持）
  layout.requestDocGroup(ref.kind);
  emit("close");
}

function onKeydown(e: KeyboardEvent): void {
  if (imeOwnsKey(e)) return; // 组合态里那一下回车是输入法在选词，不是「跳到这条命中」
  if (!lastResult.value) return;
  const hits = lastResult.value.hits;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    selectedIndex.value = Math.min(selectedIndex.value + 1, hits.length - 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0);
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (hits[selectedIndex.value]) jumpToHit(hits[selectedIndex.value]);
  }
}

async function selectHistory(q: string): Promise<void> {
  localQuery.value = q;
  const docs = await loadAllDocContents(book.docs);
  search.search(docs, q);
}

// 扁平 index（给 template 用：整个列表的一项一编号）
function globalHitIndex(groupIdx: number, hitIdx: number): number {
  let idx = 0;
  for (let i = 0; i < groupIdx; i++) {
    idx += groupedHits.value[i].hits.length;
  }
  return idx + hitIdx;
}
</script>

<template>
  <div v-if="visible" class="search-overlay" @click.self="emit('close')">
    <div
      ref="panelRoot"
      class="search-panel"
      role="dialog"
      aria-modal="true"
      aria-label="全文搜索"
      tabindex="-1"
    >
      <div class="search-input-wrap">
        <AppIcon name="search" :size="16" class="search-icon" />
        <input
          ref="inputRef"
          v-model="localQuery"
          class="search-input"
          type="text"
          placeholder="搜索章节、大纲、角色、世界观…（至少 2 字）"
          @input="onInput"
          @keydown="onKeydown"
        />
        <kbd class="search-shortcut">Esc</kbd>
      </div>

      <!-- 搜索历史 -->
      <div v-if="!localQuery && searchHistory.length" class="search-history">
        <span class="search-section-label">最近搜索</span>
        <div class="search-history-chips">
          <button
            v-for="q in searchHistory.slice(0, 6)"
            :key="q"
            class="history-chip"
            type="button"
            @click="selectHistory(q)"
          >
            {{ q }}
          </button>
        </div>
      </div>

      <!-- 搜索结果 -->
      <div v-if="lastResult" class="search-body">
        <div class="search-stats">
          <span v-if="isSearching">搜索中…</span>
          <span v-else>
            共 {{ lastResult.totalHits }} 处匹配 · {{ lastResult.durationMs }}ms
            <span v-if="lastResult.mode === 'fuzzy'" class="search-mode-tag">一字之差容错</span>
          </span>
        </div>

        <div v-if="groupedHits.length === 0 && !isSearching" class="search-empty">
          <p>没有找到「{{ lastResult.query }}」的相关结果。</p>
          <p class="search-empty-hint">
            {{
              lastResult.mode === "fuzzy"
                ? "连一字之差的近似匹配也试过了，确实没有。"
                : "可尝试减少关键字或换个说法。"
            }}
          </p>
        </div>

        <div v-else class="search-groups">
          <div v-for="(group, gi) in groupedHits" :key="group.docRelPath" class="search-group">
            <div class="search-group-head">
              <AppIcon name="book" :size="13" />
              <span class="search-group-title">{{ group.docTitle }}</span>
              <span class="search-group-kind">{{
                BOOK_KIND_LABELS[group.docKind] ?? group.docKind
              }}</span>
            </div>
            <ul class="search-hit-list">
              <li
                v-for="(hit, hi) in group.hits"
                :key="`${hit.docRelPath}-${hit.lineNumber}-${hit.matchStart}`"
                :class="['search-hit', { 'is-selected': selectedIndex === globalHitIndex(gi, hi) }]"
                @click="jumpToHit(hit)"
              >
                <span class="hit-line">{{ hit.lineNumber }}</span>
                <span class="hit-context">
                  <span>{{ hit.beforeContext }}</span>
                  <mark>{{ hit.matchText }}</mark>
                  <span>{{ hit.afterContext }}</span>
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <!-- 快捷键提示 -->
      <div class="search-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
        <span><kbd>↵</kbd> 跳转</span>
        <span><kbd>Esc</kbd> 关闭</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  z-index: 2000;
}

.search-panel {
  width: 600px;
  max-width: 90vw;
  background: var(--dropdown-bg, #1e1e2a);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 10px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.search-input-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-light, rgba(255, 255, 255, 0.06));
}

.search-icon {
  color: var(--text-muted, #777);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary, #e8e8e8);
  font-size: 1.071429rem;
  padding: 4px 0;
}

.search-input::placeholder {
  color: var(--text-muted, #777);
}

.search-shortcut {
  font-size: 0.714286rem;
  padding: 2px 6px;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 4px;
  color: var(--text-secondary, #999);
  background: rgba(255, 255, 255, 0.04);
}

.search-history {
  padding: 12px 16px;
}

.search-section-label {
  display: block;
  font-size: 0.785714rem;
  color: var(--text-muted, #777);
  margin-bottom: 6px;
}

.search-history-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.history-chip {
  padding: 3px 10px;
  font-size: 0.857143rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 12px;
  color: var(--text-secondary, #999);
  cursor: pointer;
}

.history-chip:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-primary, #e8e8e8);
}

.search-body {
  max-height: 60vh;
  overflow-y: auto;
}

.search-stats {
  padding: 6px 16px;
  font-size: 0.785714rem;
  color: var(--text-muted, #777);
  border-bottom: 1px solid var(--border-light, rgba(255, 255, 255, 0.04));
}

.search-empty {
  padding: 24px 16px;
  text-align: center;
  color: var(--text-secondary, #999);
  font-size: 0.928571rem;
}

.search-empty p {
  margin: 0 0 6px;
}

.search-empty-hint {
  font-size: 0.785714rem;
  color: var(--text-muted, #777);
}

.search-mode-tag {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 0.714286rem;
  color: var(--text-secondary, #999);
  background: rgba(255, 200, 80, 0.14);
}

.search-groups {
  padding: 4px 0;
}

.search-group {
  margin-bottom: 8px;
}

.search-group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  font-size: 0.857143rem;
  color: var(--text-secondary, #999);
  position: sticky;
  top: 0;
  background: var(--dropdown-bg, #1e1e2a);
}

.search-group-kind {
  margin-left: auto;
  font-size: 0.714286rem;
  color: var(--text-muted, #777);
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
}

.search-hit-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.search-hit {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 5px 16px;
  cursor: pointer;
  font-size: 0.892857rem;
  line-height: 1.4;
}

.search-hit:hover,
.search-hit.is-selected {
  background: rgba(255, 255, 255, 0.04);
}

.hit-line {
  flex-shrink: 0;
  width: 28px;
  text-align: right;
  color: var(--text-muted, #777);
  font-variant-numeric: tabular-nums;
}

.hit-context {
  flex: 1;
  color: var(--text-secondary, #bbb);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hit-context mark {
  background: rgba(255, 200, 80, 0.25);
  color: var(--text-primary, #fff);
  border-radius: 2px;
  padding: 0 1px;
}

.search-footer {
  display: flex;
  gap: 16px;
  padding: 8px 16px;
  border-top: 1px solid var(--border-light, rgba(255, 255, 255, 0.06));
  font-size: 0.714286rem;
  color: var(--text-muted, #777);
}

.search-footer kbd {
  display: inline-block;
  padding: 1px 4px;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 3px;
  margin: 0 2px;
  font-size: 0.714286rem;
}
</style>
