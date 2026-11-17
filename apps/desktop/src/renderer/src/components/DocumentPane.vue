<!-- 右栏：结构、类名与标签/工具栏/页脚 markup 取自 deepwrite的 RightEditorPane.vue -->
<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { proseCharCount, splitFrontmatter } from "@mochen/contracts";
import { markdownToSimpleHtml } from "@mochen/fs-store/export-shared";
import AppIcon from "./AppIcon.vue";
import BookDossier from "./BookDossier.vue";
import DocumentTabBar from "./DocumentTabBar.vue";
import ChangeHistoryPanel from "./ChangeHistoryPanel.vue";
import SlopPanel from "./SlopPanel.vue";
import ReviewScorePanel from "./ReviewScorePanel.vue";
import ForeshadowPanel from "./ForeshadowPanel.vue";
import TimelineCheckPanel from "./TimelineCheckPanel.vue";
import CastCheckPanel from "./CastCheckPanel.vue";
import ChapterReference from "./ChapterReference.vue";
import MaterialButton from "./MaterialButton.vue";
import ReviewMenu from "./ReviewMenu.vue";
import VolumeOutlinePanel from "./VolumeOutlinePanel.vue";
import SnippetToolbar from "./SnippetToolbar.vue";
import SelectionRewriteBar from "./SelectionRewriteBar.vue";
import FindReplacePanel from "./FindReplacePanel.vue";
import { useSnippetToolbar } from "../composables/useSnippetToolbar";
import { imeOwnsKey, popoverOwnsKey } from "../utils/slash-commands";
import { useEditUndo } from "../composables/useEditUndo";
import { useBookStore, type EditorViewMode, type RightPaneMode } from "../stores/useBookStore";
import { useFindReplaceStore } from "../stores/useFindReplaceStore";
import { useTimelineStore } from "../stores/useTimelineStore";
import { useCastCheckStore } from "../stores/useCastCheckStore";
import type { ReviewToolId } from "../utils/review-tools";
import type { HotkeyMods } from "../utils/hotkeys";
import EditorFooterMeta from "./EditorFooterMeta.vue";
import { useLayoutStore } from "../stores/layoutStore";
import { isStructuredKind, useVolumeOutlineStore } from "../stores/useVolumeOutlineStore";
import { dossierSummary, groupDocsForDossier } from "../utils/book-dossier";
import { BOOK_KIND_LABELS } from "../utils/book-kinds";
import {
  loadEditorLeading,
  editorLeadingPreferenceStorage
} from "../utils/editor-leading-preference";
import {
  loadEditorSize,
  loadEditorSpellcheck,
  editorTextPreferenceStorage
} from "../utils/editor-text-preference";
import {
  loadEditorMeasure,
  editorMeasurePreferenceStorage
} from "../utils/editor-measure-preference";
import { readingTimeLabel as formatReadingTime } from "../utils/reading-time";
import { EDITOR_EMPTY_HINT, editorBodyState, editorLoadingLabel } from "../utils/editor-readout";
import { browseBodyViewOf } from "../utils/browse-body";
import { findMirrorHtml, FIND_MIRROR_DEBOUNCE_MS } from "../utils/find-mirror";
import { usePreviewDraft } from "../composables/usePreviewDraft";
import { useTrailingValue } from "../composables/useTrailingValue";
import { BAND_LABELS, VIEW_TABS } from "../utils/right-pane-labels";
import { saveStateLabel } from "../utils/save-state";
const emit = defineEmits<{ collapse: [] }>();
const book = useBookStore();
const find = useFindReplaceStore();
/** 改稿历史浮层（2026-10-05）：锚点是那颗按钮本身；开关与在途标记都住 store（面板自己那份会与「回滚完要重载正文」各说各话）。 */
const changeHistoryButton = ref<HTMLElement>();
const changeHistoryAnchor = computed(() => changeHistoryButton.value ?? null);
const changeHistoryOpen = computed({
  get: () => book.changeHistoryOpen,
  set: (open: boolean) => {
    if (open) void book.openChangeHistory();
    else book.closeChangeHistory();
  }
});

function toggleChangeHistory(): void {
  changeHistoryOpen.value = !changeHistoryOpen.value;
}

/**
 * 「审稿」下拉（P0-5）：五枚检查入口收进这一颗按钮（清单住在 utils/review-tools）。
 * 五块面板共用这颗**常驻**按钮当锚点——菜单行一关就卸载，拿它当锚点面板会跟着消失；
 * 也正因为锚点同一个，挑一项前先把其余几块收起来，免得精确叠在一起。
 */
const reviewMenuOpen = ref(false);
const reviewMenuButton = ref<HTMLElement>();
const reviewMenuAnchor = computed(() => reviewMenuButton.value ?? null);
const cast = useCastCheckStore();
/** 伏笔台账 / 时间线核对的开关住 store（左栏也要开它们）；去 AI 味 / 审稿打分仍住组件本地。 */
const timeline = useTimelineStore();
const slopOpen = ref(false);
const reviewOpen = ref(false);

function pickReview(id: ReviewToolId): void {
  reviewMenuOpen.value = false;
  slopOpen.value = false;
  reviewOpen.value = false;
  timeline.close();
  cast.close();
  book.foreshadowsOpen = false;
  if (id === "slop") {
    slopOpen.value = true;
  } else if (id === "review") {
    reviewOpen.value = true;
  } else if (id === "timeline") {
    void timeline.toggle();
  } else if (id === "cast") {
    void cast.toggle();
  } else {
    void book.loadForeshadows();
    book.foreshadowsOpen = true;
  }
}

/** 焦点还停在触发钮上时按 Esc：这一层自己收菜单，stopPropagation 之后全局裁决看不见它。 */
function onReviewMenuKeydown(event: KeyboardEvent): void {
  if (!reviewMenuOpen.value) return;
  const mods: HotkeyMods = {
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey
  };
  if (popoverOwnsKey(event.key, mods, imeOwnsKey(event))) {
    event.stopPropagation();
    reviewMenuOpen.value = false;
  }
}

/**
 * 导出面板的开合住在 layoutStore（App 也读那一份，不另持本地 ref——铁律 6）。
 */
const layout = useLayoutStore();

/** 卷纲 → 章纲浮层（2026-10-05，批次 5-②）。锚点同款。只在打开的是分卷/大纲时亮（`isStructuredKind`）——章节正文拆不成章纲，按钮亮了却拆不出来就是骗人。 */
const volumeOutline = useVolumeOutlineStore();
const volumeOutlineButton = ref<HTMLElement>();
const volumeOutlineAnchor = computed(() => volumeOutlineButton.value ?? null);

const {
  visible: findVisible,
  query: findQuery,
  caseSensitive,
  useRegex,
  wholeWord,
  currentIndex
} = storeToRefs(find);

/** 文稿 / 浏览 / 作品资料共用右栏这一格：后两者只读，且永不改写文稿标签与草稿。 */
const mode = computed(() => book.rightPaneMode);

/** 文稿区本地视图态（编辑 / 分栏 / 预览）：从 store 读，切文档时跟着 store 重置。 */
const viewMode = computed<EditorViewMode>({
  get: () => book.editorViewMode,
  set: (v) => {
    book.editorViewMode = v;
  }
});

const activeDoc = computed(() => (book.activeDocTab ? book.refOf(book.activeDocTab) : null));
/** 卷纲 → 章纲那颗按钮亮不亮：只在打开的是分卷/大纲时亮（判据在 store 那一格，不在模板里写死）。 */
const canStructure = computed(() => isStructuredKind(activeDoc.value?.kind ?? "chapter"));
const browseDoc = computed(
  () => book.browseTabs.find((doc) => doc.relPath === book.activeBrowse) ?? null
);

/** 浏览那一格显示的正文（2026-10-09 扫描总单 P1-9）：原来模板里直接写 `… ?? "正在读取…"`，
 * 读盘失败后那一格就永远停在「正在读取…」——比空着更糟，它在撒谎。三态判据在 `utils/browse-body`。 */
const browseView = computed(() =>
  browseBodyViewOf(book.browseContents, book.browseErrors, browseDoc.value?.relPath)
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

/** 正文这一格摆什么：骨架 / 空态 / 正文（2026-10-05 批次 3 尾巴）。判定与话术全在 utils/editor-readout。 */
const bodyState = computed(() =>
  editorBodyState({ loading: book.docLoading, hasDoc: book.activeDocTab !== null })
);
const loadingLabel = computed(() => editorLoadingLabel(title.value));
/** 骨架摆几行：够撑住一屏的视觉重量，又不至于把「正在读」撑成半个编辑器。 */
const SKELETON_LINES = 7;

const dossier = computed(() => dossierSummary(book.meta, book.docs));
const dossierGroups = computed(() => groupDocsForDossier(book.docs));
const documentClasses = computed(() => ({
  "is-readonly": mode.value === "browse",
  "is-dossier": mode.value === "dossier"
}));

const editorEl = ref<HTMLTextAreaElement | null>(null);
/** 预览区滚动容器 ref（分栏模式 scroll 同步用）。 */
const previewPaneEl = ref<HTMLDivElement | null>(null);
/** 查找高亮镜像层：被 textarea 压在底下，渲染同文本文 + <mark> 高亮。 */
const highlightMirrorEl = ref<HTMLDivElement | null>(null);

/**
 * 「替换 / 全部替换」的退路（2026-10-09 扫描总单·不存在表：批量替换后 Ctrl+Z 救不回）。
 * 判定住 `utils/edit-undo`（19 条），行为住 `composables/useEditUndo`（17 条：真 store + 替身 textarea）；
 * 这里只剩挂线：提示给面板、键交正文、手打的字报给 invalidate。下面 useSnippetToolbar 共用这一个栈。
 */
const {
  undoNoticeText,
  replaceWithUndo,
  commitWithUndo,
  undoLastEdit,
  invalidate: invalidateUndo,
  onEditorKeydown
} = useEditUndo(editorEl);

// 片段插入（加粗那种）与批量替换是同一种病：整篇赋值会清空 textarea 的原生撤销栈。
// 所以它不自己写草稿，而是把新文本与新光标交给同一份撤销栈——点错一下也退得回来。
const { snippetToolbar, applyToSelection } = useSnippetToolbar(editorEl, (nextText, caret) =>
  commitWithUndo(nextText, "snippet", 1, caret)
);

/**
 * 行距档 + 正文字号档 + 拼写检查（设置页「写作」）：设置中心与工作区是互斥挂载的两个视图，
 * 回到正文必然重新挂载，在这里读一次就够；拼写检查直接绑 textarea 的 :spellcheck（原本写死 false）。
 *
 * 行距/字号/列宽三档**一起**挂 `.editor-document`（2026-10-06 批次 5-㉒ 定下的挂法；5-㉑ 曾挂
 * `.editor-textarea-wrap`、更早挂 textarea）：那一格同时住着 ①文稿 textarea 与压在它底下的
 * `.find-replace-mirror`（inset:0 贴 wrap）、②分栏预览 `.markdown-body`、③浏览态 `.document-preview`。
 * 三个面读同一组变量、同一个兜底，天生该同版；变量挂其中任何一个盒子上，另外几个就读不到只能吃
 * 兜底——两种症状（mirror 字号对不上、分栏左右两种字号）真机量过，逐条记录在 5-㉑/5-㉒ 与
 * writing-preferences-contract 的用例里。挂共同祖先四个盒子才读到同一份值；
 * `var(xxx, 原值)` 缺席即原值，两边不互相冒充默认档。
 */
const editorLayoutStyle = {
  "--editor-leading": String(loadEditorLeading(editorLeadingPreferenceStorage())),
  "--editor-font-size": `${loadEditorSize(editorTextPreferenceStorage())}px`,
  // 正文列宽档（每行多少字）：样式表 `max-width: var(--editor-measure, none)` 的兜底 none
  // 就是原版式（不设上限）。
  "--editor-measure": String(loadEditorMeasure(editorMeasurePreferenceStorage()))
} as const;
const editorSpellcheck = loadEditorSpellcheck(editorTextPreferenceStorage());

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

/** Markdown 预览的 HTML：吃 `previewDraft`（落后一拍的草稿）。理由见 utils/preview-debounce 与 composables/usePreviewDraft。 */
const previewDraft = usePreviewDraft(() => book.draft, viewMode);
/** 2026-10-23：预览只该看正文——草稿含 `---` 围栏与 `title:`，原样渲染会把元数据当小说；剥围栏真身是 contracts 的 splitFrontmatter（不另写一套）。 */
const previewHtml = computed(() => markdownToSimpleHtml(splitFrontmatter(previewDraft.value).body));

/** 高亮层 HTML：内容闸在这里；怎么切、为什么吃 mirrorSource 快照——见 utils/find-mirror 注释。 */
const mirrorSource = useTrailingValue(
  () =>
    findVisible.value && mode.value === "manuscript"
      ? { draft: book.draft, positions: find.positions, index: currentIndex.value }
      : { draft: book.draft, positions: [], index: -1 },
  () => (findVisible.value ? FIND_MIRROR_DEBOUNCE_MS : 0)
);
const highlightMirrorHtml = computed(() => {
  if (!findVisible.value || mode.value !== "manuscript" || findQuery.value === "") return "";
  const snap = mirrorSource.value;
  return findMirrorHtml(snap.draft, snap.positions, snap.index);
});

/** textarea 滚，mirror 跟着滚——视觉上高亮要贴在文字背后。 */
function syncMirrorScroll(): void {
  const ta = editorEl.value;
  const mirror = highlightMirrorEl.value;
  // mirror 现在是条件挂载（P2-13）：面板关着时 ref 为 null，这里安静跳过。
  if (!ta || !mirror) return;
  if (mirror.scrollTop !== ta.scrollTop) mirror.scrollTop = ta.scrollTop;
  if (mirror.scrollLeft !== ta.scrollLeft) mirror.scrollLeft = ta.scrollLeft;
}

/** P2-13 的另一半：面板打开那一瞬刚挂上的层 scrollTop=0，同拍跟一次才不错位。 */
watch(findVisible, async (visible) => {
  if (!visible) return;
  await nextTick();
  syncMirrorScroll();
});

/**
 * 分栏模式滚动同步：textarea（左）滚到哪，预览区（右）按比例跟到哪。
 * 只在上游 textarea scroll 事件里调用，不回滚 textarea（避免循环）。
 */
function syncPreviewScroll(): void {
  const ta = editorEl.value;
  const preview = previewPaneEl.value;
  if (!ta || !preview) return;
  if (viewMode.value !== "split") return;
  const taScrollable = ta.scrollHeight - ta.clientHeight;
  const previewScrollable = preview.scrollHeight - preview.clientHeight;
  if (taScrollable <= 0 || previewScrollable <= 0) return;
  const ratio = ta.scrollTop / taScrollable;
  const targetTop = ratio * previewScrollable;
  if (Math.abs(preview.scrollTop - targetTop) > 1) {
    preview.scrollTop = targetTop;
  }
}

/** 查询 / 文档文本 / 选项 任一变动都重新算高亮 */
watch(
  [() => book.draft, findQuery, caseSensitive, useRegex, wholeWord, findVisible, mode],
  () => {
    if (findVisible.value && mode.value === "manuscript") {
      find.highlightPositions(book.draft);
    } else if (!findVisible.value) {
      // 关面板时清掉，免得下次打开闪旧结果
      find.highlightPositions("");
    }
  },
  { immediate: true }
);

const activeTabId = computed(() =>
  mode.value === "manuscript" ? book.activeDocTab : book.activeBrowse
);

function closeActiveTab(): void {
  const id = activeTabId.value;
  if (!id) return;
  if (mode.value === "manuscript") void book.closeTab(id);
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
  // 红线②：用户自己打了一个字，原生撤销栈从这一刻重新当家，替换那几份快照当场作废
  // （整栈再留着，下一次 Ctrl+Z 就会把他刚写的内容连同一篇旧文本一起盖回去）。
  invalidateUndo();
  book.onEdit(target.value);
}

/** textarea 滚到哪，mirror 就跟到哪——高亮始终贴在文字背后。 */
function onEditorScroll(): void {
  syncMirrorScroll();
  syncPreviewScroll();
}

/**
 * 标题行可编辑：只改 frontmatter 的 title 行（renameDocTitle 走指纹链），relPath 与文件名不动——
 * 那要牵动 chapterOrder 与会话。提交只有 blur 一条路（Enter 只移开焦点，避免 Enter+blur 双发；
 * Esc / 空名当场弹回），提交后无论成败都把显示值对齐 store 的真相。
 */
function blurTitle(event: Event): void {
  (event.target as HTMLInputElement).blur();
}

/**
 * 标题行的键盘裁决（批次 5-㊶）。
 *
 * 【为什么 preventDefault 写在这里，而不是留在模板的 `.enter.prevent` 上】
 * 模板修饰符是无条件执行的：它先 preventDefault，再调 handler。
 * 组合态里那一下回车是输入法在选词，handler 里再怎么提前 return 也拦不住——
 * 于是拼音被当标题提交（title.value 里此刻就是拼音），再 blur 落盘。
 * ⇒ 闸门与 preventDefault 必须在同一个函数里，模板上不许再挂 `.prevent`。
 */
function onTitleKeydown(event: KeyboardEvent): void {
  if (imeOwnsKey(event)) return;
  if (event.key === "Enter") {
    event.preventDefault();
    blurTitle(event);
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    revertTitle(event);
  }
}

function revertTitle(event: Event): void {
  const target = event.target as HTMLInputElement;
  target.value = title.value;
}

function commitTitle(event: Event): void {
  const target = event.target as HTMLInputElement;
  const relPath = activeTabId.value;
  if (relPath === null) return;
  const value = target.value;
  if (value === title.value) return;
  if (value.trim() === "") {
    target.value = title.value;
    return;
  }
  void book.renameDocTitle(relPath, value).then(() => {
    target.value = title.value;
  });
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
  <aside
    class="editor-pane has-section-tabs"
    :class="{ 'is-dossier': mode === 'dossier' }"
    aria-label="文本内容"
  >
    <header class="editor-header">
      <div class="editor-breadcrumbs">
        <span v-for="(part, index) in breadcrumbs" :key="`${part}-${index}`">
          {{ part }}<i v-if="index < breadcrumbs.length - 1">/</i>
        </span>
      </div>
      <div class="editor-header-actions">
        <!-- 批次 5-⑳：这里原来还有一份保存状态，与底栏 `.editor-save-status` 读同一个值。
             真机 1440 视口：这一行要 407px、内容盒只有 328px，多出的 79px 把面包屑压成 0 宽、
             最右两枚按钮画进窗控预留带；去掉这份重复显示正好腾出 79px，保存状态仍在底栏。 -->
        <!-- P0-5：写作组常驻（改稿历史、素材库、卷纲→章纲、导出、字数统计），检查组五项收进
             「审稿」下拉。入口一个都没少——1440 视口下右栏内容盒只有 328px，八枚平铺时面包屑已被压成 0 宽。 -->
        <div class="editor-tool-group" role="group" aria-label="写作工具">
          <!-- 改稿历史：批准提案留下的改前备份只有这里读得回来。没开书时禁用。 -->
          <button
            ref="changeHistoryButton"
            class="icon-button"
            type="button"
            aria-label="改稿历史"
            title="改稿历史：回滚到某一次改稿之前"
            :disabled="!book.meta"
            @click="toggleChangeHistory"
          >
            <AppIcon name="history" :size="17" />
          </button>
          <!-- 素材库：给 AI 读的参考材料，可导入文本、让 AI 整理入库。 -->
          <MaterialButton />
          <!-- 卷纲 → 章纲：把自由 markdown 拆成字段表，再一键落成大纲文稿。纯本地。 -->
          <button
            ref="volumeOutlineButton"
            class="icon-button"
            type="button"
            aria-label="卷纲转章纲"
            title="卷纲转章纲：把这一篇拆成章节字段表，可一键生成大纲文稿"
            :disabled="!canStructure"
            @click="void volumeOutline.toggleFor(activeDoc)"
          >
            <AppIcon name="list" :size="17" />
          </button>
          <!-- 导出是整本书的事：面板住在 App 里，开合读 layoutStore 那一格。 -->
          <button
            class="icon-button"
            type="button"
            aria-label="导出作品"
            title="导出作品：Markdown / 纯文本 / HTML / Word / 电子书 (.epub) / JSON"
            :disabled="!book.meta"
            @click="layout.openExport()"
          >
            <AppIcon name="download" :size="17" />
          </button>
          <button
            class="icon-button"
            type="button"
            aria-label="字数统计"
            title="字数统计：全书字数、章节分布与写作目标进度"
            :disabled="!book.meta"
            @click="layout.openWordCount()"
          >
            <AppIcon name="ledger" :size="17" />
          </button>
        </div>
        <span class="editor-tools-divider" aria-hidden="true"></span>
        <div class="editor-tool-group" role="group" aria-label="检查工具">
          <button
            ref="reviewMenuButton"
            class="icon-button review-menu-toggle"
            type="button"
            aria-label="审稿工具"
            aria-haspopup="listbox"
            :aria-expanded="reviewMenuOpen"
            title="审稿：去 AI 味、审稿打分、时间线核对、人物设定核对、伏笔台账"
            :disabled="!book.meta"
            @click="reviewMenuOpen = !reviewMenuOpen"
            @keydown="onReviewMenuKeydown"
          >
            <AppIcon name="check" :size="17" />
            <span class="review-menu-caret" aria-hidden="true">
              <AppIcon name="chevron" :size="9" />
            </span>
          </button>
        </div>

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

    <ReviewMenu
      v-if="reviewMenuOpen && reviewMenuAnchor"
      :anchor="reviewMenuAnchor"
      @pick="pickReview"
      @close="reviewMenuOpen = false"
    />

    <ChangeHistoryPanel
      v-if="changeHistoryOpen && changeHistoryAnchor"
      :anchor="changeHistoryAnchor"
      @close="book.closeChangeHistory()"
    />

    <SlopPanel
      v-if="slopOpen && reviewMenuAnchor"
      :anchor="reviewMenuAnchor"
      @close="slopOpen = false"
    />

    <ReviewScorePanel
      v-if="reviewOpen && reviewMenuAnchor"
      :anchor="reviewMenuAnchor"
      @close="reviewOpen = false"
    />

    <TimelineCheckPanel
      v-if="timeline.open && reviewMenuAnchor"
      :anchor="reviewMenuAnchor"
      @close="timeline.close()"
    />

    <CastCheckPanel
      v-if="cast.open && reviewMenuAnchor"
      :anchor="reviewMenuAnchor"
      @close="cast.close()"
    />

    <VolumeOutlinePanel
      v-if="volumeOutline.open && volumeOutlineAnchor"
      :anchor="volumeOutlineAnchor"
      @close="volumeOutline.close()"
    />

    <ForeshadowPanel
      v-if="book.foreshadowsOpen && reviewMenuAnchor"
      :anchor="reviewMenuAnchor"
      @close="book.foreshadowsOpen = false"
    />

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

    <!-- 文档内查找替换（Ctrl+F）。替换与全部替换都带处数进快照（提示要说"已替换 N 处"）。 -->
    <FindReplacePanel
      v-if="findVisible && mode === 'manuscript'"
      :undo-notice="undoNoticeText"
      @replace="(text, count) => replaceWithUndo(text, 'replace', count)"
      @replace-all="(text, count) => replaceWithUndo(text, 'replace-all', count)"
      @undo="undoLastEdit()"
    />

    <!-- 文稿区视图态切换（编辑 / 分栏 / 预览） -->
    <div
      v-if="mode === 'manuscript'"
      class="editor-view-switch"
      role="tablist"
      aria-label="编辑模式"
    >
      <button
        type="button"
        role="tab"
        :aria-selected="viewMode === 'edit'"
        :class="{ 'is-active': viewMode === 'edit' }"
        @click="viewMode = 'edit'"
      >
        <AppIcon name="pen" :size="13" />
        编辑
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="viewMode === 'split'"
        :class="{ 'is-active': viewMode === 'split' }"
        @click="viewMode = 'split'"
      >
        <AppIcon name="panel-right" :size="13" />
        分栏
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="viewMode === 'preview'"
        :class="{ 'is-active': viewMode === 'preview' }"
        @click="viewMode = 'preview'"
      >
        <AppIcon name="eye" :size="13" />
        预览
      </button>
    </div>

    <ChapterReference />
    <div
      class="editor-document"
      :style="editorLayoutStyle"
      :class="[documentClasses, `editor-document--${viewMode}`]"
    >
      <!-- 没打开文稿就不挂「md」格式徽标与标题框：没有文件时这句格式说明是摆设，
           悬空的胶囊看起来还像一枚没画出来的图标（2026-10-05 用户反馈）。title 同源：有标题才显示这一行。 -->
      <template v-if="mode !== 'dossier' && title">
        <div class="document-meta-row">
          <!-- 「Markdown 格式」用 file 字形说，不再用「md」两个字——这个带边框的小方块
               和上面的格式钮外形一模一样，装着文字会被当成一枚没画出来的图标（2026-10-05 用户反馈）。 -->
          <span class="document-format" title="Markdown 格式" aria-label="Markdown 格式">
            <AppIcon name="file" :size="12" />
          </span>
          <span v-if="mode === 'browse'" class="readonly-badge">浏览中，不影响文稿</span>
        </div>
        <input
          class="document-title-input"
          :value="title"
          :readonly="activeTabId === null"
          aria-label="文档标题（回车或移开焦点即保存）"
          title="点这里可以改标题（只改 frontmatter，不动文件名）"
          @keydown="onTitleKeydown"
          @blur="commitTitle($event)"
        />
      </template>

      <BookDossier v-if="mode === 'dossier'" :summary="dossier" :groups="dossierGroups" />

      <!-- 编辑区：edit 或 split 模式。
           读盘在途时摆骨架而不是正文：`activeDocTab` 先换、`draft` 后换，
           那一瞬摆旧正文等于「新标题配旧稿」，用户一打字就把上一篇写进了这一篇
           （判定在 utils/editor-readout，行为在 useBookStore.doc-loading.test.ts）。 -->
      <div
        v-if="
          mode === 'manuscript' &&
          bodyState !== 'empty' &&
          (viewMode === 'edit' || viewMode === 'split')
        "
        class="editor-pane-left"
      >
        <div v-if="bodyState === 'loading'" class="editor-skeleton" aria-busy="true">
          <p class="editor-skeleton-label">{{ loadingLabel }}</p>
          <span v-for="n in SKELETON_LINES" :key="n" class="editor-skeleton-line" />
        </div>
        <div v-else class="editor-textarea-wrap">
          <!-- eslint-disable vue/no-v-html -- 高亮 mirror（P2-13：只在面板开着时挂，关面板连 DOM 都不在）：
               与 textarea 同尺寸、同字体/同 padding，behind textarea 渲染文字 + <mark> 高亮。
               放行理由：highlightMirrorHtml 每一段正文都过 escapeHtml（真身在 @mochen/fs-store/export-shared，
               普查由 utils/html-escape-single.test.ts 钉），<mark> 是我们自己拼的常量标签。 -->
          <div
            v-if="findVisible"
            ref="highlightMirrorEl"
            class="find-replace-mirror"
            aria-hidden="true"
            v-html="highlightMirrorHtml"
          />
          <!-- eslint-enable vue/no-v-html -->
          <textarea
            ref="editorEl"
            class="document-editor transient-scrollbar"
            :class="{ 'document-editor--with-find': findVisible }"
            :value="book.draft"
            :readonly="!book.activeDocTab"
            :spellcheck="editorSpellcheck"
            aria-label="文本内容编辑器"
            @input="onContentInput"
            @keydown="onEditorKeydown"
            @scroll="onEditorScroll"
          />
          <SelectionRewriteBar :editor="editorEl" />
        </div>
      </div>

      <!-- eslint-disable vue/no-v-html -- 预览区：preview 或 split 模式。
           放行理由：previewHtml 来自 markdownToSimpleHtml，它先整体 escapeHtml 源文再套 markdown 规则，
           裸标签进不来；回归线见 packages/fs-store/test/export-service-markdown.test.ts。 -->
      <div
        v-if="
          mode === 'manuscript' &&
          bodyState !== 'empty' &&
          (viewMode === 'preview' || viewMode === 'split')
        "
        ref="previewPaneEl"
        class="editor-pane-right markdown-body transient-scrollbar"
        v-html="previewHtml"
      />
      <!-- eslint-enable vue/no-v-html -->

      <!-- 空态：没打开文稿时这一格是空的，但要说清「去哪点」，
           而不是摆一个空输入框让人以为是自己写空了。 -->
      <p v-if="mode === 'manuscript' && bodyState === 'empty'" class="editor-empty">
        {{ EDITOR_EMPTY_HINT }}
      </p>

      <!-- 浏览态（只做文本展示，无编辑/预览切换） -->
      <article v-if="mode === 'browse'" class="document-preview transient-scrollbar">
        <p v-if="!browseDoc" class="document-preview-empty">
          在左栏点人物、剧情、大纲或素材即可在此浏览，当前文稿与标签不受影响。
        </p>
        <p
          v-else
          class="document-preview-empty"
          :class="{ 'is-browse-failed': browseView.state === 'failed' }"
        >
          {{ browseView.text }}
        </p>
      </article>
    </div>

    <footer class="editor-footer">
      <EditorFooterMeta
        :mode="mode"
        :character-count="characterCount"
        :reading-time="readingTimeLabel"
        :active-doc="activeDoc"
        :state-text="saveStateText"
      />
      <button
        class="save-button"
        type="button"
        :disabled="mode !== 'manuscript' || !book.activeDocTab || book.saving || !book.dirty"
        @click="book.saveActive()"
      >
        <AppIcon name="save" :size="14" />
        {{ book.saving ? "保存中…" : "保存" }}
      </button>
    </footer>
  </aside>
</template>
