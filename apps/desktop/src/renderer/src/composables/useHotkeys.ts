// 薄壳：装全局唯一的 keydown 监听、把真 DOM 解成焦点源、把判定结果派到既有 store action；本文件不判断。
// 判断层各有其主：键→动作 utils/hotkeys.ts、Esc 四态 utils/escape-policy.ts、焦点推导 utils/hotkey-focus.ts（裁定 G2）；
// 审批映射 utils/hotkey-decisions（评审 X2）、DOM 标记名 utils/hotkey-markers（评审 X4a）——单实现模块，只消费。
// 全局 keydown 有且只有这里一处（裁定 G5）。
import { onBeforeUnmount, onMounted } from "vue";
import { resolveHotkey, type HotkeyAction, type HotkeyMods } from "../utils/hotkeys";
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
import { threadKeyFor, useAgentStore } from "../stores/useAgentStore";
import { useBookStore } from "../stores/useBookStore";
import { useLayoutStore } from "../stores/layoutStore";

export interface HotkeyHandlers {
  openPalette(): void;
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

  /** 写 composer 的 DOM 值后必须补发 input：v-model 只听 input，不补则重渲染（running 变真）会把已发走的字吐回输入框。
   *  脆弱点：这条同步链赌的是 v-model 的默认 input 事件——改 .lazy（改听 change）或 .trim（回写被修剪）就不再同源；
   *  durable 方案（composer 草稿进 store）进台账，不在本片做。 */
  function setComposerText(el: HTMLTextAreaElement, value: string): void {
    el.value = value;
    el.dispatchEvent(new Event("input"));
  }

  function escape(event: KeyboardEvent, card: HTMLElement | null): void {
    const guidance = card?.querySelector<HTMLTextAreaElement>(GUIDANCE_SELECTOR) ?? null;
    const cardId = card?.getAttribute(CARD_ID_ATTR) ?? "";
    // 四态裁决（说明框保字 > 取消该条 > 收浮层 > 打断 > 无动作）全在 resolveEscape，这里不复制口径。
    const action = resolveEscape({
      hasFocusedProposal: card !== null,
      focusedProposalPending: card?.getAttribute(CARD_STATUS_ATTR) === "pending",
      guidanceIsDirty: (guidance?.value.trim() ?? "") !== "",
      turnRunning: runningNow(),
      // 唯一喂入点：设置浮层的真身是 layout.currentView === "settings"（设计决定 2）。
      settingsIsOpen: layout.currentView === "settings"
    });
    if (action === "keep-guidance") {
      event.preventDefault();
      guidance?.blur();
      return;
    }
    if (action === "cancel-proposal" && cardId !== "") {
      event.preventDefault();
      void agent.decide(cardId, "cancel", "");
      return;
    }
    if (action === "close-overlay") {
      event.preventDefault();
      layout.showWorkspace();
      return;
    }
    if (action === "interrupt") {
      event.preventDefault();
      void agent.stop();
    }
  }

  function dispatch(
    event: KeyboardEvent,
    action: HotkeyAction,
    targets: KeyTargets,
    tabIndex?: number
  ): void {
    if (action === "submit" || action === "newline" || action === "queue") {
      const el = targets.composer;
      const text = el?.value ?? "";
      if (action === "newline") {
        event.preventDefault();
        if (el) setComposerText(el, `${el.value}\n`);
        return;
      }
      if (text.trim() === "") return;
      event.preventDefault();
      if (action === "submit") {
        if (el) setComposerText(el, "");
        agent.send(text.trim());
        return;
      }
      // 评审 X1（数据丢失）：**先**问 store，拿到 accepted **才**决定回写——队列满时 queueText 那句中文
      // 要用户重发的就是这些字，先清空等于把提示要保的字删了。回写值出自 utils/hotkey-queue（可测纯函数）。
      const accepted = agent.queueText(threadKeyFor(book.activeDocTab), text);
      if (el) setComposerText(el, composerTextAfterQueue(text, accepted));
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
        layout.showSettings("general");
        return;
      case "open-book":
        // 与左栏「打开作品目录」按钮同一条通路（store 的 pickAndOpen 是唯一真身，取消也有中文）。
        event.preventDefault();
        void book.pickAndOpen();
        return;
      case "open-palette":
        event.preventDefault();
        handlers.openPalette();
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
      hasBook: book.rootPath !== null,
      tabCount: book.docTabs.length
    };
    const { action, tabIndex } = resolveHotkey(deriveHotkeyFocus(sources), event.key, mods);
    dispatch(event, action, targets, tabIndex);
  }

  onMounted(() => document.addEventListener("keydown", onKey));
  onBeforeUnmount(() => document.removeEventListener("keydown", onKey));
}
