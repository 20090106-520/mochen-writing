<!-- 右栏：结构、类名与标签/工具栏/页脚 markup 取自 deepwrite（Apache-2.0）的 RightEditorPane.vue -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { proseCharCount, splitFrontmatter } from "@mochen/contracts";
import AppIcon from "./AppIcon.vue";
import BookDossier from "./BookDossier.vue";
import DocumentTabBar from "./DocumentTabBar.vue";
import SnippetToolbar from "./SnippetToolbar.vue";
import { useSnippetToolbar } from "../composables/useSnippetToolbar";
import { useBookStore, type RightPaneMode } from "../stores/useBookStore";
import { dossierSummary, groupDocsForDossier } from "../utils/book-dossier";
import { BOOK_KIND_LABELS } from "../utils/book-kinds";
import { readingTimeLabel as formatReadingTime } from "../utils/reading-time";
import { BAND_LABELS, VIEW_TABS } from "../utils/right-pane-labels";
import { saveStateLabel } from "../utils/save-state";

const emit = defineEmits<{ collapse: [] }>();
const book = useBookStore();

/** 文稿 / 浏览 / 作品资料共用右栏这一格：后两者只读，且永不改写文稿标签与草稿。 */
const mode = computed(() => book.rightPaneMode);

const activeDoc = computed(() => (book.activeDocTab ? book.refOf(book.activeDocTab) : null));
const browseDoc = computed(
  () => book.browseTabs.find((doc) => doc.relPath === book.activeBrowse) ?? null
);

const breadcrumbs = computed(() => {
  const parts = [book.meta?.title ?? "未打开作品"];
  if (mode.value === "manuscript" && activeDoc.value) {
    parts.push(BOOK_KIND_LABELS[activeDoc.value.kind], activeDoc.value.title);
  } else if (mode.value === "browse" && browseDoc.value) {
    parts.push(BOOK_KIND_LABELS[browseDoc.value.kind], browseDoc.value.title);
  }
  return parts;
});

const title = computed(() =>
  mode.value === "manuscript" ? (activeDoc.value?.title ?? "") : (browseDoc.value?.title ?? "")
);

const dossier = computed(() => dossierSummary(book.meta, book.docs));
const dossierGroups = computed(() => groupDocsForDossier(book.docs));
const documentClasses = computed(() => ({
  "is-readonly": mode.value === "browse",
  "is-dossier": mode.value === "dossier"
}));

const editorEl = ref<HTMLTextAreaElement | null>(null);
/** 「读真实选区 → 纯函数 → book.onEdit → 回设光标」这段有行为的接线住 composables/，才谈得上被单测钉住。 */
const { snippetToolbar, applyToSelection } = useSnippetToolbar(editorEl);

/**
 * 页脚两格读的都是**正文**而不是草稿原文：文稿态那块是可编辑的 `<textarea>`，磁盘上的 frontmatter
 * （`---` / `title: …`）在里面看得见，但它不是作者写的字。计数口径与剥围栏的规则都只有一份
 * （`@mochen/contracts` 的 `proseCharCount` / `splitFrontmatter`），于是书卡上的「正文 N 字」
 * 与打开同一篇时页脚的 N 是同一个数——#103 之前这里是两套口径（页脚把围栏算成字）。
 */
const prose = computed(() => splitFrontmatter(book.draft).body);
const characterCount = computed(() => proseCharCount(prose.value));
const readingTimeLabel = computed(() => formatReadingTime(prose.value));

const saveStateText = computed(() =>
  saveStateLabel({
    conflict: book.conflict !== null,
    saving: book.saving,
    dirty: book.dirty,
    hasOpenDoc: book.activeDocTab !== null
  })
);

const tabs = computed(() =>
  mode.value === "manuscript"
    ? book.docTabs.map((relPath) => ({
        id: relPath,
        title: book.refOf(relPath)?.title ?? relPath
      }))
    : book.browseTabs.map((doc) => ({ id: doc.relPath, title: doc.title }))
);

const activeTabId = computed(() =>
  mode.value === "manuscript" ? book.activeDocTab : book.activeBrowse
);

function closeActiveTab(): void {
  const id = activeTabId.value;
  if (!id) return;
  if (mode.value === "manuscript") book.closeTab(id);
  else book.closeBrowse(id);
}

function selectTab(id: string): void {
  if (mode.value === "manuscript") void book.openDocTab(id);
  else {
    const doc = book.browseTabs.find((item) => item.relPath === id);
    if (doc) book.browse(doc);
  }
}

function onContentInput(event: Event): void {
  const target = event.target as HTMLTextAreaElement;
  book.onEdit(target.value);
}

/** 三枚页签同一个入口：dossier 的判定住在这里，不留到模板（附录 F-F 的「表驱动」）。 */
function switchMode(next: RightPaneMode): void {
  if (next === "dossier") {
    book.openDossier();
    return;
  }
  book.rightPaneMode = next;
}
</script>

<template>
  <aside class="editor-pane has-section-tabs" aria-label="文本内容">
    <header class="editor-header">
      <div class="editor-breadcrumbs">
        <span v-for="(part, index) in breadcrumbs" :key="`${part}-${index}`">
          {{ part }}<i v-if="index < breadcrumbs.length - 1">/</i>
        </span>
      </div>
      <div class="editor-header-actions">
        <span class="save-state" :class="{ 'is-dirty': book.dirty }">
          <AppIcon :name="book.dirty ? 'edit' : 'check'" :size="13" />
          {{ saveStateText }}
        </span>
        <button
          class="icon-button"
          type="button"
          aria-label="收起文本内容栏"
          @click="emit('collapse')"
        >
          <AppIcon name="panel-right" :size="18" />
        </button>
      </div>
    </header>

    <DocumentTabBar
      v-if="mode !== 'dossier'"
      :label="BAND_LABELS[mode]"
      :close-label="mode === 'manuscript' ? '关闭当前文稿标签' : '关闭当前浏览标签'"
      :tabs="tabs"
      :active-id="activeTabId"
      @select="selectTab"
      @close="closeActiveTab"
    />

    <div class="editor-toolbar">
      <div class="view-tabs" role="tablist" aria-label="右栏内容来源">
        <button
          v-for="tab in VIEW_TABS"
          :key="tab.mode"
          type="button"
          role="tab"
          :aria-selected="mode === tab.mode"
          :class="{ 'is-active': mode === tab.mode }"
          @click="switchMode(tab.mode)"
        >
          {{ tab.label }}
        </button>
      </div>
      <span class="toolbar-separator" />
      <SnippetToolbar :state="snippetToolbar" @pick="applyToSelection" />
    </div>

    <div class="editor-document" :class="documentClasses">
      <template v-if="mode !== 'dossier'">
        <div class="document-meta-row">
          <span class="document-format">md</span>
          <span v-if="mode === 'browse'" class="readonly-badge">浏览中，不影响文稿</span>
        </div>
        <input class="document-title-input" :value="title" readonly aria-label="文档标题" />
      </template>

      <BookDossier v-if="mode === 'dossier'" :summary="dossier" :groups="dossierGroups" />
      <textarea
        v-else-if="mode === 'manuscript'"
        ref="editorEl"
        class="document-editor transient-scrollbar"
        :value="book.draft"
        :readonly="!book.activeDocTab"
        aria-label="文本内容编辑器"
        spellcheck="false"
        @input="onContentInput"
      />
      <article v-else class="document-preview transient-scrollbar">
        <p v-if="!browseDoc" class="document-preview-empty">
          在左栏点人物、剧情、大纲或素材即可在此浏览，当前文稿与标签不受影响。
        </p>
        <p v-else class="document-preview-empty">
          {{ book.browseContents[browseDoc.relPath] ?? "正在读取…" }}
        </p>
      </article>
    </div>

    <footer class="editor-footer">
      <div class="editor-footer-meta">
        <template v-if="mode === 'manuscript'">
          <span>正文 {{ characterCount.toLocaleString("zh-CN") }} 字</span>
          <span class="reading-time">{{ readingTimeLabel }}</span>
        </template>
        <span class="editor-save-status">{{ book.notice || saveStateText }}</span>
      </div>
      <button
        class="save-button"
        type="button"
        :disabled="mode !== 'manuscript' || !book.activeDocTab || book.saving || !book.dirty"
        @click="book.saveActive()"
      >
        <AppIcon name="save" :size="14" />
        {{ book.saving ? "保存中…" : "保存到本机" }}
      </button>
    </footer>
  </aside>
</template>
