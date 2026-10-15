// 结构出处见 docs/ATTRIBUTION.md。
// 仅删去其功能导航枚举（layoutFeatureNavigation：主功能高亮/视图切换），分栏、折叠与宽度记忆未改。
import { computed, nextTick, onScopeDispose, ref, shallowRef, watch } from "vue";
import { defineStore } from "pinia";
import type { BookKind } from "@mochen/contracts";
import { useOnboardingStore } from "./useOnboardingStore";
import type { RightPaneMode } from "./useBookStore";
import { createPanePointerCapture } from "../utils/panePointerCapture";
import { runViewTransition } from "../utils/view-transition";
import {
  RIGHT_PANE_MAX_WIDTH,
  RIGHT_PANE_MIN_WIDTH,
  loadRightPanePreferences,
  saveRightPanePreferences,
  type RightPanePreferences
} from "../utils/rightPanePreferences";

/**
 * 工作区的两个**整页视图**。
 *
 * `settings` 是整页（设置中心有它自己的侧栏分组导航，铺满整屏才排得开）。
 * 插件与技能**不是**整页——见 `CenterView` 那段注释。
 */
export type AppView = "workspace" | "settings";
/**
 * 中栏显示什么（2026-10-07 批次 5-㉜，用户裁定）。
 *
 * 【为什么它们住在中栏而不是整页——上一版做错了】
 * 5-㉛ 我把插件与技能做成 `currentView === "extensions"` 的整页，于是点进去**左栏整个消失**。
 * 用户指正：「不是重新创建侧边栏还是有的，然后旁边变成了那个技能库或插件」。
 * 缺的是这一层：**左栏是恒定的导航**，任何时候都不该消失；
 * 技能库与插件是「左栏某两枚钮通向的那个地方」，它们换的是**中栏那一格**，
 * 右边那一栏（文稿 / 浏览 / 作品资料）也不该跟着没。
 *
 * 【为什么合成一个 `CenterView` 而不是三处各写条件】
 * 中栏是 CenterColumn 与本页互斥的那一格，而「它俩互斥」这件事只该判一次。
 * 写两个 boolean（`showSkills` / `showPlugins`）就会出现「两个都 true」那种无解状态。
 *
 * 【`skins` 是第四档（2026-10-07 批次 5-㊴），照同一条裁定挂进来】
 * 皮肤广场换的同样是中栏那一格，而不是像设置中心那样铺满整屏。
 * 理由与上面三条同源：左栏那三枚钮是恒定的导航轴，
 * 皮肤广场是「左栏某枚钮通向的那个地方」——它要是自己变成整页，
 * 左栏就会跟着消失，而用户裁定的恰恰是「左栏不能消失」。
 */
export type CenterView = "chat" | "skills" | "plugins" | "skins";
/** 设置浮层的页签真身：showSettings 可指名打开哪一页（/model 走模型页，外观入口走外观页）。 */
export type SettingsTab =
  | "model"
  | "agent"
  | "writing"
  | "appearance"
  | "shortcuts"
  | "goals"
  | "projects"
  | "webdav"
  | "about";
export type PaneSide = "left" | "right";

export const LEFT_PANE_MIN = 220;
export const LEFT_PANE_MAX = 480;
export const RIGHT_PANE_MIN = RIGHT_PANE_MIN_WIDTH;
export const RIGHT_PANE_MAX = RIGHT_PANE_MAX_WIDTH;
export const CENTER_PANE_MIN_FALLBACK = 320;

function runtimeWindow(): Window | undefined {
  return typeof window === "undefined" ? undefined : window;
}

function initialViewportWidth(): number {
  return runtimeWindow()?.innerWidth ?? 1440;
}

export function defaultLeftPaneWidth(viewportWidth: number): number {
  return viewportWidth <= 1220 ? 262 : 286;
}

export function defaultRightPaneWidth(viewportWidth: number): number {
  return viewportWidth <= 1220 ? 395 : Math.min(650, Math.max(410, viewportWidth * 0.34));
}

/**
 * 窄到多少就自动收起右栏（2026-10-05 用户裁定）。
 *
 * 依据是三栏在窄窗下的实算，不是拍脑袋：≤1220px 时左 262 + 右 395 = 657 被两栏先吃掉，
 * 中栏只剩 视口 − 657。1000px 视口下中栏 343、900px 下 243（低于 `--center-pane-min: 320`，
 * 栅格会直接挤出容器）。而输入卡的 chip 降级阶梯在卡内 ≤440px 就开始丢标签——
 * 真机实锤的「怎么切换模型看不见」就是这条链的下游症状。
 * 1100 是「中栏还剩 838px、card 内宽远在阶梯第一级之上」的保守档。
 *
 * 两条边界，都是为了不跟用户打架：
 *   ① **只收不展**：窗口变宽时不擅自把右栏推回来（那会改掉用户眼前的视图）。
 *   ② **手动优先**：用户自己折叠/展开过右栏（`setPaneCollapsed`）就记下意图，此后不再自动干预。
 * 写成纯函数是为了能单测——这条判定藏在 reconcile 里就没人能钉它。
 */
export const NARROW_AUTO_COLLAPSE_WIDTH = 1100;

export function shouldAutoCollapseRightPane(viewportWidth: number): boolean {
  return viewportWidth < NARROW_AUTO_COLLAPSE_WIDTH;
}

/**
 * 没打开作品时，右栏该收起来（2026-10-11）。
 *
 * 依据不是审美偏好，是**那��格在那个状态下根本没有内容**：
 * 未打开作品时右栏摆出来的是一排图标 + 一组页签 + 一排格式钮 + 一句
 * 「在左栏点一篇文稿就能在这儿写」——约 460px、占窗口 1/3，全部是死的，
 * 而它每一条都在对用户说「我这儿有事」。用户第一眼看到的是一块用不了的板子，
 * 而不是主功能。收起后中栏拿到全部宽度。
 *
 * 【为什么不是「永久隐藏」】写作时右栏要回来。所以它挂在与窄窗折叠**同一条**通路里，
 * 复用同一对边界：只收不展（打开作品时不擅自推回来——那会改掉用户眼前的视图，
 * 由用户自己点开）、手动优先（用户手动折过就交权）。
 *
 * 【判据的真身在 book.hasBook】那是渲染层「有没有打开作品」的单一 getter
 * （useBookStore 的 getters，已被 5 个读点统一使用）。这里不另写一份 meta 判据。
 *
 * 纯函数是为了能单测——和上面那条窄窗判据同一个理由。
 */
export function shouldAutoCollapseRightPaneWithoutBook(
  viewportWidth: number,
  hasBook: boolean
): boolean {
  // 没有作品一律收。视口宽度这一维对这条判据没有影响：
  // 无作品时无论多宽，右栏摆出来都是那句「点一篇文稿就能在这儿写」，没有一个像素是有用的。
  return !hasBook || shouldAutoCollapseRightPane(viewportWidth);
}

/**
 * 有作品但没开文稿时，文稿页签该收起来（2026-10-14 UI 评审批次）。
 *
 * 与上一条互补：无作品那档管「书都没开」，这一档管「书开了但文稿页签还空转」——
 * 此时摆出来的是一排格式钮 + 一句「打开一篇文稿后才能插入片段」，
 * 宽窗下约 1/3 宽度，同样没有一个像素有用。
 *
 * 【为什么只盯文稿页签】浏览页签（挑文稿）与作品资料页签（书卡）在没有 activeDoc
 * 时是有真内容的，用户完全可能正在用——把它们也收了就是跟用户打架。
 * 只有 manuscript 空转是纯死重。
 *
 * 【判据不掺和「无作品」那档】hasBook 为假时这里恒假，收的任务归上一条；
 * 两条判据各管各的档，装配层（App.vue）两个 watch 都接。
 */
export function shouldAutoCollapseRightPaneWithoutDoc(input: {
  hasBook: boolean;
  activeDocTab: string | null;
  rightPaneMode: RightPaneMode;
}): boolean {
  return input.hasBook && input.activeDocTab === null && input.rightPaneMode === "manuscript";
}

function initialRightPanePreferences(): RightPanePreferences {
  const currentWindow = runtimeWindow();
  if (!currentWindow) return { widths: {} };
  try {
    return loadRightPanePreferences(currentWindow.localStorage);
  } catch {
    return { widths: {} };
  }
}

export const useLayoutStore = defineStore("layout", () => {
  const viewportWidth = ref(initialViewportWidth());
  const initialRightPaneWidth = defaultRightPaneWidth(viewportWidth.value);

  const currentView = ref<AppView>("workspace");
  /**
   * 中栏当前显示什么（5-㉜）。三处指着同一处：左栏两枚钮、两个斜杠命令、
   * 中栏自己那格互斥渲染。住 store 而不住页面局部 ref —— 否则从命令进来
   * 会与从钮进来落到不同的地方。
   */
  const centerView = ref<CenterView>("chat");
  /** 设置浮层的页签真身：showSettings 可指名打开哪一页（/model 走模型页，外观入口走外观页）。 */
  const settingsTab = ref<SettingsTab>("model");
  /** 「新建作品」对话框的唯一开合真身：左栏与工作台降级区都开它，不再各持一份布尔。 */
  const newBookOpen = ref(false);
  /** 「导入 TXT」对话框的唯一开合真身（2026-10-11）：入口在左栏书务行，与 newBookOpen 同一套开合法。 */
  const importTxtOpen = ref(false);
  /**
   * 一次性信号：中栏工作台的「空卡」被点时请求左栏展开该类分组并进入行内新建。
   * 真身仍是左栏的 guideToDoc——这里只传「请引导到这一类」，不复制它的开合逻辑；
   * 左栏消费后立刻清空（不留下一个永远为真、重复触发的布尔）。
   */
  const docGroupRequest = ref<BookKind | null>(null);
  const leftCollapsed = ref(false);
  /**
   * 右栏初始折叠态由视口宽度决定（窄窗一进来就先把宽度让给中栏，而不是等用户发现挤）。
   * 手动意图的闸门：用户自己折叠/展开过右栏之后，自动策略就交权（见 setPaneCollapsed）。
   */
  const rightCollapsed = ref(shouldAutoCollapseRightPane(viewportWidth.value));
  const rightPaneManuallyToggled = ref(false);
  const desktopShell = shallowRef<HTMLElement | null>(null);
  const leftPaneWidth = ref(defaultLeftPaneWidth(viewportWidth.value));
  /**
   * 用户亲手拖过 / 键盘调过左栏宽度没有（2026-10-14 设计稿对表批次）。
   *
   * 【为什么需要这一位】`shellStyle` 把 `--left-pane-width` 作为**内联自定义属性**写在
   * `.desktop-shell` 自己身上，而栅格读的正是这个元素（`styles.css:176`）。
   * 内联赢过 `:root` 的 `@media (max-width: 1220px)`（`styles.css:271`）——
   * 于是那条 CSS 判据从来没机会生效：窗口从宽拖窄，左栏卡在 286 不动。
   * 更糟的是 `leftPaneWidth` 只在 store 创建那一刻按当时的视口算过一次，
   * resize 通路 `reconcilePaneWidths` 只把同一个值重新夹一遍，等于「两份真相、都不更新」。
   *
   * 【为什么不是删掉 @media 让 JS 独走】删了它，脚本尚未跑起来的白屏期与
   * jsdom 里没有 resize 的场合就没有兜底值；留着它，JS 必须跟着同一条判据走——
   * 于是这里在 resize 时按 `defaultLeftPaneWidth` 重算，两边算的是同一个函数、同一个口径。
   *
   * 【为什么用户调过就不再自动改】与右栏那条 `rightPaneManuallyToggled` 同一条纪律：
   * 用户亲手定的宽度是表达过的意图，窗口缩放不该替他改回来（否则拖窄一点栏就自己弹回去）。
   */
  const leftPaneUserAdjusted = ref(false);
  const rightPaneWidth = ref(initialRightPaneWidth);
  const rightPanePreferences = shallowRef<RightPanePreferences>(initialRightPanePreferences());
  const activeRightPanePreferenceKey = ref<string>();
  const resizingPane = ref<PaneSide | null>(null);
  const paneTransitionSuppressed = ref(false);
  /**
   * 走本 store 的开合态（App 层持有，避免浮层互制）。
   *
   * 【为什么只剩两枚】2026-10-15 收口：原先这里列着六枚，其中 `search` / `notes` / `templates`
   * 的可见态其实由 App.vue 自己的 `searchOpen` / `notesOpen` / `tplPanelOpen` 三个局部 ref 持有，
   * 同一件事因此在两处各存一份；`versionHistory` 更彻底——它指向的面板 `VersionHistoryPanel.vue`
   * 全仓无人 import、写快照的 `createSnapshot` 也零调用，是整族死代码（详见第六十三节）。
   * 判据不是「我觉得它多余」，而是**没有任何模板读过这四个键**：新守卫住在
   * `components/dead-panel-entry.test.ts`，它会当场红。
   */
  const panelVisibility = ref({
    wordCount: false,
    export: false
  });
  /** 首次引导流程：因为 onboarding store 独立，这里只负责「App 这边要不要展示浮层」的信号桥 */
  const showOnboarding = ref(false);
  const pointerCapture = createPanePointerCapture(stopPaneResize);

  let resizeInitialPaneWidth: number | undefined;
  let paneTransitionSuppressionClock = 0;
  let paneTransitionReleaseFrame: number | undefined;

  const shellClasses = computed(() => ({
    "is-left-collapsed": leftCollapsed.value,
    "is-right-collapsed": rightCollapsed.value,
    "is-resizing": resizingPane.value !== null,
    "is-pane-transition-suppressed": paneTransitionSuppressed.value
  }));

  const shellStyle = computed(() => ({
    "--left-pane-width": `${leftPaneWidth.value}px`,
    "--right-pane-width": `${rightPaneWidth.value}px`
  }));

  const writingRightPaneViewModel = computed(() => ({
    collapsed: rightCollapsed.value,
    minWidth: RIGHT_PANE_MIN,
    maxWidth: maximumPaneWidth("right"),
    width: rightPaneWidth.value
  }));

  /**
   * 视图过渡（批次 5-㊸）：**只在「那一格真的换页面」时才发起**。
   * 判据只有这一份，三处切换共用——不写成三遍 if 就是要避免的那种「同一判定两份实现」。
   *
   * 为什么不是「调用了切换函数就过渡」：
   * ① 同页重入（连点两枚钮、Esc 又按一次）：old/new 两张快照逐像素相同，
   *    白拍一轮 220ms，还占住 `runViewTransition` 的「在飞」闸，让下一次真切换也放不出来。
   * ② 设置页换页签：`SettingsPage` 那个组件根本不卸载，为了让左栏一枚高亮挪位置
   *    把整页交叉淡一遍，比不做还晃。
   */
  function contentSlotSwitches(to: AppView, toCenter: CenterView): boolean {
    if (currentView.value !== to) return true;
    return to === "workspace" && centerView.value !== toCenter;
  }

  function showSettings(tab: SettingsTab = "model"): void {
    const apply = (): void => {
      settingsTab.value = tab;
      // 【5-㊳】顺手把 centerView 复位，否则左栏那一枚会**停在原地亮着**：
      // 真机从皮肤广场点齿轮进设置，屏幕上是设置中心，左栏「皮肤广场」却还亮着
      // （p536j 单独量过一次：center 由 skin-gallery 变成 settings-page，active 仍是 ["skins"]）。
      // 左栏的 active 只有一件事要做——说「你在这儿」；说错了比不说更糟。
      //
      // 复位之后一枚都不亮，这是对的：设置视图的指示器是左下角那颗齿轮本身，
      // 它不在 nav-row 里、不参与互斥。回程落点与 showWorkspace 一致（都是对话）。
      centerView.value = "chat";
      currentView.value = "settings";
    };
    if (!contentSlotSwitches("settings", "chat")) {
      apply();
      return;
    }
    runViewTransition(apply, { direction: "forward" });
  }

  function openGoalsSettings(): void {
    settingsTab.value = "goals";
  }

  function openProjectSettings(): void {
    settingsTab.value = "projects";
  }

  function showWorkspace(): void {
    const apply = (): void => {
      currentView.value = "workspace";
      // 回工作区 = 回**对话**。设置中心与技能库/插件都是从工作区出发去的地方，
      // 回程的落点只有一个：那条对话。不复位的话，Esc 关掉设置之后中栏还摆着技能库，
      // 而左栏高亮的是「工作台」——两枚都在说「你在这儿」。
      centerView.value = "chat";
    };
    if (!contentSlotSwitches("workspace", "chat")) {
      apply();
      return;
    }
    // 回程是「退」，方向与去时相反，CSS 那两支滑入才不是同一支。
    runViewTransition(apply, { direction: "back" });
  }

  /**
   * 切中栏（批次 5-㉜）。左栏两枚钮各自指名，于是「点技能库进来就在技能库」
   * 「点插件进来就在插件」，用户想看的那一处不用再手点一次。
   *
   * 顺带把 `currentView` 拨回 workspace：人在设置页（整页，没有中栏）时点左栏那两枚钮，
   * 不拨回来的话点了像没反应——设置页把整个窗口铺满了，中栏压根不在。
   */
  function showCenter(page: Exclude<CenterView, "chat">): void {
    const apply = (): void => {
      centerView.value = page;
      currentView.value = "workspace";
    };
    if (!contentSlotSwitches("workspace", page)) {
      apply();
      return;
    }
    runViewTransition(apply, { direction: "forward" });
  }

  function openNewBook(): void {
    newBookOpen.value = true;
  }

  function closeNewBook(): void {
    newBookOpen.value = false;
  }

  function openImportTxt(): void {
    importTxtOpen.value = true;
  }

  function closeImportTxt(): void {
    importTxtOpen.value = false;
  }

  function requestDocGroup(kind: BookKind): void {
    docGroupRequest.value = kind;
  }

  function clearDocGroupRequest(): void {
    docGroupRequest.value = null;
  }

  function setPaneCollapsed(side: PaneSide, collapsed: boolean): void {
    if (side === "left") {
      leftCollapsed.value = collapsed;
    } else {
      // 手动意图闸门：右栏只经由这条命令被用户动过，动了就把自动策略交权。
      // 自动折叠走的是 reconcilePaneWidths（直接赋 ref，不经这里），所以不会自我上锁。
      rightPaneManuallyToggled.value = true;
      rightCollapsed.value = collapsed;
    }
  }

  function togglePane(side: PaneSide): void {
    setPaneCollapsed(side, side === "left" ? !leftCollapsed.value : !rightCollapsed.value);
  }

  /**
   * 「没有打开作品 → 收右栏」这条自动策略的**唯一写入口**（2026-10-11）。
   * 由 App.vue 在装配层调用（它是唯一同时看得见 book.hasBook 与 layout 的地方）。
   *
   * 与 reconcilePaneWidths 里的窄窗自动折叠同一条边界，理由逐条相同：
   *   - 用户手动折过右栏就交权，此后自动策略不再干预（不跟用户打架）；
   *   - **只收不展**：判据为真才置 true，判据转假时**不碰** rightCollapsed
   *     （打开作品后不擅自把右栏推回来——那会改掉用户眼前的视图，由他自己点）。
   *
   * 刻意**不走** setPaneCollapsed：那条会把手动闸门置上，自动策略一走它就把自己锁死。
   */
  function setRightCollapsedByEmptyBook(shouldCollapse: boolean): void {
    if (rightPaneManuallyToggled.value) return;
    if (shouldCollapse) rightCollapsed.value = true;
  }

  /**
   * 「有作品但没开文稿 → 收右栏；文稿打开 → 推回来」这条自动策略的**唯一写入口**
   * （2026-10-14 UI 评审批次）。判据真身见 shouldAutoCollapseRightPaneWithoutDoc。
   *
   * 与 setRightCollapsedByEmptyBook 同一条手动闸门，但**收展双向**，展开有明确理由：
   * 「打开文稿」是用户点了某一篇——此刻右栏要是不回来，用户看到的是
   * 「点开了却什么都没发生」，比不收还糟。所以它与「打开作品不擅自推回来」
   * 那条（只收不展）刻意分岔：开书可能只是来查资料，开文稿就是要写。
   */
  function setRightCollapsedByEmptyDoc(shouldCollapse: boolean, shouldExpand: boolean): void {
    if (rightPaneManuallyToggled.value) return;
    if (shouldCollapse) rightCollapsed.value = true;
    else if (shouldExpand) rightCollapsed.value = false;
  }

  function centerPaneMinWidth(): number {
    const currentWindow = runtimeWindow();
    if (!desktopShell.value || !currentWindow) {
      return CENTER_PANE_MIN_FALLBACK;
    }
    const value = Number.parseFloat(
      currentWindow.getComputedStyle(desktopShell.value).getPropertyValue("--center-pane-min")
    );
    return Number.isFinite(value) ? value : CENTER_PANE_MIN_FALLBACK;
  }

  function maximumPaneWidth(side: PaneSide): number {
    const currentViewportWidth = viewportWidth.value;
    const shellWidth = desktopShell.value?.getBoundingClientRect().width ?? currentViewportWidth;
    const otherWidth =
      side === "left"
        ? rightCollapsed.value
          ? 0
          : rightPaneWidth.value
        : leftCollapsed.value
          ? 0
          : leftPaneWidth.value;
    const paneMin = side === "left" ? LEFT_PANE_MIN : RIGHT_PANE_MIN;
    const paneMax = side === "left" ? LEFT_PANE_MAX : RIGHT_PANE_MAX;
    const availableMax = Math.max(paneMin, shellWidth - otherWidth - centerPaneMinWidth());
    return Math.min(paneMax, availableMax);
  }

  function clampPaneWidth(side: PaneSide, width: number): number {
    const paneMin = side === "left" ? LEFT_PANE_MIN : RIGHT_PANE_MIN;
    return Math.round(Math.min(Math.max(width, paneMin), maximumPaneWidth(side)));
  }

  function setPaneWidth(side: PaneSide, width: number): void {
    if (side === "left") {
      leftPaneWidth.value = clampPaneWidth(side, width);
    } else {
      rightPaneWidth.value = clampPaneWidth(side, width);
    }
  }

  function preferredRightPaneWidth(key = activeRightPanePreferenceKey.value): number {
    return key
      ? (rightPanePreferences.value.widths[key] ?? initialRightPaneWidth)
      : initialRightPaneWidth;
  }

  function restoreRightPaneWidth(key = activeRightPanePreferenceKey.value): void {
    setPaneWidth("right", preferredRightPaneWidth(key));
  }

  function releasePaneTransitionAfterPaint(requestId: number): void {
    const currentWindow = runtimeWindow();
    if (!currentWindow) {
      if (requestId === paneTransitionSuppressionClock) {
        paneTransitionSuppressed.value = false;
      }
      return;
    }
    if (paneTransitionReleaseFrame !== undefined) {
      currentWindow.cancelAnimationFrame(paneTransitionReleaseFrame);
    }
    paneTransitionReleaseFrame = currentWindow.requestAnimationFrame(() => {
      if (requestId !== paneTransitionSuppressionClock) return;
      paneTransitionReleaseFrame = currentWindow.requestAnimationFrame(() => {
        paneTransitionReleaseFrame = undefined;
        if (requestId === paneTransitionSuppressionClock) {
          paneTransitionSuppressed.value = false;
        }
      });
    });
  }

  function restoreRightPaneWidthForNavigation(key = activeRightPanePreferenceKey.value): void {
    const requestId = ++paneTransitionSuppressionClock;
    paneTransitionSuppressed.value = true;
    restoreRightPaneWidth(key);
    void nextTick(() => releasePaneTransitionAfterPaint(requestId));
  }

  function setActiveRightPanePreferenceKey(key: string | undefined, restore = true): void {
    const previousKey = activeRightPanePreferenceKey.value;
    activeRightPanePreferenceKey.value = key;
    if (restore && key && key !== previousKey) {
      restoreRightPaneWidthForNavigation(key);
    }
  }

  function persistActiveRightPaneWidth(width: number): boolean {
    const key = activeRightPanePreferenceKey.value;
    const currentWindow = runtimeWindow();
    if (!key || !currentWindow) return false;
    const nextPreferences: RightPanePreferences = {
      widths: { ...rightPanePreferences.value.widths, [key]: width }
    };
    rightPanePreferences.value = nextPreferences;
    return saveRightPanePreferences(currentWindow.localStorage, nextPreferences);
  }

  /**
   * 真实布局宽度。`window.innerWidth` 在 Electron 缩放下不一定等于 CSS 布局宽度——
   * 真机实测：内置浏览器面板实际只渲染 877px，`window.innerWidth` 却报 1280。
   * 拿它判「窗口窄不窄」会判反。shell 在时以实测为准，没有就退回 innerWidth；
   * 口径与 `maximumPaneWidth` 相同（铁律 6：一份真身）。
   */
  function layoutViewportWidth(): number {
    return desktopShell.value?.getBoundingClientRect().width ?? initialViewportWidth();
  }

  function reconcilePaneWidths(): void {
    viewportWidth.value = initialViewportWidth();
    // 窄窗自动收右栏：只在用户没手动动过右栏时生效（边界①②见 shouldAutoCollapseRightPane 的注释）。
    // 直接赋 ref 而不是走 setPaneCollapsed —— 后者会把手动闸门置上，自动折叠会把自己锁死。
    // 判据用 layoutViewportWidth 而不是刚读进来的 innerWidth：缩放下两者可能差一倍以上。
    if (!rightPaneManuallyToggled.value && shouldAutoCollapseRightPane(layoutViewportWidth())) {
      rightCollapsed.value = true;
    }
    if (!leftCollapsed.value) {
      // 用户没亲手定过宽度时，跟着**当前**真实布局宽度重算默认档（窄窗 262 / 宽窗 286）。
      // 判据用 layoutViewportWidth 而不是 viewportWidth：与上面右栏那条同一个口径。
      if (!leftPaneUserAdjusted.value) {
        leftPaneWidth.value = defaultLeftPaneWidth(layoutViewportWidth());
      }
      setPaneWidth("left", leftPaneWidth.value);
    }
    if (!rightCollapsed.value) {
      restoreRightPaneWidth();
    }
  }

  function handleResizeMove(event: PointerEvent): void {
    if (!resizingPane.value || !desktopShell.value) return;
    const bounds = desktopShell.value.getBoundingClientRect();
    const width =
      resizingPane.value === "left" ? event.clientX - bounds.left : bounds.right - event.clientX;
    // 拖拽条上动一下就是用户表达过意图了（与右栏 rightPaneManuallyToggled 同一纪律）：
    // 此后窗口缩放不再替他重算默认档。
    if (resizingPane.value === "left") leftPaneUserAdjusted.value = true;
    setPaneWidth(resizingPane.value, width);
  }

  function stopPaneResize(): void {
    pointerCapture.release();
    const resizedPane = resizingPane.value;
    const initialWidth = resizeInitialPaneWidth;
    resizingPane.value = null;
    resizeInitialPaneWidth = undefined;
    const currentWindow = runtimeWindow();
    currentWindow?.removeEventListener("pointermove", handleResizeMove);
    currentWindow?.removeEventListener("pointerup", stopPaneResize);
    currentWindow?.removeEventListener("pointercancel", stopPaneResize);
    if (resizedPane === "right" && rightPaneWidth.value !== initialWidth) {
      persistActiveRightPaneWidth(rightPaneWidth.value);
    }
  }

  function startPaneResize(side: PaneSide, event: PointerEvent): void {
    event.preventDefault();
    stopPaneResize();
    resizingPane.value = side;
    pointerCapture.start(event);
    resizeInitialPaneWidth = side === "left" ? leftPaneWidth.value : rightPaneWidth.value;
    const currentWindow = runtimeWindow();
    currentWindow?.addEventListener("pointermove", handleResizeMove);
    currentWindow?.addEventListener("pointerup", stopPaneResize);
    currentWindow?.addEventListener("pointercancel", stopPaneResize);
  }

  function handleResizeKeydown(side: PaneSide, event: KeyboardEvent): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    const currentWidth = side === "left" ? leftPaneWidth.value : rightPaneWidth.value;
    const nextWidth = currentWidth + direction * (side === "left" ? 12 : -12);
    if (side === "left") leftPaneUserAdjusted.value = true;
    setPaneWidth(side, nextWidth);
    if (side === "right" && rightPaneWidth.value !== currentWidth) {
      persistActiveRightPaneWidth(rightPaneWidth.value);
    }
  }

  // 新面板开关（只剩真被模板读过的那两枚，见上面 panelVisibility 那段）
  type PanelKey = "wordCount" | "export";

  function openPanel(panel: PanelKey): void {
    panelVisibility.value[panel] = true;
  }

  function closePanel(panel: PanelKey): void {
    panelVisibility.value[panel] = false;
  }

  function togglePanel(panel: PanelKey): void {
    panelVisibility.value[panel] = !panelVisibility.value[panel];
  }

  function openWordCount(): void {
    openPanel("wordCount");
  }
  function openExport(): void {
    openPanel("export");
  }

  // 引导流程桥
  const onboarding = useOnboardingStore();
  showOnboarding.value = onboarding.showGuide;
  watch(onboarding.state, (s) => {
    showOnboarding.value = s.showGuide;
  });

  function disposeLayout(): void {
    stopPaneResize();
    paneTransitionSuppressionClock += 1;
    const currentWindow = runtimeWindow();
    if (paneTransitionReleaseFrame !== undefined) {
      currentWindow?.cancelAnimationFrame(paneTransitionReleaseFrame);
      paneTransitionReleaseFrame = undefined;
    }
    paneTransitionSuppressed.value = false;
    desktopShell.value = null;
  }

  watch([leftCollapsed, rightCollapsed, currentView], () => {
    void nextTick(reconcilePaneWidths);
  });

  // shell 挂上之后补判一次：store 创建那一刻 desktopShell 还是 null，只能退回 innerWidth，
  // 而 Electron 缩放下 innerWidth 可能明显大于真实布局宽度（真机：1280 vs 877）。
  // 这条 watch 让「按真实宽度」这条判据真的有机会生效，而不只是写在注释里。
  watch(desktopShell, (shell) => {
    if (shell) void nextTick(reconcilePaneWidths);
  });

  onScopeDispose(disposeLayout);

  return {
    currentView,
    centerView,
    settingsTab,
    newBookOpen,
    importTxtOpen,
    docGroupRequest,
    leftCollapsed,
    rightCollapsed,
    rightPaneManuallyToggled,
    leftPaneUserAdjusted,
    desktopShell,
    leftPaneWidth,
    rightPaneWidth,
    rightPanePreferences,
    activeRightPanePreferenceKey,
    resizingPane,
    paneTransitionSuppressed,
    shellClasses,
    shellStyle,
    writingRightPaneViewModel,
    panelVisibility,
    showOnboarding,
    showSettings,
    openGoalsSettings,
    openProjectSettings,
    showWorkspace,
    showCenter,
    openNewBook,
    closeNewBook,
    openImportTxt,
    closeImportTxt,
    requestDocGroup,
    clearDocGroupRequest,
    setPaneCollapsed,
    togglePane,
    setRightCollapsedByEmptyBook,
    setRightCollapsedByEmptyDoc,
    clampPaneWidth,
    setPaneWidth,
    preferredRightPaneWidth,
    restoreRightPaneWidth,
    restoreRightPaneWidthForNavigation,
    setActiveRightPanePreferenceKey,
    persistActiveRightPaneWidth,
    reconcilePaneWidths,
    handleResizeMove,
    stopPaneResize,
    startPaneResize,
    handleResizeKeydown,
    disposeLayout,
    openPanel,
    closePanel,
    togglePanel,
    openWordCount,
    openExport
  };
});
