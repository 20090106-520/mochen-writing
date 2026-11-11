<!-- 三栏壳：DOM 结构与类名取自 deepwrite的 WorkspaceShell.vue
     docs/ATTRIBUTION.md -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import type { AppearanceColorScheme } from "@mochen/contracts";
import LeftSidebar from "./components/LeftSidebar.vue";
import PaneEdgeToggle from "./components/PaneEdgeToggle.vue";
import CenterColumn from "./components/CenterColumn.vue";
import DocumentPane from "./components/DocumentPane.vue";
import SaveConflictDialog from "./components/SaveConflictDialog.vue";
import NewBookDialog from "./components/NewBookDialog.vue";
import ImportTxtDialog from "./components/ImportTxtDialog.vue";
import SettingsPage from "./components/SettingsPage.vue";
import ExtensionsPage from "./components/ExtensionsPage.vue";
import SkinGalleryPage from "./components/SkinGalleryPage.vue";
import { applyAppearanceThemeToDocument } from "./composables/appearanceThemeRuntime";
import { effectiveSettings } from "./composables/appearanceSkinPreview";
import { useGlobalHotkeys } from "./composables/useHotkeys";
import type { PanelShortcutId } from "./utils/hotkeys";
import { useAppearanceStore } from "./stores/useAppearanceStore";
import { useSkinBrowseStore } from "./stores/useSkinBrowse";
import { useBookStore } from "./stores/useBookStore";
import { useReferenceMenuStore } from "./stores/useReferenceMenuStore";
import { resolveColorScheme } from "./utils/appearance-scheme";
import {
  applyReducedMotion,
  loadReducedMotion,
  motionPreferenceStorage
} from "./utils/motion-preference";
import { RIGHT_PANE_MIN, useLayoutStore } from "./stores/layoutStore";
import {
  shouldAutoCollapseRightPaneWithoutBook,
  shouldAutoCollapseRightPaneWithoutDoc
} from "./stores/layoutStore";
import { runViewTransition } from "./utils/view-transition";
import {
  panelsToDismiss,
  type FullscreenFlags,
  type FullscreenPanelKey
} from "./utils/fullscreen-panel-exclusivity";
import SearchPanel from "./components/SearchPanel.vue";
import NotesPanel from "./components/NotesPanel.vue";
import WordCountPanel from "./components/WordCountPanel.vue";
import ChapterInventoryPanel from "./components/ChapterInventoryPanel.vue";
import ExportDialog from "./components/ExportDialog.vue";
import PromptTemplatePanel from "./components/PromptTemplatePanel.vue";
import OutlinePanel from "./components/OutlinePanel.vue";
import NotificationToast from "./components/NotificationToast.vue";
import TooltipLayer from "./components/TooltipLayer.vue";
import OnboardingGuide from "./components/OnboardingGuide.vue";
import WritingGoalPanel from "./components/WritingGoalPanel.vue";
import StoryBiblePanel from "./components/StoryBiblePanel.vue";
import { useWritingGoalStore } from "./stores/useWritingGoalStore";
import { threadKeyFor, useAgentStore } from "./stores/useAgentStore";

const layout = useLayoutStore();
const appearance = useAppearanceStore();
const book = useBookStore();
const referenceMenu = useReferenceMenuStore();
// 皮肤广场的浏览态（筛选 / 整窗预览 / 并排对比）。这里只读它**预览中了哪一套**，
// 因为「把皮肤刷到 <html> 上」的作者只有下面这一个 applyTheme（5-㊷）。
const skinBrowse = useSkinBrowseStore();
const { settings } = storeToRefs(appearance);
const {
  currentView,
  centerView,
  desktopShell,
  shellClasses,
  shellStyle,
  leftCollapsed,
  rightCollapsed,
  rightPaneWidth,
  newBookOpen
} = storeToRefs(layout);

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolvedScheme(): AppearanceColorScheme {
  return resolveColorScheme(settings.value.mode, prefersDark());
}

/**
 * 上一刷到 `<html>` 上的是哪一套配色（5-㊸）。挂载时为 null ⇒ 首刷不淡。
 * 它存在的理由只有一句：`applyTheme()` 不只是「换皮肤」被调用——改字号、换字体、
 * 切深浅、侧栏半透明开关，每一个都走这一条。挂上过渡而不看这一位，
 * 拖字号滑块就会整窗不停交叉淡一次。
 */
let lastPaintedSkinKey: string | null = null;

/**
 * 「整套配色换掉了没有」的判据，只有这一份。
 * 进项只有三样：明暗、皮肤 id、画面层——它们一变，屏幕上换的是**另一套配色**。
 * 字号/字体/行距/半透明是连续微调，不在这里面。
 */
function skinPaintKey(
  scheme: AppearanceColorScheme,
  view: ReturnType<typeof effectiveSettings>
): string {
  return `${scheme}|${view[scheme].skin}|${view[scheme].art}`;
}

function applyTheme(): void {
  const scheme = resolvedScheme();
  /**
   * 刷的是**该显示的那份**设置：预览中就换预览那套的结果，没预览就原样。
   *
   * 【为什么预览要挂在这一条通路上，而不是皮肤页自己刷一次 DOM】
   * `--skin-*` 的作者必须只有一个。皮肤页若自己再刷一遍，那么改字号、切深浅、
   * 系统换模式——任何一次 `applyTheme()` 都会把预览刷掉，用户在预览里看到的会自己变回去，
   * 而设置里从来没写过那一套。挂在这条通路上，预览就成了这份纯函数的一个输入
   * （见 composables/appearanceSkinPreview.ts：与「换上」共用同一个换算，两处不会是两套样子）。
   *
   * 【预览不落盘】`appearance.settings` 一个字节都没动，也不会有 appearance:save。
   * 退出预览（收条上的「换回去」、Esc、离开那一页）走的都是这一条通路回到真身。
   */
  const view = effectiveSettings(settings.value, skinBrowse.previewSkin);
  const paint = (): void => {
    applyAppearanceThemeToDocument({
      scheme,
      theme: view[scheme],
      uiFontFamily: view.uiFontFamily,
      editorFontFamily: view.editorFontFamily,
      density: view.density,
      liquidGlass: view.liquidGlass,
      liquidGlassIntensity: view.liquidGlassIntensity
    });
  };
  const key = skinPaintKey(scheme, view);
  const previous = lastPaintedSkinKey;
  lastPaintedSkinKey = key;
  // 首刷没有「旧样子」可淡；同一套再刷一次（预览内部切页签之类）也不必淡。
  if (previous === null || previous === key) {
    paint();
    return;
  }
  // 换配色走的是视图过渡那**同一个真身**：DOM 一点没动，只有 `<html>` 上的 token 变，
  // 于是 root 与三处命名元素各自把新旧两张快照交叉淡一遍 = 整窗换色而不是「啪地一下」。
  runViewTransition(paint);
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
  findReplaceHasLanding,
  skinGalleryHasLanding: skinGalleryIsMounted
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

/**
 * 皮肤广场那一格在渲染中吗（5-㊷）——整窗预览条与并排对比栏都挂在 SkinGalleryPage 里。
 * 判据与本文件模板里 `<SkinGalleryPage v-else-if="centerView === 'skins'" />` 是同一件事，
 * 这里只把它读成一句话，不复写条件。
 */
function skinGalleryIsMounted(): boolean {
  return currentView.value === "workspace" && centerView.value === "skins";
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

/**
 * 整屏面板互斥（2026-11-11）。判定真身在 utils/fullscreen-panel-exclusivity.ts，
 * 这里只把「该收掉哪几枚」应用到各枚状态上——九枚的持有者分两处（本文件六枚 ref、
 * layoutStore 三格），唯一同时看得见全部的就是这个装配层。
 * 刻意不改各入口的写法（快捷键 toggle、右栏按钮、slash 指令都照旧），
 * 免得「开一枚前先收掉别的」这句话散到十几个入口去，改一处忘一处。
 */
const fullscreenFlags = computed<FullscreenFlags>(() => ({
  search: searchOpen.value,
  notes: notesOpen.value,
  templates: tplPanelOpen.value,
  bible: bibleOpen.value,
  outline: outlineOpen.value,
  goals: goalPanelOpen.value,
  wordCount: layout.panelVisibility.wordCount,
  chapterStatus: layout.panelVisibility.chapterStatus,
  export: layout.panelVisibility.export
}));

function closeFullscreenPanel(key: FullscreenPanelKey): void {
  switch (key) {
    case "search":
      searchOpen.value = false;
      return;
    case "notes":
      notesOpen.value = false;
      return;
    case "templates":
      tplPanelOpen.value = false;
      return;
    case "bible":
      bibleOpen.value = false;
      return;
    case "outline":
      outlineOpen.value = false;
      return;
    case "goals":
      goalPanelOpen.value = false;
      return;
    case "wordCount":
      layout.closePanel("wordCount");
      return;
    case "chapterStatus":
      layout.closePanel("chapterStatus");
      return;
    case "export":
      layout.closePanel("export");
      return;
    default: {
      const unhandled: never = key;
      return unhandled;
    }
  }
}

watch(fullscreenFlags, (next, prev) => {
  for (const key of panelsToDismiss(prev, next)) closeFullscreenPanel(key);
});

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
// 整窗预览那一条 watch 的句柄（5-㊷）：预览态住在皮肤浏览 store，不在 settings 里，
// 所以它是**第二条** watch——但刷写仍然只有 applyTheme 这一个作者。
let unwatchPreview: (() => void) | null = null;
// 「有没有打开作品 → 右栏收放」这条 watch 的句柄（2026-10-11）。
let unwatchHasBook: (() => void) | null = null;
// 「有没有打开文稿 → 右栏收放」这条 watch 的句柄（2026-10-14 UI 评审批次）。
let unwatchActiveDoc: (() => void) | null = null;

/**
 * 没打开作品时把右栏收起来（2026-10-11）。判据的真身是
 * `shouldAutoCollapseRightPaneWithoutBook`（layoutStore 里的纯函数，能单测），
 * 这里只做**装配**：它是唯一同时看得见 `book.hasBook` 与 `layout` 的地方。
 *
 * 【为什么不写在 layoutStore 里】那会要求布局 store 反向依赖书 store，
 * 而书 store 在打开作品时还要 flush 草稿——一条纯几何的布局策略不该拖上这条依赖。
 * 这与本文件既有裁定同一形状：落点判定归装配层（见下方 findReplaceHasLanding 的注释）。
 *
 * 【为什么不碰手动闸门】用户自己折过右栏就交权，自动策略不再干预——
 * 与窄窗折叠那两条边界（只收不展、手动优先）完全一致，不在这里另立一套。
 */
function applyEmptyBookRightPane(): void {
  layout.setRightCollapsedByEmptyBook(shouldAutoCollapseRightPaneWithoutBook(0, book.hasBook));
}

/**
 * 有作品但没开文稿时收右栏；文稿打开时推回来（2026-10-14 UI 评审批次）。
 * 判据真身是 `shouldAutoCollapseRightPaneWithoutDoc`（layoutStore 里的纯函数，能单测），
 * 这里只做**装配**——理由与上一条相同：纯几何的布局策略不反向依赖书 store。
 *
 * 收与展各由一个布尔驱动（store 侧 setRightCollapsedByEmptyDoc）：
 *   - 收：书开着 + 文稿页签空转（浏览/资料两页签有真内容，不掺和）；
 *   - 展：书开着 + 文稿开着——用户点开一篇文稿，右栏必须当场回来，
 *     否则「点开了却什么都没发生」；手动折过的用户不受打扰（手动优先）。
 */
function applyActiveDocRightPane(): void {
  layout.setRightCollapsedByEmptyDoc(
    shouldAutoCollapseRightPaneWithoutDoc({
      hasBook: book.hasBook,
      activeDocTab: book.activeDocTab,
      rightPaneMode: book.rightPaneMode
    }),
    book.hasBook && book.activeDocTab !== null
  );
}

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
  // 退出握手（P0-6）：主进程拦下这趟关闭时，由书这格 store 把每篇没落盘的字先写回盘上。
  // 接在根组件而不是中栏——中栏会随页面卸载，握手却该在应用的整个生命期里都在。
  book.listenQuitFlush();
  // 没打开作品时收右栏（2026-10-11）：挂载这一拍就先收掉，不等用户看���那块空的。
  applyEmptyBookRightPane();
  // 减少动效（外观页那档偏好）：挂载即把档位落到 <html>，motion.css 据此决定动效层是否退场。
  applyReducedMotion(document.documentElement, loadReducedMotion(motionPreferenceStorage()));
  schemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  schemeQuery.addEventListener("change", applyTheme);
  window.addEventListener("resize", layout.reconcilePaneWidths);
  // 盘上设置回来后再刷一遍；此后每次设置改动（store 内 update 成功落 state）即时生效。
  void appearance.load().then(applyTheme);
  unwatchSettings = watch(settings, applyTheme, { deep: true });
  // 预览换了一套 = 屏幕上该刷的东西变了，走的是同一条刷写通路（作者仍然只有一个）。
  // 只盯 `previewId` 这一个字符串，不 deep 整份浏览态：筛选与对比勾选都改不到界面上的皮肤，
  // deep 会让每一次点筛选都重刷一遍 <html> 上的二十多枚 token。
  unwatchPreview = watch(() => skinBrowse.previewId, applyTheme);
  // 打开 / 关闭作品 → 右栏跟着收放（装配层接线，判定真身见 layoutStore 那个纯函数）。
  unwatchHasBook = watch(() => book.hasBook, applyEmptyBookRightPane);
  // 打开 / 关闭文稿 → 右栏跟着收放（2026-10-14，同一条装配纪律）。
  // 【watch 源刻意不含 rightPaneMode】用户亲手点「文稿」页签是在表达意图，
  // 此刻自动把它收走就是跟用户打架；判据读 mode 只为「收的瞬间别误伤浏览/资料」。
  unwatchActiveDoc = watch(() => [book.hasBook, book.activeDocTab], applyActiveDocRightPane);
  // 挂载这一拍就先判一次：会话恢复时若已有一篇开着的文稿，右栏当场就位，不等第一次改动。
  applyActiveDocRightPane();
});

onBeforeUnmount(() => {
  schemeQuery?.removeEventListener("change", applyTheme);
  window.removeEventListener("resize", layout.reconcilePaneWidths);
  unwatchSettings?.();
  unwatchPreview?.();
  unwatchHasBook?.();
  unwatchActiveDoc?.();
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

/**
 * 写作时长的信号源（2026-10-09 扫描总单「假控件与死路清单」第 1 行）。
 *
 * 面板底栏那两枚「平均速度 / 今日时长」以前恒显示 0：写时长的 `startSession`/`endSession`
 * 是番茄钟留下的接口，2026-10-05 专注模式整条下线后调用方删净了，没人调、也就没人写。
 * 修法不是把开始/结束按钮补回来（那是用户已经裁掉的功能），而是让时长由**有没有在动笔**推出来：
 * 打字必然改草稿，停笔必然不再有变化——所以信号就取 `book.draft` 的变化这一次事实，
 * 「隔多久算离席」「换稿那一跨不计」「亚秒零头攒着」这些取舍全在 store 的 `activity()` 一处，
 * 这里只报告事实，不复制判定（铁律 6）。
 */
watch(
  () => book.draft,
  () => {
    goalStore.activity(book.activeDocTab, Date.now());
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

    <!-- 左栏是**固定宽度**的导航轴（2026-11-09 用户裁定「那个侧边栏应该是固定的」）：
         这里原先有一枚 pane-resizer-left 拖拽条，现已撤掉——左栏宽度只跟视口档位走
         （layoutStore.defaultLeftPaneWidth），不再可拖。右栏那条拖拽条保留（见下方）。 -->

    <!-- 左栏收起后左缘那枚竖条（2026-10-17）：**恒挂 shell、只读 leftCollapsed**，
         与 currentView / centerView 都无涉 —— 于是对话 / 插件·技能 / 皮肤广场 / 设置四页都在。
         原先那枚「展开左侧栏」住在 CenterColumn 头上，而 CenterColumn 只在
         `centerView === 'chat'` 渲染（见下面 `<template v-else>` 里那一支）：
         真机实测，广场页 / 设置页 / 技能页收起左栏后 `hasExpandBtn=false`，
         没有任何可见入口，唯一退路是不可见的 Ctrl+B。放在 v-else **之前**就是为了修这个。 -->
    <PaneEdgeToggle v-if="leftCollapsed" @toggle="layout.togglePane('left')" />

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
      <!-- 「展开左侧栏」那一条已经搬到上面那枚 PaneEdgeToggle（2026-10-17）：
           同一动作只留一份真身，中栏这一支不再接 toggleLeft。 -->
      <CenterColumn
        v-if="centerView === 'chat'"
        :right-collapsed="rightCollapsed"
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

      <!-- 左栏固定宽度、没有拖拽条（2026-11-09）；这里只剩右栏这一枚 separator。 -->

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
        @pointerdown="layout.startPaneResize($event)"
        @keydown="layout.handleResizeKeydown($event)"
      />
    </template>

    <SaveConflictDialog />
    <NewBookDialog v-if="newBookOpen" @close="layout.closeNewBook()" />
    <ImportTxtDialog
      v-if="layout.importTxtOpen"
      :initial-target="layout.importTxtTarget"
      @close="layout.closeImportTxt()"
    />
    <SearchPanel :visible="searchOpen" @close="searchOpen = false" />
    <NotesPanel :visible="notesOpen" @close="notesOpen = false" />
    <WordCountPanel
      :visible="layout.panelVisibility.wordCount"
      @close="layout.closePanel('wordCount')"
    />
    <ChapterInventoryPanel
      :visible="layout.panelVisibility.chapterStatus"
      @close="layout.closePanel('chapterStatus')"
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
    <!-- 全站提示层：挂在通知之后（两者同用 --z-toast，同档时后画者在上）。
         恒挂、无 v-if：它自己靠事件委托接管 DOM 上的 title，不随视图切换重建。 -->
    <TooltipLayer />
    <OnboardingGuide v-if="layout.showOnboarding" />
  </div>
</template>
