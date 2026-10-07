/**
 * 正文列宽（每行字数）的持久化（2026-10-06 设置页「写作」新增）。
 *
 * 现状：正文那一格铺满整栏——`styles/editor-pane.css` 的 `.editor-textarea-wrap` 只写了
 * `display: grid`，没有 max-width，右栏一宽每行字数就跟着涨。改长稿时眼睛要从行首追到行尾，
 * 一行三十来字才舒服，这一档把「一行铺多宽」交给用户。
 * 应用方式与行距/字号同一路：DocumentPane 把值写进 `.editor-textarea-wrap` 的 `--editor-measure`
 * 变量，CSS 那一行改成 `max-width: var(--editor-measure, none)`——变量缺席（组件没挂偏好）时
 * 是 none，与原样式「不设上限」逐字同义，样式表不依赖脚本。
 *
 * 挂在 wrap 上而不是 textarea 上：查找高亮 mirror 是 `position: absolute; inset: 0` 贴着 wrap 的，
 * 列宽一变若只收窄 textarea，两层会错位，高亮就对不上行。
 *
 * 档位值直接是 CSS 长度（自带单位），`.vue` 里只 `String(档位)`，不手抄第二遍单位。
 * 与 autosave-preference / editor-leading-preference 同一类本机偏好：走 localStorage，零新 IPC。
 */
export const EDITOR_MEASURE_PREFERENCE_KEY = "mochen.editorMeasure";

export interface EditorMeasurePreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const EDITOR_MEASURE_OPTIONS = ["none", "44ch", "52ch", "60ch", "68ch", "76ch"] as const;

export type EditorMeasure = (typeof EDITOR_MEASURE_OPTIONS)[number];

/**
 * 默认档与原样式同义：原版式就是「不限宽」，none 正是 max-width 的无限值。
 * 于是「没设置过」与「选了满宽」读出来是同一个值，排版一字不变。
 */
export const EDITOR_MEASURE_DEFAULT: EditorMeasure = "none";

const EDITOR_MEASURE_LABELS: Record<EditorMeasure, string> = {
  none: "满宽",
  "44ch": "窄",
  "52ch": "舒适",
  "60ch": "宽",
  "68ch": "超宽",
  "76ch": "宽屏"
};

const EDITOR_MEASURE_NOTES: Record<EditorMeasure, string> = {
  none: "不设上限，正文铺满整栏；与原版式一致。",
  "44ch": "一行只铺 44ch（≈44 个 0 字符宽），改长段时视线不容易串行。",
  "52ch": "一行 52ch，多数人写长文的舒适区。",
  "60ch": "一行 60ch，看整章结构更快；纯 CJK 稿大约三十来个字一行。",
  "68ch": "一行 68ch，适合已经习惯宽行、或者正文里混着大量代码与表格。",
  "76ch": "一行 76ch，宽屏上最宽的一档；再宽就容易跳行了。"
};

export interface EditorMeasureOption {
  value: EditorMeasure;
  label: string;
  note: string;
}

export function editorMeasureOptions(): EditorMeasureOption[] {
  return EDITOR_MEASURE_OPTIONS.map((value) => ({
    value,
    label: EDITOR_MEASURE_LABELS[value],
    note: EDITOR_MEASURE_NOTES[value]
  }));
}

export function loadEditorMeasure(storage: EditorMeasurePreferenceStorage | null): EditorMeasure {
  if (storage === null) return EDITOR_MEASURE_DEFAULT;
  const raw = storage.getItem(EDITOR_MEASURE_PREFERENCE_KEY);
  // 档位是字符串表：逐字比大小写与单位，坏值（"60px" / "60 CH" / 空串）一律退回默认档。
  if (raw === null || raw.trim() === "") return EDITOR_MEASURE_DEFAULT;
  const trimmed = raw.trim();
  return (EDITOR_MEASURE_OPTIONS as readonly string[]).includes(trimmed)
    ? (trimmed as EditorMeasure)
    : EDITOR_MEASURE_DEFAULT;
}

export function saveEditorMeasure(
  storage: EditorMeasurePreferenceStorage,
  value: EditorMeasure
): void {
  storage.setItem(EDITOR_MEASURE_PREFERENCE_KEY, value);
}

/** 浏览器侧取存储：没有 window / localStorage 时返回 null（调用方退回默认档，不抛错）。 */
export function editorMeasurePreferenceStorage(): EditorMeasurePreferenceStorage | null {
  if (typeof window === "undefined") return null;
  try {
    // window 在但 localStorage 缺席（测试环境 / 隐私模式）时拿到的是 undefined，必须归一成 null。
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}
