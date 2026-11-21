<!-- 全文搜索面板：浮层，快捷键 Ctrl+Shift+F 唤起 -->
<script setup lang="ts">
import { computed, nextTick, ref, watch, toRef } from "vue";
import { storeToRefs } from "pinia";
import { useSearchStore, type SearchHit } from "../stores/useSearchStore";
import { useBookStore } from "../stores/useBookStore";
import { BOOK_KIND_LABELS } from "../utils/book-kinds";
import { useModalFocus } from "../composables/useModalFocus";
import AppIcon from "./AppIcon.vue";
import { imeOwnsKey } from "../utils/slash-commands";
import { loadAllDocContents } from "../utils/doc-checkup";
import { useNotificationStore } from "../stores/useNotificationStore";
import { bookReplaceNotice, runBookReplace } from "../utils/book-replace";
import { revealEditorLine } from "../utils/editor-reveal";

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
const notif = useNotificationStore();

const { lastResult, isSearching, searchHistory } = storeToRefs(search);
const inputRef = ref<HTMLInputElement | null>(null);
const localQuery = ref("");
const selectedIndex = ref(0);

/* ────────────────── 全书替换（2026-10-15） ────────────────── */

const localReplacement = ref("");
/**
 * 「全书替换」的两步确认：第一下把按钮变成「确认替换全书 N 篇？」，第二下才真动手。
 * 没有这一步，一次误点就把上千篇文稿翻一遍——虽然每篇改前的样子都会进改稿历史、
 * 逐篇还有指纹守卫兜着，但「能找回」不等于「该让它随随便便发生」。
 */
const replaceArmed = ref(false);
const replacing = ref(false);

/**
 * 能不能做全书替换：**只在精确命中那一轮里给**。
 * 容错命中（一字之差）是「相似不是相同」——照着它去改盘上正文，会把用户没找的那几个字一起换掉，
 * 那正是「不做假控件」要拦的事。所以这一轮不给按钮，也不留一句「点了没反应」的空控件。
 */
const canReplace = computed(
  () =>
    lastResult.value !== null &&
    lastResult.value.mode === "exact" &&
    localQuery.value.trim().length >= 2
);

// 查询或替换词一变就把确认撤掉：留着它，等于让「我刚才确认过的」替一份没确认过的输入背书。
watch([localQuery, localReplacement], () => {
  replaceArmed.value = false;
});

function onReplaceKeydown(e: KeyboardEvent): void {
  // 组合态里那一下回车是输入法在选词，不是「确认替换」。
  if (imeOwnsKey(e)) return;
  if (e.key === "Enter") {
    e.preventDefault();
    void onReplaceAll();
  }
}

async function onReplaceAll(): Promise<void> {
  const query = localQuery.value.trim();
  if (!canReplace.value || query === "" || replacing.value) return;
  if (!replaceArmed.value) {
    replaceArmed.value = true;
    return;
  }
  replaceArmed.value = false;
  replacing.value = true;
  try {
    const result = await runBookReplace({
      query,
      replacement: localReplacement.value,
      // 与检索口径一致：面板找人时就不分大小写，换的时候也照同一档走。
      caseSensitive: false
    });
    const notice = bookReplaceNotice(result, query, localReplacement.value);
    notif.notify({ title: "全书替换", message: notice.message, level: notice.level });
  } finally {
    replacing.value = false;
  }
}

/* ──────────────────────────────────────────────────────────── */

// 打开时把焦点接进面板这一件事由 useModalFocus 一处提供（5-㊲ 撤掉了这里那处 setTimeout 聚焦）
watch(
  () => props.visible,
  (vis) => {
    if (vis) {
      localQuery.value = search.query;
    }
    // 收起来就把确认撤掉：面板再打开时那一枚按钮不该还是「确认替换…」的样子。
    replaceArmed.value = false;
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

async function jumpToHit(hit: SearchHit): Promise<void> {
  const ref = book.refOf(hit.docRelPath);
  if (!ref) return;
  if (ref.kind === "chapter") {
    // 打开命中那一章后直接定位到行：revealEditorLine 是交稿体检同一条真身。
    // 之前发的 requestDocGroup 会让左栏打开该分组第一篇，把刚开的命中章顶掉——
    // 搜「某人」命中第 12 章，点过去却站在第 1 章，全书检索基本废了，已摘。
    await book.openDocTab(hit.docRelPath);
    await nextTick();
    revealEditorLine(hit.lineNumber);
  } else {
    book.browse(ref);
  }
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

      <!-- 全书替换（2026-10-15）：只在**精确命中**那一轮里给（见 canReplace 的说明）。
           替换在主进程逐篇做：指纹守卫 + 整篇备份 + 原子写，回执如实报哪几篇没动。 -->
      <div v-if="canReplace" class="search-replace-row">
        <span class="search-replace-hint">替换为</span>
        <input
          v-model="localReplacement"
          class="search-replace-input"
          type="text"
          spellcheck="false"
          placeholder="替换成…（留空＝删掉）"
          aria-label="替换为"
          @keydown="onReplaceKeydown($event)"
        />
        <button
          type="button"
          class="search-replace-btn"
          :class="{ 'is-armed': replaceArmed }"
          :disabled="replacing"
          @click="onReplaceAll"
        >
          {{
            replacing
              ? "替换中…"
              : replaceArmed
                ? `确认替换全书 ${book.docs.length} 篇？`
                : "全书替换"
          }}
        </button>
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
  z-index: var(--z-drawer);
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

/* 键帽的形状在 styles.css 的元素规则一处（2026-10-25 收敛到一处），这里只留这一枚的字号。
   原先这里自带一整套（4px 圆角 + 白描边 + 深底），与别的浮层的键帽不是一个东西。 */
.search-shortcut {
  font-size: 0.714286rem;
}

/* 全书替换那一行：只在精确命中且查询有效时进 DOM（见 canReplace）。 */
.search-replace-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-light, rgba(255, 255, 255, 0.06));
}

.search-replace-hint {
  flex-shrink: 0;
  font-size: 0.785714rem;
  color: var(--text-muted, #777);
}

.search-replace-input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 4px 9px;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary, #e8e8e8);
  font-size: 0.928571rem;
  outline: none;
}

.search-replace-input:focus-within {
  border-color: var(--accent, #7c5c3e);
}

.search-replace-input::placeholder {
  color: var(--text-muted, #777);
}

.search-replace-btn {
  flex-shrink: 0;
  height: 26px;
  padding: 0 12px;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary, #999);
  font-size: 0.785714rem;
  cursor: pointer;
  white-space: nowrap;
}

.search-replace-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--theme-foreground, #1a1c1f) 6%, transparent);
  color: var(--text-primary, #e8e8e8);
}

/* 按下第一下之后是「确认替换全书 N 篇？」——这一步与第一下必须一眼分得开，
   否则「误点两次」就等于没有确认。 */
.search-replace-btn.is-armed {
  background: var(--accent, #7c5c3e);
  border-color: var(--accent, #7c5c3e);
  color: var(--neutral-solid-contrast, #fff);
}

.search-replace-btn:disabled {
  opacity: 0.45;
  cursor: default;
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
  background: color-mix(in srgb, var(--theme-foreground, #1a1c1f) 4%, transparent);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 12px;
  color: var(--text-secondary, #999);
  cursor: pointer;
}

.history-chip:hover {
  background: color-mix(in srgb, var(--theme-foreground, #1a1c1f) 8%, transparent);
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
  background: color-mix(in srgb, var(--theme-foreground, #1a1c1f) 4%, transparent);
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
  font-size: 0.928571rem;
  line-height: 1.4;
}

.search-hit:hover,
.search-hit.is-selected {
  background: color-mix(in srgb, var(--theme-foreground, #1a1c1f) 4%, transparent);
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

/* 键帽形状在 styles.css 的元素规则一处；这里只留这一行提示自己的间距与字号。 */
.search-footer kbd {
  margin: 0 2px;
  font-size: 0.714286rem;
}
</style>
