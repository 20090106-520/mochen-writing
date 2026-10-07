<!-- 三栏壳：DOM 结构与类名取自 deepwrite的 WorkspaceShell.vue
     docs/ATTRIBUTION.md -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import type { AppearanceColorScheme } from "@mochen/contracts";
import LeftSidebar from "./components/LeftSidebar.vue";
import CenterColumn from "./components/CenterColumn.vue";
import DocumentPane from "./components/DocumentPane.vue";
import SaveConflictDialog from "./components/SaveConflictDialog.vue";
import NewBookDialog from "./components/NewBookDialog.vue";
import SettingsPage from "./components/SettingsPage.vue";
import ExtensionsPage from "./components/ExtensionsPage.vue";
import SkinGalleryPage from "./components/SkinGalleryPage.vue";
import { applyAppearanceThemeToDocument } from "./composables/appearanceThemeRuntime";
import { useGlobalHotkeys } from "./composables/useHotkeys";
import type { PanelShortcutId } from "./utils/hotkeys";
import { useAppearanceStore } from "./stores/useAppearanceStore";
import { useBookStore } from "./stores/useBookStore";
import { useReferenceMenuStore } from "./stores/useReferenceMenuStore";
import { resolveColorScheme } from "./utils/appearance-scheme";
import {
  applyReducedMotion,
  loadReducedMotion,
  motionPreferenceStorage
} from "./utils/motion-preference";
import { LEFT_PANE_MAX, LEFT_PANE_MIN, RIGHT_PANE_MIN, useLayoutStore } from "./stores/layoutStore";
import SearchPanel from "./components/SearchPanel.vue";
import NotesPanel from "./components/NotesPanel.vue";
import WordCountPanel from "./components/WordCountPanel.vue";
import ExportDialog from "./components/ExportDialog.vue";
import PromptTemplatePanel from "./components/PromptTemplatePanel.vue";
import OutlinePanel from "./components/OutlinePanel.vue";
import NotificationToast from "./components/NotificationToast.vue";
import OnboardingGuide from "./components/OnboardingGuide.vue";
import WritingGoalPanel from "./components/WritingGoalPanel.vue";
import StoryBiblePanel from "./components/StoryBiblePanel.vue";
import { useWritingGoalStore } from "./stores/useWritingGoalStore";
import { threadKeyFor, useAgentStore } from "./stores/useAgentStore";

const layout = useLayoutStore();
const appearance = useAppearanceStore();
const book = useBookStore();
const referenceMenu = useReferenceMenuStore();
const { settings } = storeToRefs(appearance);
const {
  currentView,
  centerView,
  desktopShell,
  shellClasses,
  shellStyle,
  leftCollapsed,
  rightCollapsed,
  leftPaneWidth,
  rightPaneWidth,
  newBookOpen
} = storeToRefs(layout);

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolvedScheme(): AppearanceColorScheme {
  return resolveColorScheme(settings.value.mode, prefersDark());
}

function applyTheme(): void {
  const scheme = resolvedScheme();
  applyAppearanceThemeToDocument({
    scheme,
    theme: settings.value[scheme],
    uiFontFamily: settings.value.uiFontFamily,
    editorFontFamily: settings.value.editorFontFamily
  });
}

const rightPaneMax = computed(() => layout.writingRightPaneViewModel.maxWidth);

// 全局 keydown 的唯一监听（裁定 G5）住在这里——设置中心整页化后 CenterColumn 会被卸载，
// 监听若还挂在那里，设置页里 Ctrl+, 与 Esc 全数失灵。上移到 App = 装配位置变化，不是第二处监听。
// 两条「有落点才生效」的判定也在这里（装配层），因为落点这个事实的真身全在这份模板与 store 上：
// `/` 的行内引用菜单挂在 CenterColumn 的输入卡里，`Ctrl+F` 的面板挂在 DocumentPane 里——
// 落点没了就会出现「推了一个看不见的标记」，而它会先吃掉一次 Esc。详见下面两句判据。
useGlobalHotkeys({
  openPalette: () => {
    if (centerChatIsMounted()) referenceMenu.summon("/");
  },
  panelShortcut,
  // 与 openPalette 读的是同一个函数、同一件事：这里不存在第二份判据。
  referenceMenuHasLanding: centerChatIsMounted,
  findReplaceHasLanding
});

/**
 * 中栏那一格（CenterColumn）在渲染中吗——`/` 的行内引用菜单就挂在它的输入卡里。
 * 判据与本文件模板里 `<CenterColumn v-if="centerView === 'chat'">` 是同一件事，
 * 外加 `<SettingsPage v-if="currentView === 'settings'">` 那条（它是 `v-else` 的对家，
 * currentView 一变整块换掉）。这里只把上面几处的裁决读成一句话，不复写任何条件。
 */
function centerChatIsMounted(): boolean {
  return currentView.value === "workspace" && centerView.value === "chat";
}

/**
 * `Ctrl+F` 有没有落点（批次 5-㊴）。逐条对应 FindReplacePanel 的 v-if，不多不少：
 *   宿主渲染 —— 本文件模板里的 `v-if="!rightCollapsed && centerView === 'chat'"`，
 *                外加上面那个 centerChatIsMounted（设置整页与中栏那一格）；
 *   面板渲染 —— DocumentPane 里的 `mode === 'manuscript'`（右栏在浏览/资料模式下就没有它）。
 * 【这里只把上面两处的裁决读成一句话，不复写任何条件】把这两条抄进 useHotkeys 就是第二次实现，
 * 而第二次实现正是本缺陷的成因：落点没了，`findReplace.visible` 却还成立，于是吃掉一次 Esc。
 */
function findReplaceHasLanding(): boolean {
  return centerChatIsMounted() && !rightCollapsed.value && book.rightPaneMode === "manuscript";
}

// 新面板可见态
const searchOpen = ref(false);
const notesOpen = ref(false);
const tplPanelOpen = ref(false);
const bibleOpen = ref(false);
const outlineOpen = ref(false);
// 2026-10-07：中栏头部那枚「0% 写作目标环」按用户裁定退役（见 CenterColumn 的 emit 注释），
// 目标面板本体与这一个开关都留着——**它仍有真写者**：`panelShortcut("goals")`（Ctrl+Shift+G）。
// 记这一笔是因为「面板只能从那枚环点开」的假设一旦留在注释里，下一个人会顺手把这个 ref 也删掉。
const goalPanelOpen = ref(false);

// 导出与字数面板**不在这儿再持一份**（铁律 6）：layoutStore 里早有
// `panelVisibility.export` / `panelVisibility.wordCount` 与 `openExport()` / `openWordCount()`，
// 但 App 当年另挂了两个从不被置 true 的本地 ref —— 两份状态、零个写者：
// 导出对话框从来没打开过（2026-10-05 批次 5-② 真机撞出来），字数面板至今仍然够不着。
// 现在只认 store 那一份，入口都在右栏头部。
//
// 注意 `notesOpen` / `searchOpen` / `tplPanelOpen` **不是**同一类：
// 那三枚在 `panelShortcut` 里各有 case，靠键盘快捷键开合，写者是真实存在的。

let schemeQuery: MediaQueryList | null = null;
let unwatchSettings: (() => void) | null = null;

// Ctrl+Shift+F/N/T/O/G/B/P 与 Ctrl+Alt+F 面板快捷键的**落点**。
// 判定（哪个键对应哪一枚面板）已搬进 utils/hotkeys.ts 的 resolveHotkey——
// 搬之前它们是这里另挂的第二个 keydown 监听，既不在设置页「快捷键」里查得到，
// 也破了「全局 keydown 有且只有一处」的裁定 G5。现在这里只回答「这一枚是开还是翻转」。
function panelShortcut(id: PanelShortcutId): void {
  switch (id) {
    case "search":
      searchOpen.value = !searchOpen.value;
      return;
    case "notes":
      notesOpen.value = !notesOpen.value;
      return;
    case "templates":
      tplPanelOpen.value = true; // 模板面板是「打开」不是「翻转」
      return;
    case "outline":
      outlineOpen.value = !outlineOpen.value;
      return;
    case "goals":
      goalPanelOpen.value = !goalPanelOpen.value;
      return;
    case "story-bible":
      bibleOpen.value = !bibleOpen.value;
      return;
    case "editor-view":
      book.cycleEditorViewMode();
      return;
    default: {
      const unhandled: never = id; // 与 dispatch 的穷尽性守卫同律：加 PanelShortcutId 没接线 ⇒ 编译失败，不是静默死键。
      return unhandled;
    }
  }
}

onMounted(() => {
  applyTheme();
  // 减少动效（外观页那档偏好）：挂载即把档位落到 <html>，motion.css 据此决定动效层是否退场。
  applyReducedMotion(document.documentElement, loadReducedMotion(motionPreferenceStorage()));
  schemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  schemeQuery.addEventListener("change", applyTheme);
  window.addEventListener("resize", layout.reconcilePaneWidths);
  // 盘上设置回来后再刷一遍；此后每次设置改动（store 内 update 成功落 state）即时生效。
  void appearance.load().then(applyTheme);
  unwatchSettings = watch(settings, applyTheme, { deep: true });
});

onBeforeUnmount(() => {
  schemeQuery?.removeEventListener("change", applyTheme);
  window.removeEventListener("resize", layout.reconcilePaneWidths);
  unwatchSettings?.();
});

const agent = useAgentStore();

// ---- 写作目标：监听保存完成事件以累计字数 ----
const goalStore = useWritingGoalStore();
let lastSavedContent = "";

// 重置 lastSavedContent 当切换文档时
watch(
  () => book.activeDocTab,
  () => {
    lastSavedContent = "";
  }
);

// 监听 book.saving：从 true 变 false 表示保存完成
watch(
  () => book.saving,
  (saving, wasSaving) => {
    if (wasSaving && !saving && book.activeDocTab) {
      // 保存刚完成
      const currentContent = book.draft;
      goalStore.recordWriting(book.activeDocTab, currentContent, lastSavedContent);
      lastSavedContent = currentContent;
    }
  }
);

function onTemplateApply(text: string): void {
  agent.prefillComposer(threadKeyFor(book.activeDocTab), text);
}
</script>

<template>
  <div
    ref="desktopShell"
    class="desktop-shell"
    :class="shellClasses"
    :style="shellStyle"
    data-testid="desktop-shell"
  >
    <!-- 左栏是恒定的导航轴，**任何视图下都在**（批次 5-㊱ 改）。
         它此前排在 `<template v-else>` 里面，于是设置视图把整个壳换掉、左栏整个不在 DOM 里——
         与下面那段注释里同一句裁定（「左栏是恒定的导航，任何时候都在」）自相矛盾：
         5-㊜ 把插件与技能退回中栏，唯独设置还留在整页，而整页 `v-if` 在 `v-else` **之前**，
         左栏恰恰就在 `v-else` 里面。设置中心于是与它自己的理由相违。
         改法不是把左栏也搬成整页，而是**让设置页自己让出第一列**：
         设置 / 插件·技能 / 皮肤广场三个内容页都占 `2 / -1`（中栏 + 右栏两格），左栏那一列谁也不许吃。
         与 extensions.css / skin-gallery.css 里那两段同款（含 `grid-row: 1` 为什么不是可选的那条量测记录）。 -->

    <LeftSidebar v-if="!leftCollapsed" @collapse="layout.togglePane('left')" />

    <!-- 左栏宽度的拖拽条跟着左栏一起在：设置视图下左栏也在，这条是 shell 的绝对定位元素
         （left: var(--left-pane-width)），与兄弟节点的书写顺序无关，搬出来不会跑位。 -->
    <div
      v-if="!leftCollapsed"
      class="pane-resizer pane-resizer-left"
      role="separator"
      aria-label="调整左侧栏宽度"
      aria-orientation="vertical"
      :aria-valuemin="LEFT_PANE_MIN"
      :aria-valuemax="LEFT_PANE_MAX"
      :aria-valuenow="leftPaneWidth"
      tabindex="0"
      @pointerdown="layout.startPaneResize('left', $event)"
      @keydown="layout.handleResizeKeydown('left', $event)"
    />

    <!-- 设置中心（5-㊱ 从「整页」改来）：占中栏 + 右栏两格，落点与插件/技能、皮肤广场同一款。 -->
    <SettingsPage v-if="currentView === 'settings'" />

    <template v-else>
      <!-- 中栏那一格：**四页互斥**——对话 / 技能·插件 / 皮肤广场。
           【5-㊵ 修掉的真缺陷】这里原来写的是 `v-if="centerView !== 'skins'"`，
           那让 ExtensionsPage 在**对话那条路上也渲染**：
           实测 `.extensions-page` 与 `.conversation-pane` 完整重叠 664×902
           （两者都占 `grid-column: 2` + `grid-row: 1` 那一格）。
           画面上看不出来——对话那格后画、盖在它上面——但插件页整页活在 DOM 里：
           它那套网格与滚动容器占着位置、监听器照跑、而且它会吃到点击。
           症状落在别处（用户说「插件里面的东西卡到工作台里了」），
           根因在这一行 ⇒ 与已记的「现象在 A 处、根因在 B 处」同族。

           【为什么这里可以用 v-else-if 链，而上一版警告过不能串】
           上一版警告的是「让『谁盖谁』变成书写顺序决定的」——
           那说的是**几页各有自己的条件、互不相干**。
           这里三个条件读的是**同一个 centerView、且穷尽它的取值**，
           互斥由构造保证，与书写顺序无关。 -->
      <CenterColumn
        v-if="centerView === 'chat'"
        :left-collapsed="leftCollapsed"
        :right-collapsed="rightCollapsed"
        @toggle-left="layout.togglePane('left')"
        @toggle-right="layout.togglePane('right')"
      />
      <ExtensionsPage v-else-if="centerView === 'skills' || centerView === 'plugins'" />
      <!-- 皮肤广场（5-㊴）：与插件/技能同款落点——中栏 + 右栏一整个页面，左栏恒定。 -->
      <SkinGalleryPage v-else-if="centerView === 'skins'" />

      <!-- 右栏只在**对话与编辑器**这条路上在（5-㉝ 用户在截图上框住这一片：
           「这一片技能库和插件库，应该是不会有这个的」）。
           那一片（文稿 / 浏览 / 作品资料）是编辑器的配套设施，技能库与插件跟它没关系；
           让它在那儿等于给一个不相干的内容页配了一条不相干的分栏，
           画面上就成了「两个页面」并排 —— 而用户要的是一整个页面。 -->
      <DocumentPane
        v-if="!rightCollapsed && centerView === 'chat'"
        @collapse="layout.togglePane('right')"
      />

      <!-- 左栏那条拖拽条已经搬到这个 template 外面（它跟着左栏走，设置视图下也要在）。
           旧的那一份同批删掉：留着就是两枚 aria-label 一样的 separator，
           读屏会报出两条一模一样的分隔条，而 `elementFromPoint` 只能量到后画的那一枚。 -->

      <div
        v-if="!rightCollapsed && centerView === 'chat'"
        class="pane-resizer pane-resizer-right"
        role="separator"
        aria-label="调整右侧内容栏宽度"
        aria-orientation="vertical"
        :aria-valuemin="RIGHT_PANE_MIN"
        :aria-valuemax="rightPaneMax"
        :aria-valuenow="rightPaneWidth"
        tabindex="0"
        @pointerdown="layout.startPaneResize('right', $event)"
        @keydown="layout.handleResizeKeydown('right', $event)"
      />
    </template>

    <SaveConflictDialog />
    <NewBookDialog v-if="newBookOpen" @close="layout.closeNewBook()" />
    <SearchPanel :visible="searchOpen" @close="searchOpen = false" />
    <NotesPanel :visible="notesOpen" @close="notesOpen = false" />
    <WordCountPanel
      :visible="layout.panelVisibility.wordCount"
      @close="layout.closePanel('wordCount')"
    />
    <ExportDialog :visible="layout.panelVisibility.export" @close="layout.closePanel('export')" />
    <PromptTemplatePanel
      :visible="tplPanelOpen"
      @close="tplPanelOpen = false"
      @apply="onTemplateApply"
    />
    <OutlinePanel :visible="outlineOpen" @close="outlineOpen = false" />
    <WritingGoalPanel :visible="goalPanelOpen" @close="goalPanelOpen = false" />
    <StoryBiblePanel :visible="bibleOpen" @close="bibleOpen = false" />
    <NotificationToast />
    <OnboardingGuide v-if="layout.showOnboarding" />
  </div>
</template>
