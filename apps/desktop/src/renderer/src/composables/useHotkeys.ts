// 薄壳：装全局唯一的 keydown 监听、把真 DOM 解成焦点源、把判定结果派到既有 store action；本文件不判断。
// 判断层各有其主：键→动作 utils/hotkeys.ts、Esc 裁决 utils/escape-policy.ts、焦点推导 utils/hotkey-focus.ts（裁定 G2）；
// 审批映射 utils/hotkey-decisions（评审 X2）、DOM 标记名 utils/hotkey-markers（评审 X4a）——单实现模块，只消费。
// 全局 keydown 有且只有这里一处（裁定 G5）。
import { onBeforeUnmount, onMounted } from "vue";
import {
  resolveHotkey,
  type HotkeyAction,
  type HotkeyMods,
  type PanelShortcutId
} from "../utils/hotkeys";
import { APPROVAL_DECISIONS } from "../utils/hotkey-decisions";
import { composerTextAfterQueue } from "../utils/hotkey-queue";
import {
  CARD_ID_ATTR,
  CARD_SELECTOR,
  CARD_STATUS_ATTR,
  COMPOSER_SELECTOR,
  GUIDANCE_SELECTOR
} from "../utils/hotkey-markers";
import { deriveHotkeyFocus, type HotkeyFocusSources } from "../utils/hotkey-focus";
import { resolveEscape } from "../utils/escape-policy";
import { loadSubmitKey, submitKeyPreferenceStorage } from "../utils/send-key-preference";
import { clearComposerAfterSend } from "../utils/auto-behavior-preference";
import { threadKeyFor, useAgentStore } from "../stores/useAgentStore";
import { useBookStore } from "../stores/useBookStore";
import { useLayoutStore } from "../stores/layoutStore";
import { useReferenceMenuStore } from "../stores/useReferenceMenuStore";
import { useFindReplaceStore } from "../stores/useFindReplaceStore";
import { useSkinBrowseStore } from "../stores/useSkinBrowse";

export interface HotkeyHandlers {
  openPalette(): void;
  /**
   * Ctrl+Shift / Ctrl+Alt 面板快捷键的落点。
   * 判定层只报是哪一枚，「开还是翻转」是装配层的语义（面板状态住在 App.vue），所以由这里回调过去。
   */
  panelShortcut(id: PanelShortcutId): void;
  /**
   * 行内引用菜单（`/` 与 `@`）此刻在屏幕上有落点吗。真身在 App.vue——菜单挂在
   * CenterColumn → ComposerBox 里，而 CenterColumn 只在「当前视图是工作台 + 中栏是对话」时渲染。
   *
   * 【为什么 Esc 那一支必须问它，而开启动作不在这儿问】开着菜单切去设置页，store 里的 `match` 不会消失
   * （ComposerReferenceMenu 的 onBeforeUnmount 只摘监听，不 close）。而 resolveEscape 里
   * `referenceMenuIsOpen` 排在 `settingsIsOpen` **前面** ⇒ 一次 Esc 全喂给一个看不见的菜单，
   * 用户看到的就是「Esc 失灵」，要按第二下才出设置页。与 5-㊴ 的 Ctrl+F 同一个病。
   * 开启动作（`open-palette`）的判据留在 App.vue 的 `openPalette` 回调里——
   * 那是装配层自己的落点决策，在这里再判一次就是同一判定的第二份实现。
   */
  referenceMenuHasLanding(): boolean;
  /**
   * 此刻屏幕上是否真有「文档内查找替换」的落点。
   *
   * 【5-㊴ 实测出来的真缺陷】这个谓词不是洁癖，是修一个具体的坏：
   * FindReplacePanel 挂在 DocumentPane 里，而 DocumentPane 只在「工作台 + 右栏没折 + 中栏是对话」时渲染，
   * 面板自己还要求右栏处在「文稿」模式。于是在设置页（以及浏览/资料模式）按 Ctrl+F，
   * store 被置成 visible=true 而**屏上一个像素都没有**：
   * 用户看不见任何东西，那个不可见的标记却先吃掉 Esc——`findReplaceIsOpen` 是 Esc 优先级最高的那一支
   * （高于收设置页），于是第一次 Esc「像死键」，要按第二下才出设置页。实测两下才对。
   *
   * 真身在 App.vue（DocumentPane 的 v-if 与右栏模式的裁决都在那份模板上）；
   * 在这里复写那份条件就是第二次实现——而这正是本缺陷的成因。
   */
  findReplaceHasLanding(): boolean;
  /**
   * 皮肤广场那一格此刻在屏幕上吗（5-㊷）。
   *
   * 整窗预览条与并排对比栏都挂在 SkinGalleryPage 里，而那一页只在
   * `centerView === "skins"` 时渲染。真身在 App.vue 的那条 v-if 上——
   * 在这里复写它条件就是第二次实现，而第二次实现正是「看不见的标记白吃一次 Esc」这一族的成因
   * （5-㊴ 的 Ctrl+F、#106 的引用菜单都栽过）。
   */
  skinGalleryHasLanding(): boolean;
}

/** 评审 X4b：每次按键把「哪枚是 composer、哪张卡聚焦」解析**一次**，dispatch/escape 共用同一份，不再回头重查 DOM。 */
interface KeyTargets {
  readonly composer: HTMLTextAreaElement | null;
  readonly card: HTMLElement | null;
}

export function useGlobalHotkeys(handlers: HotkeyHandlers): void {
  const agent = useAgentStore();
  const book = useBookStore();
  const layout = useLayoutStore();
  // #106：行内引用菜单的开合与高亮是 store 态，正是为了让这一处键位裁决能够派到它头上（裁定 D2）。
  const reference = useReferenceMenuStore();
  const findReplace = useFindReplaceStore();
  // 5-㊷：整窗预览与并排对比的开合真身在皮肤广场的浏览 store 里，这里只派「收最外那一层」。
  const skins = useSkinBrowseStore();

  function elementOf(target: EventTarget | null): HTMLElement | null {
    return target instanceof HTMLElement ? target : null;
  }

  /** 护栏 4：审批四键与卡内 Esc 只作用于「聚焦的那一张卡」——靠 activeElement 往上找卡。 */
  function focusedCard(): HTMLElement | null {
    const active = elementOf(document.activeElement);
    if (active === null) return null;
    return elementOf(active.closest(CARD_SELECTOR));
  }

  function runningNow(): boolean {
    return agent.threads[threadKeyFor(book.activeDocTab)]?.running ?? false;
  }

  function escape(event: KeyboardEvent, card: HTMLElement | null): void {
    const guidance = card?.querySelector<HTMLTextAreaElement>(GUIDANCE_SELECTOR) ?? null;
    const cardId = card?.getAttribute(CARD_ID_ATTR) ?? "";
    // 裁决（说明框保字 > 取消该条 > 收浮层 > 打断 > 无动作）全在 resolveEscape，这里不复制口径。
    const action = resolveEscape({
      hasFocusedProposal: card !== null,
      focusedProposalPending: card?.getAttribute(CARD_STATUS_ATTR) === "pending",
      guidanceIsDirty: (guidance?.value.trim() ?? "") !== "",
      turnRunning: runningNow(),
      // 唯一喂入点：设置浮层的真身是 layout.currentView === "settings"（设计决定 2）。
      settingsIsOpen: layout.currentView === "settings",
      // #106 菜单是最内一层：Esc 先收它，绝不越级打断正在跑的那一轮（一层一层收）。
      // 但它排在 settingsIsOpen 前面 ⇒ 落点没了就必须当它没开（5-㊴，见 referenceMenuHasLanding）。
      referenceMenuIsOpen: reference.isOpen && handlers.referenceMenuHasLanding(),
      // 文档内查找替换面板开着（Ctrl+F）：这一次 Esc 的第一个收动作为（关闭它）。
      // 必须同时问一句「面板现在有落点吗」（5-㊴）：那个标记可能在用户切去设置页之前就置上了，
      // 而没有落点的标记只会白吃一次 Esc，且用户看不出第一下按去了哪。
      findReplaceIsOpen: findReplace.visible && handlers.findReplaceHasLanding(),
      // 皮肤浮层（整窗预览条 / 对比栏）开着，且皮肤广场那一页此刻真在屏幕上（5-㊷）。
      // 两问缺一不可：预览态是不落盘的临时刷写，人走了它还在 store 里；
      // 而没有落点的标记只会白吃一次 Esc（与上一支、与 #106 同一条规矩）。
      skinOverlayIsOpen: skins.overlayIsOpen && handlers.skinGalleryHasLanding()
    });
    // 评审 X3（与 dispatch 里的 never 穷尽守卫同律，G1/X3 同法一条）：switch + never 穷尽性守卫——
    // EscapeAction 新增成员没在此接线 ⇒ 编译失败，杜绝「静默死键」。
    switch (action) {
      case "keep-guidance":
        event.preventDefault();
        guidance?.blur();
        return;
      case "cancel-proposal":
        // 无卡可撤（cardId 为空）：与旧 if 链逐字同义——什么都不做，不 preventDefault，也不进后续分支。
        if (cardId === "") return;
        event.preventDefault();
        void agent.decide(cardId, "cancel", "");
        return;
      case "close-reference-menu":
        // #106 目标形态 2：Esc 只收菜单，不打断、不撤卡、不关设置浮层。
        event.preventDefault();
        reference.close();
        return;
      case "close-find-replace":
        // Ctrl+F 面板：Esc 只关面板，不打断查询、不撤卡、不碰别的浮层。
        event.preventDefault();
        findReplace.close();
        return;
      case "close-skin-overlay":
        // 皮肤浮层：Esc 只收最外那一层（预览优先于对比栏），**不关皮肤广场那一页**。
        // 关掉整页是「回到对话」那枚钮与左栏导航的事；把两者混成一次 Esc，
        // 用户退掉预览的同时把正在挑的那一页也没了（5-㊷）。
        event.preventDefault();
        skins.closeTopLayer();
        return;
      case "close-overlay":
        event.preventDefault();
        layout.showWorkspace();
        return;
      case "interrupt":
        event.preventDefault();
        void agent.stop();
        return;
      case "none":
        return; // 无动作：一个 preventDefault 都不做，把键还给浏览器。
      default: {
        const unhandled: never = action; // 评审 X3：穷尽性守卫（与 G1 同律）——新 EscapeAction 没接线 ⇒ 编译失败，不是静默死键。
        return unhandled;
      }
    }
  }

  function dispatch(
    event: KeyboardEvent,
    action: HotkeyAction,
    targets: KeyTargets,
    tabIndex?: number,
    panel?: PanelShortcutId
  ): void {
    if (action === "submit" || action === "newline" || action === "queue") {
      // 输入值的真身在 store.composerDrafts（F-A 前置）：不再读/写 textarea 的 DOM value，
      // 也就不再需要「写 DOM 值 + 补发 input 事件」那套脆弱同步（挂进台账的那笔债在此还清）。
      const key = threadKeyFor(book.activeDocTab);
      const text = agent.draftOf(key);
      if (action === "newline") {
        event.preventDefault();
        agent.setDraft(key, `${text}\n`);
        return;
      }
      if (text.trim() === "") return;
      event.preventDefault();
      if (action === "submit") {
        agent.send(text.trim());
        // 与 ComposerBox 的发送出口读同一枚偏好（设置页「送出后清空输入框」）：
        // 关掉时两处都不清。键位不能自己另有一套——那样「按回车清空、点发送不清空」。
        if (clearComposerAfterSend()) {
          agent.clearDraft(key);
        }
        return;
      }
      // 评审 X1（数据丢失）：先问 store，拿到 accepted 才决定回写——队列满时 queueText 那句中文
      // 要用户重发的就是这些字，先清空等于把提示要保的字删了。回写值仍出自 utils/hotkey-queue。
      const accepted = agent.queueText(key, text);
      agent.setDraft(key, composerTextAfterQueue(text, accepted));
      return;
    }
    if (action === "approve-once" || action === "approve-session" || action === "approve-prefix") {
      const id = targets.card?.getAttribute(CARD_ID_ATTR) ?? "";
      if (id === "") return;
      event.preventDefault();
      // 与鼠标按钮调的是同一个 decide（护栏 4），键不引入新语义；映射表在 utils/hotkey-decisions，唯一一份。
      void agent.decide(id, APPROVAL_DECISIONS[action], "");
      return;
    }
    if (action === "deny-guidance") {
      // 护栏 3：只把焦点搬到该卡的说明框，绝不替用户提交。
      const guidance = targets.card?.querySelector<HTMLElement>(GUIDANCE_SELECTOR);
      if (!guidance) return;
      event.preventDefault();
      guidance.focus();
      return;
    }
    switch (action) {
      case "next-tab":
        event.preventDefault();
        book.cycleTab(1);
        return;
      case "prev-tab":
        event.preventDefault();
        book.cycleTab(-1);
        return;
      case "jump-tab":
        event.preventDefault();
        book.activateTab(tabIndex ?? 0);
        return;
      case "toggle-left":
        event.preventDefault();
        layout.togglePane("left");
        return;
      case "open-settings":
        event.preventDefault();
        layout.showSettings();
        return;
      case "open-book":
        // 与书架空态钮、输入卡书格同一条通路（store 的 pickAndOpen 是唯一真身，取消也有中文）。
        event.preventDefault();
        void book.pickAndOpen();
        return;
      case "open-palette":
        // #106 裁定 D1：这条动作的落点已从「第二块命令面板」改成输入卡里的行内引用菜单（唤起在 CenterColumn）。
        event.preventDefault();
        handlers.openPalette();
        return;
      case "open-find-replace":
        // Ctrl+F：文档内查找替换。唯一真身是 store.open()——每次按都把面板打开、复位查询。
        // 没有落点时**连标记都不落**：连 preventDefault 也不做，把这一键原样还给浏览器。
        // 这不是「吃掉键换一片空白」——在设置页里那个面板根本没有 DOM 落点（5-㊴ 实测）。
        // 判定放在装配层（App.vue 的 findReplaceHasLanding），与 openPalette 同一款理由。
        if (!handlers.findReplaceHasLanding()) return;
        event.preventDefault();
        findReplace.open();
        return;
      case "panel-shortcut":
        // Ctrl+Shift 族面板：判定层只认键，开合语义回调给装配层（App.vue 的 panelShortcut）。
        if (panel === undefined) return;
        event.preventDefault();
        handlers.panelShortcut(panel);
        return;
      case "reference-move-up":
      case "reference-move-down": {
        // ↑↓ 挪高亮：环绕与夹住由 utils/inline-reference-menu.ts 算，这里只派方向。
        // 滚动进视野不在这里做——那是 DOM，归菜单组件（本文件只碰 targets 已有的那一枚 textarea）。
        event.preventDefault();
        reference.move(action === "reference-move-down" ? 1 : -1);
        return;
      }
      case "reference-insert":
        // 菜单开着时 Enter 归菜单：`@` 把引用文本写进草稿、`/` 交唯一派发口执行，两条都不发送（裁定 D2）。
        // 光标与焦点由菜单组件按 caretRequest 口信摆好（deepwrite 在同一处用 nextTick 做这件事）。
        event.preventDefault();
        reference.select();
        return;
      case "delegated":
        escape(event, targets.card);
        return;
      case "none":
        return; // none（含被五条护栏拦下来的全部组合）：一个 preventDefault 都不做，把键还给浏览器。
      default: {
        const unhandled: never = action; // 评审 X3：穷尽性守卫（与 G1 同律）——新 HotkeyAction 没接线 ⇒ 编译失败，不是静默死键。
        return unhandled;
      }
    }
  }

  function onKey(event: KeyboardEvent): void {
    const mods: HotkeyMods = {
      ctrl: event.ctrlKey,
      shift: event.shiftKey,
      alt: event.altKey,
      meta: event.metaKey
    };
    const targets: KeyTargets = {
      composer: document.querySelector<HTMLTextAreaElement>(COMPOSER_SELECTOR),
      card: focusedCard()
    };
    const sources: HotkeyFocusSources = {
      eventTarget: elementOf(event.target),
      activeElement: elementOf(document.activeElement),
      composer: targets.composer,
      focusedCard: targets.card,
      turnRunning: runningNow(),
      isComposing: event.isComposing,
      hasBook: book.hasBook,
      tabCount: book.docTabs.length,
      referenceMenuIsOpen: reference.isOpen,
      // 发送键档每次按键重读：设置页改档即时生效，不用重启也不用刷新（与自动保存静默窗同一口径）。
      submitKey: loadSubmitKey(submitKeyPreferenceStorage())
    };
    const { action, tabIndex, panel } = resolveHotkey(deriveHotkeyFocus(sources), event.key, mods);
    dispatch(event, action, targets, tabIndex, panel);
  }

  onMounted(() => document.addEventListener("keydown", onKey));
  onBeforeUnmount(() => document.removeEventListener("keydown", onKey));
}
