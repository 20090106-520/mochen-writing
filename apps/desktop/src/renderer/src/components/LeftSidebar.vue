<!-- 左栏：结构、类名与 transient 滚动条用法取自 deepwrite的 LeftSidebar.vue / TreeSection.vue / TreeNodeItem.vue
     2026-10-04 演示图裁定：功能导航分组化（完整按图 + 诚实占位）——
     导航表与占位判定的唯一真身在 utils/side-nav.ts；文稿树（五类分组）整体住在「我的作品」组内。 -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { BookKind } from "@mochen/contracts";
import { Ellipsis, X } from "lucide";
import { MorphIcon } from "morphicons/vue";
import AppIcon from "./AppIcon.vue";
import ChapterDriftBadge from "./ChapterDriftBadge.vue";
import brandMark from "../assets/brand/mochen-lockup.jpg";
import { createTransientScrollbarController } from "../utils/transientScrollbar";
import { createChapterDrag } from "../utils/chapter-drag";
import { loadReducedMotion, motionPreferenceStorage } from "../utils/motion-preference";
import { shortenRootPath } from "../utils/book-path";
import { manuscriptSections } from "../utils/manuscript-sections";
import { newDocButtonTitle, newDocPlan, nextChapterTitle } from "../utils/new-doc";
import { statsRowsOf } from "../utils/stats-rows";
import { textRowKeydown } from "../utils/text-row-keydown";
import {
  BRAND_TAGLINE,
  FOOTER_TAGLINE,
  SIDE_NAV_GROUPS,
  sideNavChildState,
  type SideNavChild,
  type SideNavChildState
} from "../utils/side-nav";
import { useBookStore } from "../stores/useBookStore";
import { useTimelineStore } from "../stores/useTimelineStore";
import { useMaterialStore } from "../stores/useMaterialStore";
import { useTrashStore } from "../stores/useTrashStore";
import { useBackupStore } from "../stores/useBackupStore";
import { useLayoutStore } from "../stores/layoutStore";
import SideNavNoticeDialog, { type SideNavNotice } from "./SideNavNoticeDialog.vue";
import SidebarHelpButton from "./SidebarHelpButton.vue";
import LibraryNavRows from "./LibraryNavRows.vue";
import ExtensionsNavRow from "./ExtensionsNavRow.vue";
import BookLibraryList from "./BookLibraryList.vue";
import WorkItemsPanel from "./WorkItemsPanel.vue";

const emit = defineEmits<{ collapse: [] }>();
const book = useBookStore();
const layout = useLayoutStore();
const timeline = useTimelineStore();
const material = useMaterialStore();
const trash = useTrashStore();
const backup = useBackupStore();
// 每日自动备份（2026-10-10）：换书/开书那刻调一次 daily 档——今天已备过就静默跳过
// （主进程去重），没备过才真的备。失败也静默：自动的事不打扰写作，手动按钮里再看理由。
watch(
  () => book.rootPath,
  (root) => {
    if (root !== null) void backup.ensureDaily();
  },
  { immediate: true }
);
// 减少动效档（外观页）：本组件随设置视图互斥挂载，回来重挂即读到新档。
const reducedMotion = loadReducedMotion(motionPreferenceStorage());

// 作品库（2026-10-21）：挂载即读一次最近作品；打开/新建成功后 store 自己会再刷一次。
onMounted(() => void book.loadRecentBooks());

// 行内新建的状态先声明（sections 的放行判定要用——正在新建的空分组也要显示出来，
// 否则「这本书还没有这类文档」时树里根本没有入口去建第一篇）。
const addingKind = ref<BookKind | null>(null);
const newDocTitle = ref("");

// 哪些分组该露出来：判定住在 utils/manuscript-sections（章节组开着书就常驻——
// 空书时也得有一枚「+ 新建」给第一篇正文，首次引导第 3 步指的就是它）。
const sections = computed(() => manuscriptSections(book.docs, addingKind.value, book.hasBook));

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
  // 2026-10-23：右栏折叠时（窄窗自动收 / 用户手动收），点树行只会亮一行，正文落在看不见的那一栏里，
  // 看起来就是「点了没反应」。打开哪一篇就把右栏摆出来——与 AI 检查先展开右栏同一条约定。
  layout.setPaneCollapsed("right", false);
  if (kind === "chapter") void book.openDocTab(relPath);
  else book.browse(ref);
}

const sidebarScrollbar = createTransientScrollbarController();
function handleSidebarScroll(event: Event): void {
  const element = event.currentTarget;
  if (element instanceof HTMLElement) sidebarScrollbar.reveal(element);
}
onBeforeUnmount(() => sidebarScrollbar.dispose());

/** 「我在改哪本书、它落在哪个盘」落到「我的作品」组内（deepwrite 也把工作目录放侧栏；
 * 这里没有切书的 IPC，所以是字不是下拉）。两个字段齐了才出现：只有 rootPath 没 meta
 * 是开书瞬间的过渡态，那时宁可什么都不说。 */
const workspace = computed(() =>
  book.meta && book.rootPath ? { title: book.meta.title, rootPath: book.rootPath } : null
);

/**
 * 2026-10-23：作品库那一行已经把「当前这本 + 路径 + 正在写」摆全了，紧挨着再摆一遍书名与同一条路径，
 * 等于同一件事说两遍（真机 1000 / 1600 CSS 上都读到两个「海雾手记」上下叠着，一个能点一个不能点）。
 * 这一行只在作品库清单里**还没回填**这本时补位——刚打开目录、或清单被清空的那一瞬。
 * 判据读的是清单本身，不是「开没开书」：只要清单里有这本，它就一定是重复的那一份。
 */
const workdirFallback = computed(() => {
  const open = workspace.value;
  if (!open) return null;
  const listed = book.recentBooks.some((entry) => entry.rootPath === open.rootPath);
  return listed ? null : open;
});

// 底部齿轮这个入口：唯一真身（showSettings 是唯一路径）。2026-10-05 裁定导航区不再有「设置」行
// （理由后来修正过：设置中心改占中栏+右栏两格后左栏照常在，「整页卸载」那句已不成立；现行理由=
// 与底部齿轮重复，且设置视图的指示器是齿轮自己——它此时不在 nav-row 里，没有 is-active 互斥参与）。
function openSettingsOverlay(): void {
  layout.showSettings();
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

/**
 * 子项的响应判定（UI 层）：side-nav 纯函数打底，action 类的「就绪/引导」细分在这里
 * （它需要 book 上下文）。每一项都可点——不再有死按钮，点了必有下面四种响应之一。
 */
type SideNavChildUiState = SideNavChildState & { label: string };

/**
 * 子项的响应判定：side-nav 纯函数打底，包一层 label。
 *
 * 2026-10-23：这里原先还有一条 AI 检查专属分支（`aiCheckOf` + `needChapterState`）——
 * 「审核检查」四项已改为内置技能（`main/builtin-skills.ts`），由模型在对话框里经 `use_skill`
 * 自选载入，左栏不再有 ai-check 动作，那条分支连同它专用的 `needChapterState` 一并删除。
 * 「一篇文档都没有 = 大概率没打开作品」这条规则仍只留在 `utils/side-nav.ts` 一处。
 */
function childState(child: SideNavChild): SideNavChildUiState {
  return { ...sideNavChildState(child, book.docs), label: child.label };
}

/** 导航响应对话框的状态：null 是关着；label 是点的那一项（对话框里要报名字）。 */
const notice = ref<SideNavNotice | null>(null);

/** 「还没打开作品」引导的两个按钮都挂现成真身：打开目录=Ctrl+O 那条路，新建作品=组头「+」那条路。 */
function openWorkdir(): void {
  void book.pickAndOpen();
}

/** 「要有书才谈得上」的那一族入口的唯一闸。判据与理由（含实机证据）见 components/need-book-guard-wiring.test.ts。 */
function requireBook(label: string): boolean {
  if (book.hasBook) return false;
  notice.value = { kind: "need-book", label };
  return true;
}

/** 数据统计：数字全来自 book.docs 的扫描元数据，聚合真身在 utils/stats-rows。 */
function openStats(): void {
  if (requireBook("数据统计")) return;
  notice.value = { kind: "stats", label: "数据统计", rows: statsRowsOf(book.docs) };
}

/** 回收站 / 整书备份 / 书稿体检 / 导入 TXT 共用的入口分派：四个都要先过那道闸。 */
function openLibraryDialog(kind: "trash" | "backup" | "terms" | "import"): void {
  const label = { trash: "回收站", backup: "整书备份", terms: "书稿体检", import: "导入 TXT" }[
    kind
  ];
  if (requireBook(label)) return;
  if (kind === "import") {
    layout.openImportTxt();
    return;
  }
  notice.value = { kind, label };
}

/**
 * 树行「移入回收站」（2026-10-10）：删 = 移动不是销毁，所以**没有**确认弹窗——
 * 东西在回收站里，还原就有。失败理由住在 trash.error（响应对话框/通知那层展示）。
 */
async function trashDocRow(relPath: string): Promise<void> {
  closeActionMenu();
  await trash.trashDoc(relPath);
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

/** 中栏「写后体检」卡片的「查看全部」：真身仍是上面的 openLibraryDialog("terms")。 */
watch(
  () => layout.libraryDialogRequest,
  (kind) => {
    if (kind === null) return;
    openLibraryDialog(kind);
    layout.clearLibraryDialogRequest();
  }
);

/** 子项点击的唯一分派：四种模式各给一个真响应，planned/need-book 交给响应对话框。 */
function onChildAction(child: SideNavChild): void {
  const state = childState(child);
  // planned / need-book 的响应是同形的：一张响应对话框，报出点的那一项。
  if (state.mode === "planned" || state.mode === "need-book") {
    notice.value = { kind: state.mode, label: child.label };
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
    // 三块面板的真身都住在右栏 DocumentPane，而它只在**对话视图且右栏展开**时挂载。
    // 人在技能库 / 皮肤广场 / 设置时点这些入口，开关置真也没有宿主 ⇒ 先回对话视图，
    // 否则就是「点了没反应」（2026-11-09 用户裁定「有些功能不能使用」的真因）。
    layout.showWorkspace();
    // 素材库（2026-10-23）：有真面板了——锚点那枚按钮同样在右栏头部，先展右栏再开面板。
    if (child.reality.action === "materials-panel") {
      revealAgentPanel();
      material.toggle();
      return;
    }
    // 伏笔台账 / 时间线核对：没书时右栏整格不挂载，置开关只会留下一个等不到锚点的真值。
    // 先过「要有书」那道闸（弹引导对话框，两个 CTA 都是真入口），点了必有可见响应。
    if (requireBook(child.label)) return;
    // 锚点那枚按钮住在右栏头部，所以先把右栏展开再开台账——
    // 与 AI 检查三项共用 revealAgentPanel 那个真身，不另写一份「展开某栏」。
    revealAgentPanel();
    if (child.reality.action === "foreshadow-ledger") {
      book.foreshadowsOpen = true;
      void book.loadForeshadows();
      return;
    }
    // 时间线核对（2026-10-05 批次 5-①）：同款——共用上面那一次展右栏，再走 store 的 toggle。
    // 【判据留着，别再收成 fallthrough】action 联合目前是三档，删掉这层判断确实也能走对，
    // 但将来加第四档时它会**静默**把时间线也打开；而 `timeline-check-wiring.test.ts`
    // 钉的正是「左栏这一项走同一个 toggle」这条接线。展开可以共用，分派必须点名。
    if (child.reality.action === "timeline-ledger") {
      void timeline.toggle();
    }
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
  // 章节预填「第 N 章」（编号从既有章节往下数，可改）：编号全靠手打是纯粹的抄写。
  newDocTitle.value = kind === "chapter" ? nextChapterTitle(book.docs) : "";
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
  // 新建成功后 store 会直接打开这一篇：右栏折着时同样是「新建了却看不见」，所以成了再展开。
  if (await book.createDoc(kind, title)) layout.setPaneCollapsed("right", false);
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
/** 行内输入框这一轮改的是标题（frontmatter）还是文件名（relPath 真的换）。 */
const renameMode = ref<"title" | "file">("title");

function setRenameInput(el: unknown): void {
  renameInput.value = el instanceof HTMLInputElement ? el : null;
}

async function startRenaming(relPath: string, title: string): Promise<void> {
  closeActionMenu();
  renameMode.value = "title";
  renamingPath.value = relPath;
  renameValue.value = title;
  await nextTick();
  renameInput.value?.focus();
  renameInput.value?.select();
}

/**
 * 「改文件名」（2026-11-20）：文件名真的换，`chapterOrder` / `recaps` 由主进程迁移。
 * 输入框预填**当前文件名去掉 .md**——用户改的是名字，不是再去背一遍目录规则。
 */
async function startRenamingFile(relPath: string, title: string): Promise<void> {
  await startRenaming(relPath, title);
  renameMode.value = "file";
  renameValue.value = relPath.split("/").pop()?.replace(/\.md$/i, "") ?? title;
}

// 两个行内输入框（改标题 / 新建）共用的键盘裁决：真身住在 utils/text-row-keydown
//（2026-10-10 下沉，理由与 IME 那几条规矩都记在那边），这里只各接一份 confirm/cancel。
const onRenameKeydown = textRowKeydown(() => void confirmRenaming(), cancelRenaming);
const onAddKeydown = textRowKeydown(() => void confirmAdding(), cancelAdding);

function cancelRenaming(): void {
  renamingPath.value = null;
  renameValue.value = "";
  renameMode.value = "title";
}

async function confirmRenaming(): Promise<void> {
  if (renamingPath.value === null) return;
  const relPath = renamingPath.value;
  const title = renameValue.value;
  const mode = renameMode.value;
  cancelRenaming();
  if (mode === "file") await book.renameDocFile(relPath, title);
  else await book.renameDocTitle(relPath, title);
}

// —— 章节拖拽重排（原生 HTML5 DnD，仅 chapter 分组） ——
// 状态机（五个 handler + 拖拽态 + 延迟清除定时器）住 utils/chapter-drag；这里只接线。
const chapterDrag = createChapterDrag({
  targetIndexOf: (targetNode) => {
    const chapterSection = sections.value.find((s) => s.id === "chapter");
    return chapterSection?.nodes.indexOf(targetNode) ?? -1;
  },
  moveChapter: (from, targetIndex) => {
    void book.moveChapterByRelPath(from, targetIndex);
  }
});
const { dragFromRelPath, dragOverRelPath } = chapterDrag.state;
const {
  onChapterDragStart,
  onChapterDragOver,
  onChapterDragLeave,
  onChapterDrop,
  onChapterDragEnd
} = chapterDrag;
onBeforeUnmount(() => chapterDrag.dispose());
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

        <!-- 【§174】作品工作项面板：左栏常驻的那一列，形态照 MiniMax Code 的会话列表，
             只不过上面显示的是小说的东西（对话 / 待审 / 伏笔）。
             **只在开了书的时候出现**：没书时它是空的——§168 用户评「空壳没啥用」，
             宁可没有这一格，也不要摆一个写着「暂无」的板子。 -->
        <WorkItemsPanel v-if="book.hasBook" />

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
            <!-- 作品库（2026-10-21）：先列「我打开过哪几本」（清单真身在主进程，点一行即切书，× 只移出清单），再放当前这本的文稿树。
                 2026-11-11：标题从「作品库」改成「最近打开」——外层分组已经叫「我的作品」，再挂一个同义小标题是重复层级；
                 而这份清单的实际语义就是按时间倒序的最近打开（recent-books-store），叫准名字比叫全名字有用。 -->
            <section class="sidebar-library" aria-label="最近打开">
              <span class="sidebar-library-title">最近打开</span>
              <BookLibraryList />
            </section>
            <div v-if="workdirFallback" class="sidebar-workdir">
              <strong class="workdir-book" :title="workdirFallback.title">
                {{ workdirFallback.title }}
              </strong>
              <span class="workdir-path" :title="workdirFallback.rootPath">
                工作目录：{{ shortenRootPath(workdirFallback.rootPath) }}
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
                      <ChapterDriftBadge v-if="section.id === 'chapter'" :rel-path="node.relPath" />
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
                        <button
                          class="tree-node-action-menu-item"
                          type="button"
                          role="menuitem"
                          @click="startRenamingFile(node.relPath, node.title)"
                        >
                          <AppIcon name="file" :size="14" />
                          <span>改文件名</span>
                        </button>
                        <button
                          class="tree-node-action-menu-item"
                          type="button"
                          role="menuitem"
                          @click="trashDocRow(node.relPath)"
                        >
                          <AppIcon name="trash" :size="14" />
                          <span>移入回收站</span>
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
                        @keydown="onRenameKeydown"
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
                        @keydown="onAddKeydown"
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

        <!-- 低频书务入口（存稿仪表 / 数据统计 / 回收站 / 整书备份 / 书稿体检 / 导入 TXT）：
             连同折叠壳一起住在 LibraryNavRows 里（2026-10-11）——那一组本来就归那个文件；
             响应仍在本文件：openStats 与 openLibraryDialog；存稿仪表在按钮里直接走 layout 开关，
             requireBook 由本文件递进去，闸门只有这一份。 -->
        <LibraryNavRows :require-book="requireBook" @open="openLibraryDialog" @stats="openStats" />
      </nav>
    </div>

    <!-- 底部这一格对齐 deepwrite 的 .sidebar-footer：他左格是「作者」头像 + 账号菜单，右格才是齿轮。
         我们没有账号体系 ⇒ 左格保留齿轮（用户裁定钉在左端），右列给品牌标语（演示图逐字）。
         齿轮右边那枚「?」是首次引导的入口（组件自带，见 components/SidebarHelpButton.vue）——
         引导末步说的「左栏的「?」按钮」得真在这儿，之前全仓没有这枚钮，reopen 是个死函数。 -->
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
        <SidebarHelpButton />
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
