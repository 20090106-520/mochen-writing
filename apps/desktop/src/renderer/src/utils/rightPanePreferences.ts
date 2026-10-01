// 源自 deepwrite（Apache-2.0），原样移植：https://github.com/20090106-520/deepwrite
// 仅删去其按创作阶段记忆右栏宽度的 rightPanePreferenceKey（本项目无该功能），存储键换为 mochen 前缀。

export const RIGHT_PANE_PREFERENCES_STORAGE_KEY = "mochen:right-pane-preferences:v1";
export const RIGHT_PANE_MIN_WIDTH = 320;
// Persist any safe width; layoutStore clamps it to the available window space.
export const RIGHT_PANE_MAX_WIDTH = Number.MAX_SAFE_INTEGER;

export interface RightPanePreferences {
  widths: Record<string, number>;
}

interface RightPanePreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const DEFAULT_RIGHT_PANE_PREFERENCES: RightPanePreferences = { widths: {} };

function isValidWidth(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= RIGHT_PANE_MIN_WIDTH &&
    value <= RIGHT_PANE_MAX_WIDTH
  );
}

export function parseRightPanePreferences(storedValue: string | null): RightPanePreferences {
  if (!storedValue) return { widths: {} };
  try {
    const parsed: unknown = JSON.parse(storedValue);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { widths: {} };
    }
    const candidate = parsed as Record<string, unknown>;
    if (
      candidate.version !== 1 ||
      !candidate.widths ||
      typeof candidate.widths !== "object" ||
      Array.isArray(candidate.widths)
    ) {
      return { widths: {} };
    }
    const entries = Object.entries(candidate.widths as Record<string, unknown>);
    if (entries.some(([key, width]) => key.trim().length === 0 || !isValidWidth(width))) {
      return { widths: {} };
    }
    return { widths: Object.fromEntries(entries) as Record<string, number> };
  } catch {
    return { widths: {} };
  }
}

export function loadRightPanePreferences(
  storage: Pick<RightPanePreferencesStorage, "getItem">
): RightPanePreferences {
  try {
    return parseRightPanePreferences(storage.getItem(RIGHT_PANE_PREFERENCES_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_RIGHT_PANE_PREFERENCES, widths: {} };
  }
}

export function saveRightPanePreferences(
  storage: Pick<RightPanePreferencesStorage, "setItem">,
  preferences: RightPanePreferences
): boolean {
  try {
    storage.setItem(
      RIGHT_PANE_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ version: 1, widths: preferences.widths })
    );
    return true;
  } catch {
    return false;
  }
}
