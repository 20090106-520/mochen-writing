/**
 * 编辑器行距的持久化（2026-10-05 设置页「写作」新增）。
 *
 * 现状：正文行距写死在 styles/editor-pane.css 的 `line-height: 1.95`；写长文的人
 * 对行距感受差异很大，这一档偏好把它交给用户。应用方式：DocumentPane 把值写进
 * `--editor-leading` 变量，CSS 那一行改成 `var(--editor-leading, 1.95)`——
 * 变量缺席（组件没挂偏好）时就是原值，样式表不依赖脚本。
 * 与 autosave-preference 同一类本机偏好：走 localStorage，零新 IPC。
 *
 * 默认档 1.95 与原样式同值：没有这份偏好时排版一字不变。
 */
export const EDITOR_LEADING_PREFERENCE_KEY = "mochen.editorLeading";

export interface EditorLeadingPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const EDITOR_LEADING_OPTIONS = [1.75, 1.95, 2.2] as const;

export type EditorLeading = (typeof EDITOR_LEADING_OPTIONS)[number];

/** 默认档与原样式同值。 */
export const EDITOR_LEADING_DEFAULT: EditorLeading = 1.95;

const EDITOR_LEADING_LABELS: Record<EditorLeading, string> = {
  1.75: "紧凑",
  1.95: "标准",
  2.2: "疏朗"
};

const EDITOR_LEADING_NOTES: Record<EditorLeading, string> = {
  1.75: "行距 1.75，一屏塞得下更多行；扫读长章节时少滚两下。",
  1.95: "行距 1.95；与原版式一致。",
  2.2: "行距 2.2，行间留白最多；慢改稿时视线不容易串行。"
};

export interface EditorLeadingOption {
  value: EditorLeading;
  label: string;
  note: string;
}

export function editorLeadingOptions(): EditorLeadingOption[] {
  return EDITOR_LEADING_OPTIONS.map((value) => ({
    value,
    label: EDITOR_LEADING_LABELS[value],
    note: EDITOR_LEADING_NOTES[value]
  }));
}

export function loadEditorLeading(storage: EditorLeadingPreferenceStorage | null): EditorLeading {
  if (storage === null) return EDITOR_LEADING_DEFAULT;
  const raw = storage.getItem(EDITOR_LEADING_PREFERENCE_KEY);
  if (raw === null || raw.trim() === "") return EDITOR_LEADING_DEFAULT;
  const parsed = Number(raw);
  return (EDITOR_LEADING_OPTIONS as readonly number[]).includes(parsed)
    ? (parsed as EditorLeading)
    : EDITOR_LEADING_DEFAULT;
}

export function saveEditorLeading(
  storage: EditorLeadingPreferenceStorage,
  value: EditorLeading
): void {
  storage.setItem(EDITOR_LEADING_PREFERENCE_KEY, String(value));
}

/** 浏览器侧取存储：没有 window / localStorage 时返回 null（调用方退回默认档，不抛错）。 */
export function editorLeadingPreferenceStorage(): EditorLeadingPreferenceStorage | null {
  if (typeof window === "undefined") return null;
  try {
    // window 在但 localStorage 缺席（测试环境 / 隐私模式）时拿到的是 undefined，必须归一成 null。
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}
