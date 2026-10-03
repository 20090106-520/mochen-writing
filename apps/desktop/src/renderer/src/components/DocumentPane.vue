<!-- 右栏：结构、类名与标签/工具栏/页脚 markup 取自 deepwrite（Apache-2.0）的 RightEditorPane.vue -->
<script setup lang="ts">
import { computed, ref } from "vue";
import AppIcon from "./AppIcon.vue";
import BookDossier from "./BookDossier.vue";
import DocumentTabBar from "./DocumentTabBar.vue";
import SnippetToolbar from "./SnippetToolbar.vue";
import { useSnippetToolbar } from "../composables/useSnippetToolbar";
import { useBookStore, type RightPaneMode } from "../stores/useBookStore";
import { dossierSummary, groupDocsForDossier } from "../utils/book-dossier";
import { BOOK_KIND_LABELS } from "../utils/book-kinds";
import { readingMinutes } from "../utils/reading-time";

const emit = defineEmits<{ collapse: [] }>();
const book = useBookStore();

/** 文稿 / 浏览 / 作品资料共用右栏这一格：后两者只读，且永不改写文稿标签与草稿。 */
const mode = computed(() => book.rightPaneMode);
/** 标签带的名字跟着右栏三态走；作品资料态整条不渲染，不留「浏览标签」的假名。 */
const BAND_LABELS = { manuscript: "文稿标签", browse: "浏览标签", dossier: "作品资料" } as const;

/** 右栏三枚页签的唯一标签表（模板不再各写一遍字面量）。 */
const viewTabs: { mode: RightPaneMode; label: string }[] = [
  { mode: "manuscript", label: "文稿" },
  { mode: "browse", label: "浏览" },
  { mode: "dossier", label: "作品资料" }
];

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

const characterCount = computed(() => book.draft.length);

/** 页脚那一格只拼文案：字数与时长都算 book.draft，且两格都只在文稿态出现——只读态报当前文稿的进度是假话。 */
const readingTimeLabel = computed(() => {
  const minutes = readingMinutes(book.draft);
  return minutes === null ? "— 分钟" : `约 ${minutes} 分钟阅读`;
});

const saveStateLabel = computed(() => {
  if (book.conflict) return "外部已改动，已拒绝覆盖";
  if (book.saving) return "正在保存到本机";
  if (book.dirty) return "有未保存修改";
  return book.activeDocTab ? "已保存到本机" : "未打开文稿";
});

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
          {{ saveStateLabel }}
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
          v-for="tab in viewTabs"
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
      <span class="toolbar-spacer" />
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
          <span>{{ characterCount.toLocaleString("zh-CN") }} 字</span>
          <span class="reading-time">{{ readingTimeLabel }}</span>
        </template>
        <span class="editor-save-status">{{ book.notice || saveStateLabel }}</span>
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
