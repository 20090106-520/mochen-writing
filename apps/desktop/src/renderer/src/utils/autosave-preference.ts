/**
 * 自动保存静默窗的持久化（2026-10-05 设置页新增，用户裁定「设置功能太少」的补课之一）。
 *
 * 现状：`useBookStore.AUTO_SAVE_DELAY_MS` 写死 2000ms，想关都关不掉；这一档偏好把
 * 「停多久算安静」交给用户，0 就是关掉自动保存（只剩手动保存一条通路）。
 * 与 web-search-preference 同一类本机偏好：走 localStorage，零新 IPC；
 * 落盘真身仍是 saveActive（自动与手动同一条指纹链），偏好只管排程等多久。
 *
 * 档位值就是毫秒数（设置页 segment 的 value 直接用），坏值/不可用存储一律退回默认档。
 */
export const AUTOSAVE_PREFERENCE_KEY = "mochen.autosaveDelay";

export interface AutosavePreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 默认档与原常量同值：没有这份偏好时行为一字不变。 */
export const AUTOSAVE_DEFAULT_DELAY_MS = 2000;

/** 0 = 关。档位集是设置页 segment 的唯一名单，store 与面板都从这里取，不手抄第二份。 */
export const AUTOSAVE_DELAY_OPTIONS = [0, 1000, 2000, 5000] as const;

export type AutosaveDelay = (typeof AUTOSAVE_DELAY_OPTIONS)[number];

const AUTOSAVE_DELAY_LABELS: Record<AutosaveDelay, string> = {
  0: "关",
  1000: "1 秒",
  2000: "2 秒",
  5000: "5 秒"
};

const AUTOSAVE_DELAY_NOTES: Record<AutosaveDelay, string> = {
  0: "不自动保存；只有手动保存（保存按钮 / Ctrl S）会落盘。",
  1000: "停手一秒就存，落盘最勤；机器慢或稿子很大时选慢一档。",
  2000: "停手两秒就存；与原默认一致。",
  5000: "停手五秒才存，打断感最小；断电丢稿的窗口也最大。"
};

export interface AutosaveOption {
  value: AutosaveDelay;
  label: string;
  note: string;
}

export function autosaveOptions(): AutosaveOption[] {
  return AUTOSAVE_DELAY_OPTIONS.map((value) => ({
    value,
    label: AUTOSAVE_DELAY_LABELS[value],
    note: AUTOSAVE_DELAY_NOTES[value]
  }));
}

export function loadAutosaveDelay(storage: AutosavePreferenceStorage | null): AutosaveDelay {
  if (storage === null) return AUTOSAVE_DEFAULT_DELAY_MS;
  const raw = storage.getItem(AUTOSAVE_PREFERENCE_KEY);
  // 空串不是「关」：Number("") === 0 会把坏值吞成关掉自动保存，必须先拦下退回默认档。
  if (raw === null || raw.trim() === "") return AUTOSAVE_DEFAULT_DELAY_MS;
  const parsed = Number(raw);
  return (AUTOSAVE_DELAY_OPTIONS as readonly number[]).includes(parsed)
    ? (parsed as AutosaveDelay)
    : AUTOSAVE_DEFAULT_DELAY_MS;
}

export function saveAutosaveDelay(storage: AutosavePreferenceStorage, delay: AutosaveDelay): void {
  storage.setItem(AUTOSAVE_PREFERENCE_KEY, String(delay));
}

/** 浏览器侧取存储：没有 window / localStorage 时返回 null（调用方退回默认档，不抛错）。 */
export function autosavePreferenceStorage(): AutosavePreferenceStorage | null {
  if (typeof window === "undefined") return null;
  try {
    // window 在但 localStorage 缺席（测试环境 / 隐私模式）时拿到的是 undefined，必须归一成 null。
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}
