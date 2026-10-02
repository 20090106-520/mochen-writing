// 薄壳：装全局唯一的 keydown 监听、把真 DOM 解成焦点源、把判定结果派到既有 store action。
// 键→动作的判断 100% 在 utils/hotkeys.ts，Esc 的三态裁决 100% 在 utils/escape-policy.ts，
// 焦点标志的推导 100% 在 utils/hotkey-focus.ts（裁定 G2：那三个文件才是可测的判定层）。
// 本文件不判断，只做「解析 DOM → 调纯函数 → 调 store」；全局 keydown 有且只有这里一处（裁定 G5）。
import { onBeforeUnmount, onMounted } from "vue";
import type { ProposalDecision } from "@mochen/contracts";
import { resolveHotkey, type HotkeyAction, type HotkeyMods } from "../utils/hotkeys";
import { deriveHotkeyFocus, type HotkeyFocusSources } from "../utils/hotkey-focus";
import { resolveEscape } from "../utils/escape-policy";
import { threadKeyFor, useAgentStore } from "../stores/useAgentStore";
import { useBookStore } from "../stores/useBookStore";
import { useLayoutStore } from "../stores/layoutStore";

export interface HotkeyHandlers {
  openPalette(): void;
}

/**
 * 裁定 G1：HotkeyAction 的三个审批值与 contracts 的 ProposalDecision **不同名**
 * （`patch.ts` 的 PROPOSAL_DECISIONS 是 accept-*）。映射只此一份，类型写成
 * `Record<联合类型, ProposalDecision>` ⇒ 契约改名/加成员时这里直接编译失败，
 * 而不是运行时把非法裁决值送到主进程、审批悄悄不生效。下面唯一消费点是查表，不写三元链、不做 cast。
 */
const APPROVAL_DECISIONS: Record<
  "approve-once" | "approve-session" | "approve-prefix",
  ProposalDecision
> = {
  "approve-once": "accept-once",
  "approve-session": "accept-session",
  "approve-prefix": "accept-prefix"
};

const COMPOSER_SELECTOR = "[data-mochen-composer]";
const CARD_SELECTOR = "[data-proposal-card]";
const GUIDANCE_SELECTOR = "[data-guidance]";

export function useGlobalHotkeys(handlers: HotkeyHandlers): void {
  const agent = useAgentStore();
  const book = useBookStore();
  const layout = useLayoutStore();

  function elementOf(target: EventTarget | null): HTMLElement | null {
    return target instanceof HTMLElement ? target : null;
  }

  function composerOf(): HTMLTextAreaElement | null {
    return document.querySelector<HTMLTextAreaElement>(COMPOSER_SELECTOR);
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

  function sourcesOf(event: KeyboardEvent): HotkeyFocusSources {
    return {
      eventTarget: elementOf(event.target),
      activeElement: elementOf(document.activeElement),
      composer: composerOf(),
      focusedCard: focusedCard(),
      turnRunning: runningNow(),
      isComposing: event.isComposing,
      hasBook: book.rootPath !== null,
      tabCount: book.docTabs.length
    };
  }

  /**
   * 写 composer 的 DOM 值之后必须补一个 input 事件：ComposerBox 用 v-model，只听 input。
   * 不补的话 ref 里还留着旧文本，下一次重渲染会把已发走/已排队的字吐回输入框，发送按钮也一直是亮的。
   */
  function setComposerText(el: HTMLTextAreaElement, value: string): void {
    el.value = value;
    el.dispatchEvent(new Event("input"));
  }

  function escape(event: KeyboardEvent): void {
    const card = focusedCard();
    const guidance = card?.querySelector<HTMLTextAreaElement>(GUIDANCE_SELECTOR) ?? null;
    const cardId = card?.getAttribute("data-proposal-id") ?? "";
    // 三态裁决（审批卡 > 打断 > 无动作）全在 resolveEscape，这里不复制口径。
    const action = resolveEscape({
      hasFocusedProposal: card !== null,
      focusedProposalPending: card?.getAttribute("data-proposal-status") === "pending",
      guidanceIsDirty: (guidance?.value.trim() ?? "") !== "",
      turnRunning: runningNow()
    });
    // 卡内的 Esc 由 ProposalCard 自己处理并 stopPropagation，冒到这里的一律是「卡外」的 Esc。
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
    if (action === "interrupt") {
      event.preventDefault();
      void agent.stop();
    }
  }

  function dispatch(event: KeyboardEvent, action: HotkeyAction, tabIndex?: number): void {
    if (action === "submit" || action === "newline" || action === "queue") {
      const el = composerOf();
      const text = el?.value ?? "";
      if (action === "newline") {
        event.preventDefault();
        if (el) setComposerText(el, `${el.value}\n`);
        return;
      }
      if (text.trim() === "") return;
      event.preventDefault();
      if (el) setComposerText(el, "");
      if (action === "submit") agent.send(text.trim());
      // queueText 自己 trim，这里传原文（spec §5.1：trim 的口径归 store 一处）。
      else agent.queueText(threadKeyFor(book.activeDocTab), text);
      return;
    }
    if (action === "approve-once" || action === "approve-session" || action === "approve-prefix") {
      const id = focusedCard()?.getAttribute("data-proposal-id") ?? "";
      if (id === "") return;
      event.preventDefault();
      // 与鼠标按钮调的是同一个 decide（护栏 4），键不引入新语义。
      void agent.decide(id, APPROVAL_DECISIONS[action], "");
      return;
    }
    if (action === "deny-guidance") {
      // 护栏 3：只把焦点搬到该卡的说明框，绝不替用户提交。
      const guidance = focusedCard()?.querySelector<HTMLTextAreaElement>(GUIDANCE_SELECTOR);
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
      case "open-palette":
        event.preventDefault();
        handlers.openPalette();
        return;
      case "delegated":
        escape(event);
        return;
      default:
        // none（含被五条护栏拦下来的全部组合）：一个 preventDefault 都不做，把键还给浏览器。
        return;
    }
  }

  function onKey(event: KeyboardEvent): void {
    const mods: HotkeyMods = {
      ctrl: event.ctrlKey,
      shift: event.shiftKey,
      alt: event.altKey,
      meta: event.metaKey
    };
    const { action, tabIndex } = resolveHotkey(
      deriveHotkeyFocus(sourcesOf(event)),
      event.key,
      mods
    );
    dispatch(event, action, tabIndex);
  }

  onMounted(() => document.addEventListener("keydown", onKey));
  onBeforeUnmount(() => document.removeEventListener("keydown", onKey));
}
