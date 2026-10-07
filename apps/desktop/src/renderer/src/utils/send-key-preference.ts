/**
 * 对话发送键的持久化（2026-10-05 设置页新增）。
 *
 * 现状：键位表把「Enter 发送 / Shift+Enter 换行」写死在 utils/hotkeys 的裁决里；
 * 有人习惯把回车留给换行、用 Ctrl+Enter 发送（聊天工具的常见第二档），这一档偏好
 * 把它交给用户。判定仍是纯函数：HotkeyFocus 多一枚 submitKey，裁决链不读 DOM。
 * 与 web-search-preference 同一类本机偏好：走 localStorage，零新 IPC。
 *
 * 默认档 "enter" 与原行为同值：没有这份偏好时键位一字不变。
 */
export const SUBMIT_KEY_PREFERENCE_KEY = "mochen.submitKey";

export interface SubmitKeyPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SUBMIT_KEY_OPTIONS = ["enter", "ctrl-enter"] as const;

export type SubmitKey = (typeof SUBMIT_KEY_OPTIONS)[number];

/** 默认档与原键位表同值：裸 Enter 发送、Shift+Enter 换行。 */
export const SUBMIT_KEY_DEFAULT: SubmitKey = "enter";

const SUBMIT_KEY_LABELS: Record<SubmitKey, string> = {
  enter: "Enter 发送",
  "ctrl-enter": "Ctrl+Enter 发送"
};

const SUBMIT_KEY_NOTES: Record<SubmitKey, string> = {
  enter: "回车直接发送，Shift+Enter 换行；与现在一致。",
  "ctrl-enter": "回车只换行，Ctrl+Enter 才发送；习惯把回车留给段落的人选这档。"
};

export interface SubmitKeyOption {
  value: SubmitKey;
  label: string;
  note: string;
}

export function submitKeyOptions(): SubmitKeyOption[] {
  return SUBMIT_KEY_OPTIONS.map((value) => ({
    value,
    label: SUBMIT_KEY_LABELS[value],
    note: SUBMIT_KEY_NOTES[value]
  }));
}

export function loadSubmitKey(storage: SubmitKeyPreferenceStorage | null): SubmitKey {
  if (storage === null) return SUBMIT_KEY_DEFAULT;
  const raw = storage.getItem(SUBMIT_KEY_PREFERENCE_KEY);
  // 空串与坏值一样退默认档：提交键没有「关」这一档，不能把坏值吞成某个行为。
  if (raw === null || raw.trim() === "") return SUBMIT_KEY_DEFAULT;
  return (SUBMIT_KEY_OPTIONS as readonly string[]).includes(raw)
    ? (raw as SubmitKey)
    : SUBMIT_KEY_DEFAULT;
}

export function saveSubmitKey(storage: SubmitKeyPreferenceStorage, value: SubmitKey): void {
  storage.setItem(SUBMIT_KEY_PREFERENCE_KEY, value);
}

/** 浏览器侧取存储：没有 window / localStorage 时返回 null（调用方退回默认档，不抛错）。 */
export function submitKeyPreferenceStorage(): SubmitKeyPreferenceStorage | null {
  if (typeof window === "undefined") return null;
  try {
    // window 在但 localStorage 缺席（测试环境 / 隐私模式）时拿到的是 undefined，必须归一成 null。
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}
