<!-- 右栏：结构、类名与标签/工具栏/页脚 markup 取自 deepwrite（Apache-2.0）的 RightEditorPane.vue -->
<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "./AppIcon.vue";
import { useBookStore } from "../stores/useBookStore";

const emit = defineEmits<{ collapse: [] }>();
const book = useBookStore();

/** 文稿与浏览共用右栏这一格：浏览只读，且不改文稿标签与草稿。 */
const mode = computed(() => book.rightPaneMode);

const activeDoc = computed(() => (book.activeDocTab ? book.refOf(book.activeDocTab) : null));
const browseDoc = computed(
  () => book.browseTabs.find((doc) => doc.relPath === book.activeBrowse) ?? null
);

const breadcrumbs = computed(() => {
  const parts = [book.meta?.title ?? "未打开作品"];
  if (mode.value === "manuscript" && activeDoc.value) {
    parts.push(activeDoc.value.kind, activeDoc.value.title);
  } else if (mode.value === "browse" && browseDoc.value) {
    parts.push(browseDoc.value.kind, browseDoc.value.title);
  }
  return parts;
});

const title = computed(() =>
  mode.value === "manuscript" ? (activeDoc.value?.title ?? "") : (browseDoc.value?.title ?? "")
);

const characterCount = computed(() => book.draft.length);

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

function switchMode(next: "manuscript" | "browse"): void {
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

    <nav class="section-tabs-bar" :aria-label="mode === 'manuscript' ? '文稿标签' : '浏览标签'">
      <div class="section-tabs-scroll" role="tablist">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="section-tab"
          :class="{ 'is-active': tab.id === activeTabId }"
          type="button"
          role="tab"
          :aria-selected="tab.id === activeTabId"
          :title="tab.title"
          @click="selectTab(tab.id)"
        >
          {{ tab.title }}
        </button>
      </div>
      <button
        v-if="tabs.length"
        class="section-tabs-remove"
        type="button"
        :aria-label="mode === 'manuscript' ? '关闭当前文稿标签' : '关闭当前浏览标签'"
        @click="closeActiveTab"
      >
        <AppIcon name="minus" :size="16" />
      </button>
    </nav>

    <div class="editor-toolbar">
      <div class="view-tabs" role="tablist" aria-label="右栏内容来源">
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'manuscript'"
          :class="{ 'is-active': mode === 'manuscript' }"
          @click="switchMode('manuscript')"
        >
          文稿
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'browse'"
          :class="{ 'is-active': mode === 'browse' }"
          @click="switchMode('browse')"
        >
          浏览
        </button>
      </div>
      <span class="toolbar-spacer" />
    </div>

    <div class="editor-document" :class="{ 'is-readonly': mode === 'browse' }">
      <div class="document-meta-row">
        <span class="document-format">md</span>
        <span v-if="mode === 'browse'" class="readonly-badge">浏览中，不影响文稿</span>
      </div>

      <input class="document-title-input" :value="title" readonly aria-label="文档标题" />

      <textarea
        v-if="mode === 'manuscript'"
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
        <span>{{ characterCount.toLocaleString("zh-CN") }} 字</span>
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
