/**
 * 面板开合态的落盘（2026-11-20 · 主线第一刀）。
 *
 * 【为什么要有这一份】右栏宽度早就有记忆位（`utils/rightPanePreferences.ts` 的 widths），
 * 但**开合态**从来没有：用户把右栏收起来（或者展开），关掉应用再开，两栏都回到默认，
 * 于是每次开工都要重摆一遍布局——写长篇的人一天要摆好几次。
 *
 * 【三枚字段各管一件事】
 *   - `leftCollapsed`：左栏收起来了没有。左栏没有自动策略（不随视口变），所以这一枚
 *     **纯粹是用户意图**，存下来就该照办。
 *   - `rightCollapsed`：右栏收起来了没有。
 *   - `rightPaneManuallyToggled`：用户**自己**动过右栏没有（手动闸门）。
 *     这一枚是右栏那两枚的前提：右栏还有一个自动策略（窄窗自动收、没书自动收），
 *     用户没动过时听自动的；动过之后自动策略交权（既有纪律：只收不展、手动优先）。
 *     所以这一枚不记下来，下次启动就会把"用户特意收起来的右栏"又推回去。
 *
 * 与宽度的记忆**刻意分成两份存储**：宽度是"这一格该多宽"，开合是"这一格该不该在"。
 * 两件事、两把钥匙，放一份里将来改一件要牵动另一件。
 */

/** 存储键。mochen 前缀，与其余偏好同族。 */
export const PANE_LAYOUT_PREFERENCES_STORAGE_KEY = "mochen:pane-layout:v1";

/** 三枚开合态。 */
export interface PaneLayoutPreferences {
  /** 左栏收起来了没有。 */
  leftCollapsed: boolean;
  /** 右栏收起来了没有。 */
  rightCollapsed: boolean;
  /** 用户自己动过右栏没有（手动闸门）：动过之后自动策略交权。 */
  rightPaneManuallyToggled: boolean;
}

/** 默认值 = 「什么都没动过」。左栏展开；右栏那一枚由自动策略按视口判定。 */
export const DEFAULT_PANE_LAYOUT_PREFERENCES: PaneLayoutPreferences = {
  leftCollapsed: false,
  rightCollapsed: false,
  rightPaneManuallyToggled: false
};

interface PaneLayoutPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 一枚坏值（不是布尔）回落默认，其余照旧——不许因为一枚坏了把整份丢掉。 */
function boolOr(raw: unknown, fallback: boolean): boolean {
  return typeof raw === "boolean" ? raw : fallback;
}

/**
 * 读一份已存的开合态。
 *
 * 版本号不对（不是 1）⇒ 整份当默认：那是另一套形状的记录，不该硬读。
 * 版本对但某一枚坏了 ⇒ **只回落那一枚**：三枚各管各的事，坏一枚不该连累另两枚。
 */
export function parsePaneLayoutPreferences(storedValue: string | null): PaneLayoutPreferences {
  if (!storedValue) return { ...DEFAULT_PANE_LAYOUT_PREFERENCES };
  try {
    const parsed: unknown = JSON.parse(storedValue);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULT_PANE_LAYOUT_PREFERENCES };
    }
    const candidate = parsed as Record<string, unknown>;
    if (candidate.version !== 1) return { ...DEFAULT_PANE_LAYOUT_PREFERENCES };
    return {
      leftCollapsed: boolOr(candidate.leftCollapsed, DEFAULT_PANE_LAYOUT_PREFERENCES.leftCollapsed),
      rightCollapsed: boolOr(
        candidate.rightCollapsed,
        DEFAULT_PANE_LAYOUT_PREFERENCES.rightCollapsed
      ),
      rightPaneManuallyToggled: boolOr(
        candidate.rightPaneManuallyToggled,
        DEFAULT_PANE_LAYOUT_PREFERENCES.rightPaneManuallyToggled
      )
    };
  } catch {
    return { ...DEFAULT_PANE_LAYOUT_PREFERENCES };
  }
}

/** 从存储里读一份；读不到（没有窗口 / 存储坏了）就当默认值。 */
export function loadPaneLayoutPreferences(
  storage: Pick<PaneLayoutPreferencesStorage, "getItem">
): PaneLayoutPreferences {
  try {
    return parsePaneLayoutPreferences(storage.getItem(PANE_LAYOUT_PREFERENCES_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_PANE_LAYOUT_PREFERENCES };
  }
}

/** 写一份；写不进去（配额满了 / 隐私模式）就如实返回 false，不假装存上了。 */
export function savePaneLayoutPreferences(
  storage: Pick<PaneLayoutPreferencesStorage, "setItem">,
  preferences: PaneLayoutPreferences
): boolean {
  try {
    storage.setItem(
      PANE_LAYOUT_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        leftCollapsed: preferences.leftCollapsed,
        rightCollapsed: preferences.rightCollapsed,
        rightPaneManuallyToggled: preferences.rightPaneManuallyToggled
      })
    );
    return true;
  } catch {
    return false;
  }
}
