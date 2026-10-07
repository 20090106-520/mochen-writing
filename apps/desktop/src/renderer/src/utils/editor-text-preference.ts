/**
 * 编辑器正文呈现的两档本机偏好（2026-10-05 写作页新增）。
 *
 * 正文字号：样式表把正文写死在 `1.07143rem`（14px 基准 ≈ 15px），写作页给三档；
 * 正文字体外观页已有五档（song/kai/fangsong/sans/yuan，走 appearance:save），
 * 这里**不碰**它——同一状态只许一份实现；拼写检查：textarea 写死 `spellcheck="false"`，
 * 给一档开关，默认关=原行为。
 * 与 autosave-preference 同一类本机偏好：走 localStorage，零新 IPC。
 * 应用通路：DocumentPane 挂载时读一次（设置中心与工作区互斥挂载，回来必然重挂），
 * 值走 `--editor-font-size` 变量与 `:spellcheck` 绑定，CSS 变量缺席即原值。
 */
export const EDITOR_SIZE_STORAGE_KEY = "mochen.editorFontSize";

export interface EditorTextPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const EDITOR_SIZE_OPTIONS = [15, 17, 19] as const;

export type EditorFontSize = (typeof EDITOR_SIZE_OPTIONS)[number];

/** 默认档与原样式同值（1.07143rem × 14px 基准 ≈ 15px）：没有这份偏好时排版一字不变。 */
export const EDITOR_SIZE_DEFAULT: EditorFontSize = 15;

const EDITOR_SIZE_LABELS: Record<EditorFontSize, string> = {
  15: "标准",
  17: "大",
  19: "特大"
};

const EDITOR_SIZE_NOTES: Record<EditorFontSize, string> = {
  15: "15px；与原版式一致。",
  17: "17px，字大一行，长时间写不容易累眼。",
  19: "19px，一屏行数最少；朗读改稿时最舒服。"
};

export interface EditorSizeOption {
  value: EditorFontSize;
  label: string;
  note: string;
}

export function editorSizeOptions(): EditorSizeOption[] {
  return EDITOR_SIZE_OPTIONS.map((value) => ({
    value,
    label: EDITOR_SIZE_LABELS[value],
    note: EDITOR_SIZE_NOTES[value]
  }));
}

export function loadEditorSize(storage: EditorTextPreferenceStorage | null): EditorFontSize {
  if (storage === null) return EDITOR_SIZE_DEFAULT;
  const raw = storage.getItem(EDITOR_SIZE_STORAGE_KEY);
  if (raw === null || raw.trim() === "") return EDITOR_SIZE_DEFAULT;
  const parsed = Number(raw);
  return (EDITOR_SIZE_OPTIONS as readonly number[]).includes(parsed)
    ? (parsed as EditorFontSize)
    : EDITOR_SIZE_DEFAULT;
}

export function saveEditorSize(storage: EditorTextPreferenceStorage, value: EditorFontSize): void {
  storage.setItem(EDITOR_SIZE_STORAGE_KEY, String(value));
}

/** 拼写检查：textarea 原本写死 false，这档只回答「开 / 关」，默认关=原行为。 */
export const EDITOR_SPELLCHECK_STORAGE_KEY = "mochen.editorSpellcheck";

export const EDITOR_SPELLCHECK_DEFAULT = false;

export function loadEditorSpellcheck(storage: EditorTextPreferenceStorage | null): boolean {
  if (storage === null) return EDITOR_SPELLCHECK_DEFAULT;
  return storage.getItem(EDITOR_SPELLCHECK_STORAGE_KEY) === "true";
}

export function saveEditorSpellcheck(storage: EditorTextPreferenceStorage, value: boolean): void {
  if (value) storage.setItem(EDITOR_SPELLCHECK_STORAGE_KEY, "true");
  else storage.removeItem(EDITOR_SPELLCHECK_STORAGE_KEY);
}

/** 浏览器侧取存储：没有 window / localStorage 时返回 null（调用方退回默认档，不抛错）。 */
export function editorTextPreferenceStorage(): EditorTextPreferenceStorage | null {
  if (typeof window === "undefined") return null;
  try {
    // window 在但 localStorage 缺席（测试环境 / 隐私模式）时拿到的是 undefined，必须归一成 null。
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}
