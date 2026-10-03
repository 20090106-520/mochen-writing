/**
 * 焦点标志的组装层（裁定 G2）。
 *
 * 为什么单独立一个 utils 文件：composer 本身就是一个 `<TEXTAREA>`，接线处若把「焦点在文本框里」
 * 直接按标签判，composer 有焦点时 textInputIsFocused 也会是真，而 Task 6 裁定 F1 要求
 * `Tab → queue` 必须 `!textInputIsFocused` —— 排队键会永远按不出去，而且 DOM 代码没有自动化测试能发现。
 * 故标志的**推导**放在这里：入参是已经解析好的普通对象/布尔值，鸭子类型只碰
 * tagName / isContentEditable / getAttribute / value，绝不 `instanceof HTMLElement`，
 * 于是这条互斥不变式可测（见 hotkey-focus.test.ts）。useHotkeys.ts 只负责把真 DOM 解成这些源。
 */
import { CARD_STATUS_ATTR } from "./hotkey-markers";
import { type HotkeyFocus } from "./hotkeys";

/** 焦点判定要读的节点成员——真实 HTMLElement 天然满足，测试里传普通对象即可。 */
export interface FocusSource {
  readonly tagName: string;
  readonly isContentEditable: boolean;
  getAttribute(name: string): string | null;
}

/** composer 额外要读文本内容（textarea 受控于 store.composerDrafts；但 IME 组合窗口内 DOM 值可能领先或滞后于 store，取值一律以 store 为准，这里读 value 只用来判断「是不是文本框」）。 */
export interface ComposerSource extends FocusSource {
  readonly value: string;
}

export interface HotkeyFocusSources {
  /** keydown 的 event.target（非元素节点由接线处解成 null）。 */
  readonly eventTarget: FocusSource | null;
  /** document.activeElement（同上）。 */
  readonly activeElement: FocusSource | null;
  /** `[data-mochen-composer]` 那一枚 textarea，不存在则 null。 */
  readonly composer: ComposerSource | null;
  /** 聚焦元素 `closest("[data-proposal-card]")` 的那张卡，没有则 null。 */
  readonly focusedCard: FocusSource | null;
  readonly turnRunning: boolean;
  readonly isComposing: boolean;
  readonly hasBook: boolean;
  readonly tabCount: number;
}

const TEXT_TAGS: readonly string[] = ["TEXTAREA", "INPUT", "SELECT"];

/** contenteditable 与三类表单元素都算「文本输入」。 */
function isTextField(node: FocusSource | null): boolean {
  if (node === null) return false;
  if (node.isContentEditable) return true;
  return TEXT_TAGS.includes(node.tagName.toUpperCase());
}

/**
 * 产出 utils/hotkeys.ts 的 HotkeyFocus（形状只有一份定义，这里不重抄字段）。
 * 不变式：composerIsFocused 与 textInputIsFocused 互斥——composer 有焦点时后者必须为假。
 */
export function deriveHotkeyFocus(sources: HotkeyFocusSources): HotkeyFocus {
  const composer = sources.composer;
  const composerIsFocused =
    composer !== null && (sources.eventTarget === composer || sources.activeElement === composer);
  const card = sources.focusedCard;
  return {
    composerIsFocused,
    composerHasText: (composer?.value.trim() ?? "") !== "",
    // 「除 composer 之外的文本输入有焦点」——裁定 G2 的字面口径。
    textInputIsFocused:
      !composerIsFocused &&
      (isTextField(sources.eventTarget) || isTextField(sources.activeElement)),
    proposalIsFocused: card !== null,
    proposalIsPending: card?.getAttribute(CARD_STATUS_ATTR) === "pending",
    turnRunning: sources.turnRunning,
    isComposing: sources.isComposing,
    hasBook: sources.hasBook,
    tabCount: sources.tabCount
  };
}
