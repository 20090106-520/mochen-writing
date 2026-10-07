<!-- 左栏：结构、类名与 transient 滚动条用法取自 deepwrite的 LeftSidebar.vue / TreeSection.vue / TreeNodeItem.vue
     2026-10-04 演示图裁定：功能导航分组化（完整按图 + 诚实占位）——
     导航表与占位判定的唯一真身在 utils/side-nav.ts；文稿树（五类分组）整体住在「我的作品」组内。 -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { BookKind, DocRef } from "@mochen/contracts";
import { Ellipsis, X } from "lucide";
import { MorphIcon } from "morphicons/vue";
import type { IconName } from "../types/icons";
import AppIcon from "./AppIcon.vue";
import brandMark from "../assets/brand/mochen-lockup.jpg";
import { createTransientScrollbarController } from "../utils/transientScrollbar";
import { loadReducedMotion, motionPreferenceStorage } from "../utils/motion-preference";
import { BOOK_KIND_LABELS, BOOK_KIND_ORDER } from "../utils/book-kinds";
import { newDocButtonTitle, newDocPlan } from "../utils/new-doc";
import {
  AI_CHECK_PROMPTS,
  BRAND_TAGLINE,
  FOOTER_TAGLINE,
  NEED_BOOK_HINT,
  SIDE_NAV_GROUPS,
  STATS_HINT,
  aiCheckOf,
  sideNavChildState,
  type SideNavChild,
  type SideNavChildState
} from "../utils/side-nav";
import { CLEAR_VIEW_SENTENCE, threadKeyFor, useAgentStore } from "../stores/useAgentStore";
import { useBookStore } from "../stores/useBookStore";
import { useTimelineStore } from "../stores/useTimelineStore";
import { useLayoutStore } from "../stores/layoutStore";
import SideNavNoticeDialog, { type SideNavNotice } from "./SideNavNoticeDialog.vue";
import ExtensionsNavRow from "./ExtensionsNavRow.vue";

const emit = defineEmits<{ collapse: [] }>();
const book = useBookStore();
const layout = useLayoutStore();
const timeline = useTimelineStore();
const agent = useAgentStore();
// 减少动效档（外观页）：本组件随设置视图互斥挂载，回来重挂即读到新档。
const reducedMotion = loadReducedMotion(motionPreferenceStorage());

// 图标是渲染资产不是业务枚举（设计决定 6）：标签/顺序来自 utils/book-kinds 唯一表，这里只留 icon。
const KIND_ICON: Record<BookKind, IconName> = {
  chapter: "book",
  outline: "list",
  character: "user",
  plot: "ledger",
  material: "library",
  worldview: "globe",
  faction: "directory",
  location: "map",
  timeline: "history",
  glossary: "library",
  volume: "archive",
  foreshadow: "pin",
  skill: "wand"
};

// 行内新建的状态先声明（sections 的放行判定要用——正在新建的空分组也要显示出来，
// 否则「这本书还没有这类文档」时树里根本没有入口去建第一篇）。
const addingKind = ref<BookKind | null>(null);
const newDocTitle = ref("");

const sections = computed(() =>
  BOOK_KIND_ORDER.map((kind) => ({
    id: kind,
    label: BOOK_KIND_LABELS[kind],
    icon: KIND_ICON[kind],
    nodes: book.docs.filter((doc) => doc.kind === kind)
  })).filter((section) => section.nodes.length > 0 || addingKind.value === section.id)
);

const collapsedSections = ref<Record<string, boolean>>({});

function toggleSection(id: string): void {
  collapsedSections.value[id] = !collapsedSections.value[id];
}

function isSelected(relPath: string): boolean {
  return book.activeDocTab === relPath || book.activeBrowse === relPath;
}

// 章节进文稿标签；其他一律只浏览——浏览不动 docTabs 与草稿（store 有测试守着）。
function activate(kind: BookKind, relPath: string): void {
  const ref = book.refOf(relPath);
  if (!ref) return;
  if (kind === "chapter") void book.openDocTab(relPath);
  else book.browse(ref);
}

const sidebarScrollbar = createTransientScrollbarController();
function handleSidebarScroll(event: Event): void {
  const element = event.currentTarget;
  if (element instanceof HTMLElement) sidebarScrollbar.reveal(element);
}
onBeforeUnmount(() => sidebarScrollbar.dispose());
onBeforeUnmount(() => {
  if (dragLeaveTimer !== null) clearTimeout(dragLeaveTimer);
});

/**
 * 「我在改哪本书、它落在哪个盘」——示意稿 B 顶栏的两条事实，落到「我的作品」组内（deepwrite 也把
 * 工作目录放侧栏，且这里没有切书的 IPC，所以是字不是下拉）。两个字段齐了才出现：
 * 只有 rootPath 没 meta 是开书瞬间的过渡态，那时宁可什么都不说。
 */
const workspace = computed(() =>
  book.meta && book.rootPath ? { title: book.meta.title, rootPath: book.rootPath } : null
);

// 底部齿轮这个入口：唯一真身（showSettings 是唯一路径）。2026-10-05 裁定导航区不再有「设置」行——
// 与底部齿轮重复。【5-㊱ 补】那句「设置中心是整页视图（App.vue v-if 切走时本组件已卸载）」
// 已经不成立了：设置中心改成占中栏 + 右栏两格（`grid-column: 2 / -1`），左栏在设置视图下**照常在**。
// 于是「导航区不摆设置行」这个裁定改由别的理由成立：与底部齿轮重复，且设置视图的指示器
// 是那颗齿轮自己（它此时不在 nav-row 里，没有 is-active 参与互斥）。
function openSettingsOverlay(): void {
  layout.showSettings();
}

// 段③：只清渲染层视图，不碰 JSONL、不碰主进程 pending —— clearThreadView 的真实边界。
// 渲染层这一份提案视图确实会随本页清空（store 会给出带条数的警告文案），动不到的只有主进程那一份。
function newThreadForActiveChapter(): void {
  agent.clearThreadView(threadKeyFor(book.activeDocTab));
}

// 「新建作品」对话框：开合真身是 layout.newBookOpen（与工作台降级区共用一个入口，不复制状态）。
function openNewBook(): void {
  layout.openNewBook();
}

// —— 功能导航（演示图形态）：分组开合 + 子项三种真身 ——

/** 「我的作品」组（树住在里面），默认展开；其余分组按表里的 defaultOpen。 */
const worksOpen = ref(true);
const openGroups = ref<Record<string, boolean>>(
  Object.fromEntries(SIDE_NAV_GROUPS.map((group) => [group.id, group.defaultOpen]))
);

function toggleGroup(id: string): void {
  openGroups.value[id] = !openGroups.value[id];
}

/** 展开右侧对话面板（不偷偷替用户收起）：消费方是审核检查动作；「AI 智能体」一级项已按裁定退役。 */
function revealAgentPanel(): void {
  layout.setPaneCollapsed("right", false);
}

const chapterEditorReady = computed(
  () => book.activeDocTab !== null || book.docs.some((doc) => doc.kind === "chapter")
);

/** 章节编辑器：打开活动章节；没有活动章节就打开第一本（都没有时按钮是禁的）。 */
function openChapterEditor(): void {
  const target = book.activeDocTab ?? book.docs.find((doc) => doc.kind === "chapter")?.relPath;
  if (target) void book.openDocTab(target);
}

/**
 * 子项的响应判定（UI 层）：side-nav 纯函数打底，action 类的「就绪/引导」细分在这里
 * （它需要 book 上下文）。每一项都可点——不再有死按钮，点了必有下面四种响应之一。
 */
type SideNavChildUiState = SideNavChildState & { label: string };

/**
 * 「去开一章 / 先建一章」这三种引导指向的是**文稿树里那一行的行内新建**。
 *
 * 【2026-10-07 批次 5-㊳ 真机量到的】一篇文档都没有时（也就是没打开作品），
 * 文稿树根本不在界面上，于是 guideToDoc → startAdding 落不到任何地方——
 * 用户点「一致性检查（去开一章）」看到的是**什么都没有**。P536I 把 28 枚钮逐个点了一遍，
 * 五枚全是这样：`new-thread` / `chapter-editor` / `ai-check-*` 三项，标题都在承诺一个引导。
 * 最坏的一类缺陷：不报错、不消失，只是「像坏了」。
 *
 * ⇒ 没打开作品时改走 `need-book`：那是对话框，两个按钮都是现成真身
 * （打开目录 = Ctrl+O 那条路，新建作品 = 组头「+」那条路），与 utils/side-nav 里
 * `sideNavChildState` 对 docs 子项的同一句规则对齐（「一篇文档都没有 = 大概率没打开作品」）。
 */
function needChapterState(label: string, hint: string): SideNavChildUiState {
  return book.docs.length === 0
    ? { mode: "need-book", hint: NEED_BOOK_HINT, label }
    : { mode: "need-doc", docKind: "chapter", hint, label };
}

function childState(child: SideNavChild): SideNavChildUiState {
  if (child.reality.kind === "action" && child.reality.action === "new-thread") {
    return book.activeDocTab === null
      ? needChapterState(`${child.label}（去开一章）`, "先打开一章再开始 AI 写作——点这里去开一章")
      : { mode: "ready", hint: CLEAR_VIEW_SENTENCE, label: child.label };
  }
  if (child.reality.kind === "action" && child.reality.action === "chapter-editor") {
    return chapterEditorReady.value
      ? { mode: "ready", hint: "在中间的编辑器里打开一章", label: child.label }
      : needChapterState(`${child.label}（先建一章）`, "先有章节才能用章节编辑器——点这里去建一章");
  }
  // AI 检查三项：检查对象是「当前打开的章节」——没开章就引导去开，同 AI 写作的口径。
  if (child.reality.kind === "action" && aiCheckOf(child.reality.action) !== null) {
    return book.activeDocTab === null
      ? needChapterState(`${child.label}（去开一章）`, "先打开一章再做检查——点这里去开一章")
      : { mode: "ready", hint: "打开对话面板并预填检查提问，确认后发送", label: child.label };
  }
  return { ...sideNavChildState(child, book.docs), label: child.label };
}

/** 导航响应对话框的状态：null 是关着；label 是点的那一项（对话框里要报名字）。 */
const notice = ref<SideNavNotice | null>(null);

/** 「还没打开作品」引导的两个按钮都挂现成真身：打开目录=Ctrl+O 那条路，新建作品=组头「+」那条路。 */
function openWorkdir(): void {
  void book.pickAndOpen();
}

/**
 * 数据统计：数字全部来自 book.docs 的扫描元数据（篇数现成、字数 DocRef.chars），
 * 这里只聚合，表格展示在响应对话框的 stats 形态。
 */
const statsRows = computed(() =>
  BOOK_KIND_ORDER.map((kind) => {
    const of = book.docs.filter((doc) => doc.kind === kind);
    return {
      label: BOOK_KIND_LABELS[kind],
      count: of.length,
      chars: of.reduce((sum, doc) => sum + (doc.chars ?? 0), 0)
    };
  })
);

function openStats(): void {
  notice.value = { kind: "stats", label: "数据统计", rows: statsRows.value };
}

/**
 * need-doc 的统一引导：展开树到该类分组；已有一篇就打开第一篇（chapter 进标签、其余浏览），
 * 一篇都没有就聚到行内新建行（sections 已放行正在新建的空分组）。
 */
function guideToDoc(kind: BookKind): void {
  collapsedSections.value[kind] = false;
  const first = book.docs.find((doc) => doc.kind === kind);
  if (first) {
    activate(kind, first.relPath);
    return;
  }
  void startAdding(kind);
}

/**
 * 中栏工作台「空卡」的引导请求（2026-10-05）：发起方是中栏，真身仍是上面这一个 guideToDoc
 * ——中栏没有树，也不该抄一份开合逻辑。消费完立刻清空，同一个请求不许被兑现第二次。
 */
watch(
  () => layout.docGroupRequest,
  (kind) => {
    if (kind === null) return;
    guideToDoc(kind);
    layout.clearDocGroupRequest();
  }
);

/** 子项点击的唯一分派：四种模式各给一个真响应，planned/need-book 交给响应对话框。 */
function onChildAction(child: SideNavChild): void {
  const state = childState(child);
  if (state.mode === "planned") {
    notice.value = { kind: "planned", label: child.label };
    return;
  }
  if (state.mode === "need-book") {
    notice.value = { kind: "need-book", label: child.label };
    return;
  }
  if (state.mode === "need-doc") {
    guideToDoc(state.docKind);
    return;
  }
  if (child.reality.kind === "docs") {
    collapsedSections.value[child.reality.docKind] = false;
    return;
  }
  if (child.reality.kind === "action") {
    // AI 检查：展开对话面板 + 预填提问（不自动发送，用户保留最后一道编辑权）。
    const check = aiCheckOf(child.reality.action);
    if (check !== null) {
      revealAgentPanel();
      agent.prefillComposer(threadKeyFor(book.activeDocTab), AI_CHECK_PROMPTS[check]);
      return;
    }
    if (child.reality.action === "new-thread") {
      newThreadForActiveChapter();
      return;
    }
    // 伏笔台账（2026-10-05）：锚点那枚按钮住在右栏头部，所以先把右栏展开再开台账——
    // 与 AI 检查三项共用 revealAgentPanel 那个真身，不另写一份「展开某栏」。
    if (child.reality.action === "foreshadow-ledger") {
      revealAgentPanel();
      book.foreshadowsOpen = true;
      void book.loadForeshadows();
      return;
    }
    // 时间线核对（2026-10-05 批次 5-①）：同款——先展右栏（锚点在那儿），再开台账并读盘。
    if (child.reality.action === "timeline-ledger") {
      revealAgentPanel();
      void timeline.toggle();
      return;
    }
    if (child.reality.action === "chapter-editor") openChapterEditor();
  }
}

/** 子项的 data-nav-id：action 沿用既有语义 id，docs 报出树分组，占位报出所属组——都可定位。 */
function navIdOf(group: { id: string }, child: SideNavChild): string {
  if (child.reality.kind === "action") return child.reality.action;
  if (child.reality.kind === "docs") return `tree-${child.reality.docKind}`;
  return `${group.id}.${child.label}`;
}

// planned 机制保留（表里暂时没有占位实例——演示图各项已全部落地）；nav-soon 徽标分支是数据驱动的。

/**
 * 行内新建：判定全在 newDocPlan（utils 唯一真身），这里只接线。
 * Enter 提交 / Esc 取消；判定不过关时提交按钮 disabled，理由就是 placeholder 旁那行提示。
 * （addingKind / newDocTitle 声明在 sections 之前——空分组的放行判定要用。）
 */
const newDocInput = ref<HTMLInputElement | null>(null);
const addingPlan = computed(() =>
  addingKind.value === null ? null : newDocPlan(addingKind.value, newDocTitle.value, book.docs)
);

/** 函数 ref：行内输入行活在 v-for 里，字符串 ref 会被 Vue 收成数组，这里钉死「只留激活那一个」。 */
function setNewDocInput(el: unknown): void {
  newDocInput.value = el instanceof HTMLInputElement ? el : null;
}

async function startAdding(kind: BookKind): Promise<void> {
  addingKind.value = kind;
  newDocTitle.value = "";
  await nextTick();
  newDocInput.value?.focus();
}

function cancelAdding(): void {
  addingKind.value = null;
  newDocTitle.value = "";
}

async function confirmAdding(): Promise<void> {
  if (addingKind.value === null || addingPlan.value?.ok !== true) return;
  const kind = addingKind.value;
  const title = newDocTitle.value;
  cancelAdding();
  await book.createDoc(kind, title);
}

/**
 * 行尾「…」操作菜单：deepwrite 树行的原位操作入口（.tree-node-action-area 全套样式是原版那份）。
 * 同一时间至多一行开着——值是 relPath，null 是全关。
 */
const actionMenuFor = ref<string | null>(null);

function toggleActionMenu(relPath: string): void {
  actionMenuFor.value = actionMenuFor.value === relPath ? null : relPath;
}

function closeActionMenu(): void {
  actionMenuFor.value = null;
}

/**
 * 行内改名：判定与落盘全在 book.renameDocTitle（读盘改 title 行走指纹链），
 * 这里只接线——Enter 提交 / Esc 取消 / blur 取消，确认钮 mousedown.prevent 防止先抢焦点。
 */
const renamingPath = ref<string | null>(null);
const renameValue = ref("");
const renameInput = ref<HTMLInputElement | null>(null);

function setRenameInput(el: unknown): void {
  renameInput.value = el instanceof HTMLInputElement ? el : null;
}

async function startRenaming(relPath: string, title: string): Promise<void> {
  closeActionMenu();
  renamingPath.value = relPath;
  renameValue.value = title;
  await nextTick();
  renameInput.value?.focus();
  renameInput.value?.select();
}

function cancelRenaming(): void {
  renamingPath.value = null;
  renameValue.value = "";
}

async function confirmRenaming(): Promise<void> {
  if (renamingPath.value === null) return;
  const relPath = renamingPath.value;
  const title = renameValue.value;
  cancelRenaming();
  await book.renameDocTitle(relPath, title);
}

// —— 章节拖拽重排（原生 HTML5 DnD，仅 chapter 分组） ——

const dragFromRelPath = ref<string | null>(null);
const dragOverRelPath = ref<string | null>(null);
let dragLeaveTimer: ReturnType<typeof setTimeout> | null = null;

function onChapterDragStart(event: DragEvent, relPath: string): void {
  dragFromRelPath.value = relPath;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", relPath);
  }
}

function onChapterDragOver(event: DragEvent, relPath: string): void {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  // 延迟清除 dragLeave 状态，避免子元素切换时闪烁
  if (dragLeaveTimer !== null) {
    clearTimeout(dragLeaveTimer);
    dragLeaveTimer = null;
  }
  dragOverRelPath.value = relPath;
}

function onChapterDragLeave(): void {
  // 微延迟：子元素切换会触发 li 的 dragleave，用定时器过滤掉
  if (dragLeaveTimer !== null) clearTimeout(dragLeaveTimer);
  dragLeaveTimer = setTimeout(() => {
    dragOverRelPath.value = null;
    dragLeaveTimer = null;
  }, 30);
}

function onChapterDrop(event: DragEvent, targetNode: DocRef): void {
  event.preventDefault();
  event.stopPropagation();
  const from = dragFromRelPath.value;
  dragFromRelPath.value = null;
  dragOverRelPath.value = null;
  if (dragLeaveTimer !== null) {
    clearTimeout(dragLeaveTimer);
    dragLeaveTimer = null;
  }
  if (!from) return;
  const chapterSection = sections.value.find((s) => s.id === "chapter");
  if (!chapterSection) return;
  const targetIndex = chapterSection.nodes.indexOf(targetNode);
  if (targetIndex === -1) return;
  book.moveChapterByRelPath(from, targetIndex);
}

function onChapterDragEnd(): void {
  dragFromRelPath.value = null;
  dragOverRelPath.value = null;
  if (dragLeaveTimer !== null) {
    clearTimeout(dragLeaveTimer);
    dragLeaveTimer = null;
  }
}
</script>

<template>
  <aside class="left-sidebar" aria-label="墨宸 AI 导航与文稿树">
    <header class="sidebar-brand-row">
      <span class="brand-button">
        <span class="brand-mark"><img :src="brandMark" alt="" width="27" height="27" /></span>
        <span class="brand-copy">
          <span class="brand-name">墨宸 AI</span>
          <span class="brand-tagline">{{ BRAND_TAGLINE }}</span>
        </span>
      </span>
      <button class="icon-button" type="button" aria-label="收起左侧栏" @click="emit('collapse')">
        <AppIcon name="panel-left" :size="18" />
      </button>
    </header>

    <div class="sidebar-scroll transient-scrollbar" @scroll.passive="handleSidebarScroll">
      <nav class="primary-nav side-nav" aria-label="主操作">
        <button
          class="nav-row"
          :class="{
            'is-active': layout.currentView === 'workspace' && layout.centerView === 'chat'
          }"
          type="button"
          data-nav-id="workspace"
          @click="layout.showWorkspace()"
        >
          <AppIcon name="house" :size="17" />
          <span>工作台</span>
        </button>

        <!-- 「我的作品」：文稿树整体住这组里。组头右侧「+」是新建作品的真身入口。 -->
        <section class="nav-group" :class="{ 'is-collapsed': !worksOpen }">
          <div class="nav-group-head">
            <button
              class="nav-row nav-group-toggle"
              type="button"
              data-nav-id="works"
              :aria-expanded="worksOpen"
              @click="worksOpen = !worksOpen"
            >
              <AppIcon name="book" :size="17" />
              <span>我的作品</span>
              <AppIcon class="nav-group-chevron" name="chevron" :size="13" />
            </button>
            <button
              class="section-add"
              type="button"
              data-nav-id="new-book"
              aria-label="新建作品"
              title="新建作品"
              @click.stop="openNewBook"
            >
              <AppIcon name="plus" :size="13" />
            </button>
          </div>
          <div v-if="worksOpen" class="nav-group-body">
            <div v-if="workspace" class="sidebar-workdir">
              <strong class="workdir-book" :title="workspace.title">
                {{ workspace.title }}
              </strong>
              <span class="workdir-path" :title="workspace.rootPath">
                工作目录：{{ workspace.rootPath }}
              </span>
            </div>
            <div class="resource-list">
              <section
                v-for="section in sections"
                :key="section.id"
                class="resource-section"
                :class="{ 'is-collapsed': collapsedSections[section.id] }"
              >
                <div class="resource-section-heading">
                  <button
                    class="section-toggle"
                    type="button"
                    :aria-expanded="!collapsedSections[section.id]"
                    :aria-label="
                      collapsedSections[section.id]
                        ? `展开${section.label}`
                        : `折叠${section.label}`
                    "
                    @click="toggleSection(section.id)"
                  >
                    <AppIcon :name="section.icon" :size="15" />
                    <span>{{ section.label }}</span>
                    <AppIcon class="section-toggle-chevron" name="chevron" :size="13" />
                  </button>
                  <!-- 分组「+」：点开展开行内新建行；判定与文案都在 utils/new-doc，这里不养第二份。 -->
                  <button
                    class="section-add"
                    type="button"
                    :aria-label="newDocButtonTitle(section.label)"
                    :title="newDocButtonTitle(section.label)"
                    @click.stop="startAdding(section.id)"
                  >
                    <AppIcon name="plus" :size="13" />
                  </button>
                </div>

                <ul
                  v-if="!collapsedSections[section.id]"
                  class="resource-tree"
                  :aria-label="`${section.label}下的内容`"
                >
                  <li
                    v-for="node in section.nodes"
                    :key="node.relPath"
                    class="tree-node"
                    @dragover="
                      section.id === 'chapter' ? onChapterDragOver($event, node.relPath) : undefined
                    "
                    @dragleave="section.id === 'chapter' ? onChapterDragLeave() : undefined"
                    @drop="section.id === 'chapter' ? onChapterDrop($event, node) : undefined"
                  >
                    <button
                      class="tree-row has-node-action"
                      :class="{
                        'is-selected': isSelected(node.relPath),
                        'is-drag-over':
                          section.id === 'chapter' && dragOverRelPath === node.relPath,
                        dragging: section.id === 'chapter' && dragFromRelPath === node.relPath
                      }"
                      :style="{ '--tree-depth': 0 }"
                      type="button"
                      :data-resource-id="node.relPath"
                      :title="node.title"
                      @click="activate(section.id, node.relPath)"
                    >
                      <!-- 章节拖动手柄（仅 chapter 分组显示） -->
                      <span
                        v-if="section.id === 'chapter'"
                        class="tree-drag-handle"
                        title="拖动排序"
                        draggable="true"
                        @dragstart.stop="onChapterDragStart($event, node.relPath)"
                        @dragend="onChapterDragEnd"
                        >⠿</span
                      >
                      <AppIcon :name="section.icon" :size="15" />
                      <span class="tree-label">{{ node.title }}</span>
                    </button>
                    <!-- 行尾「…」：菜单与显形规则都是 deepwrite 原版那份（.tree-node-action-area）。 -->
                    <div class="tree-node-action-area">
                      <button
                        class="tree-node-action"
                        :class="{ 'is-menu-open': actionMenuFor === node.relPath }"
                        type="button"
                        :aria-label="`「${node.title}」的操作菜单`"
                        :aria-expanded="actionMenuFor === node.relPath"
                        @keydown.esc.prevent="closeActionMenu"
                        @click.stop="toggleActionMenu(node.relPath)"
                      >
                        <!-- morphicons 变形时刻：菜单开 = 省略号变 ×（与开合判定同一份 actionMenuFor）。
                             stroke-width 对齐全仓 1.8 描边语言（morphicons 默认 2，不传就比别的图标粗一档）。 -->
                        <MorphIcon
                          :icon="actionMenuFor === node.relPath ? X : Ellipsis"
                          :size="15"
                          :stroke-width="1.8"
                          :reduced-motion="reducedMotion ? 'always' : 'user'"
                        />
                      </button>
                      <div
                        v-if="actionMenuFor === node.relPath"
                        class="tree-node-action-menu"
                        role="menu"
                      >
                        <button
                          class="tree-node-action-menu-item"
                          type="button"
                          role="menuitem"
                          @click="startRenaming(node.relPath, node.title)"
                        >
                          <AppIcon name="edit" :size="14" />
                          <span>改标题</span>
                        </button>
                      </div>
                    </div>
                    <div v-if="renamingPath === node.relPath" class="tree-add-row">
                      <input
                        :ref="setRenameInput"
                        v-model="renameValue"
                        class="tree-add-input"
                        type="text"
                        aria-label="改标题"
                        @keydown.enter.prevent="confirmRenaming"
                        @keydown.esc.prevent="cancelRenaming"
                        @blur="cancelRenaming"
                      />
                      <button
                        class="tree-add-confirm"
                        type="button"
                        aria-label="确认改标题"
                        :disabled="renameValue.trim() === ''"
                        @mousedown.prevent
                        @click="confirmRenaming"
                      >
                        <AppIcon name="check" :size="13" />
                      </button>
                    </div>
                  </li>
                  <li v-if="addingKind === section.id" class="tree-node">
                    <div class="tree-add-row">
                      <input
                        :ref="setNewDocInput"
                        v-model="newDocTitle"
                        class="tree-add-input"
                        type="text"
                        :placeholder="`新${section.label}的名字`"
                        :aria-label="`新${section.label}的名字`"
                        @keydown.enter.prevent="confirmAdding"
                        @keydown.esc.prevent="cancelAdding"
                        @blur="cancelAdding"
                      />
                      <button
                        class="tree-add-confirm"
                        type="button"
                        aria-label="确认新建"
                        :disabled="addingPlan?.ok !== true"
                        @mousedown.prevent
                        @click="confirmAdding"
                      >
                        <AppIcon name="check" :size="13" />
                      </button>
                    </div>
                    <p v-if="addingPlan && addingPlan.ok === false" class="tree-add-error">
                      {{ addingPlan.message }}
                    </p>
                  </li>
                </ul>
              </section>
            </div>
          </div>
        </section>

        <section
          v-for="group in SIDE_NAV_GROUPS"
          :key="group.id"
          class="nav-group"
          :class="{ 'is-collapsed': !openGroups[group.id] }"
        >
          <div class="nav-group-head">
            <button
              class="nav-row nav-group-toggle"
              type="button"
              :data-nav-id="group.id"
              :aria-expanded="openGroups[group.id]"
              @click="toggleGroup(group.id)"
            >
              <AppIcon :name="group.icon" :size="17" />
              <span>{{ group.label }}</span>
              <AppIcon class="nav-group-chevron" name="chevron" :size="13" />
            </button>
          </div>
          <div v-if="openGroups[group.id]" class="nav-group-body">
            <button
              v-for="child in group.children"
              :key="child.label"
              class="nav-subrow"
              :class="{ 'is-planned': child.reality.kind === 'planned' }"
              type="button"
              :data-nav-id="navIdOf(group, child)"
              :title="childState(child).hint"
              @click="onChildAction(child)"
            >
              <AppIcon class="nav-subrow-chevron" name="chevron" :size="11" />
              <span>{{ childState(child).label }}</span>
              <span v-if="child.reality.kind === 'planned'" class="nav-soon">规划中</span>
            </button>
          </div>
        </section>

        <!-- 「技能库」与「插件」两枚入口（spec §11 + 批次 5-㉚/5-㉛/5-㉜）：两者都是「装在应用里的东西」，
             都不进文稿树，各自占一行而不是挂在某个 BookKind 下面。
             5-㉜ 按用户指正，它们换的是**中栏那一格**（左栏是恒定的导航，不该消失），
             于是「工作台」那枚的 active 判定要连带改：工作台亮 = 中栏在对话。
             顺带一处顺序变化：原本是 技能库 / 数据统计 / 插件，现在是 技能库 / 插件 / 数据统计，
             好让相邻的两枚都通向中栏。
             打开它只列与只读渲染，不挂入任何技能——挂入只有技能卡上那颗按钮。 -->
        <ExtensionsNavRow />

        <button
          class="nav-row"
          type="button"
          data-nav-id="stats"
          :title="STATS_HINT"
          @click="openStats"
        >
          <AppIcon name="chart" :size="17" />
          <span>数据统计</span>
        </button>
      </nav>
    </div>

    <!-- 底部这一格对齐 deepwrite 的 .sidebar-footer：他左格是「作者」头像 + 账号菜单，右格才是齿轮。
         我们没有账号体系 ⇒ 左格保留齿轮（用户裁定钉在左端），右列给品牌标语（演示图逐字）。 -->
    <footer class="sidebar-footer">
      <div class="account-controls">
        <button
          class="icon-button account-settings-button"
          type="button"
          aria-label="打开设置"
          title="设置"
          @click="openSettingsOverlay"
        >
          <AppIcon name="settings" :size="16" />
        </button>
        <span class="footer-tagline">{{ FOOTER_TAGLINE }}</span>
      </div>
    </footer>

    <!-- 导航响应对话框：占位说明 / 未开作品引导。开合真身是 notice（本组件持有），两按钮各挂现成真身。 -->
    <SideNavNoticeDialog
      :notice="notice"
      @close="notice = null"
      @open-workdir="openWorkdir"
      @new-book="openNewBook"
    />
  </aside>
</template>
