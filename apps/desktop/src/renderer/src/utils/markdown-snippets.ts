import type { RightPaneMode } from "../stores/useBookStore";
import type { IconName } from "../types/icons";

/**
 * 右栏「插入 md 片段」的纯字符串改写（附录 F-F）。三条口径逐条有用例钉着：
 * 1. 下标口径 = UTF-16 码元：textarea 的 selectionStart/End 就是这个口径，返回的 start/end 要能直接喂回
 *    setSelectionRange，否则点一次按钮光标就跑到别处。
 * 2. 内容按码点算：一个表情是一个字，绝不把代理对劈成两半（本仓同类教训的原文见 timeline.ts 的 Array.from 注释）。
 * 3. 只插入、不反解析：已有前缀的行不再重复加，但点第二下不把标记摘掉——按钮叫「列表」，
 *    不叫「列表开关」（附录 §2.7：名字与动作不符也算摆设）。#113a 起按钮上画的是字形，
 *    这个名字改由 `aria-label` 承担：灰态的 title 是空串，没有 aria-label 就读屏只剩一句「按钮」。
 *    标题的去重按 markdown 语义认「行首已有 1–6 级 #」，因为 `# 手记` 再叠一层就成了 `## # 手记` 这种坏正文。
 */

export const SNIPPET_KINDS = ["bold", "italic", "heading", "list", "quote"] as const;
export type SnippetKind = (typeof SNIPPET_KINDS)[number];

/** 片段按钮的中文标签唯一来源：模板里不许出现第二个「加粗」。它同时是图标钮的可及名。 */
export const SNIPPET_LABELS: Record<SnippetKind, string> = {
  bold: "加粗",
  italic: "斜体",
  heading: "标题",
  list: "列表",
  quote: "引用"
};

/**
 * 片段按钮的字形唯一来源（#113a：参考稿右栏第三行画的是 B/I/" 三枚图标，不是中文标签）。
 * `Record<SnippetKind, IconName>` 让裸 tsc 盯住穷尽性——加一种片段却忘了配图标，编译期就红。
 * `heading` 是本仓自造的一枚（deepwrite 的图标表里没有标题字形），已在 docs/ATTRIBUTION.md 登记。
 */
export const SNIPPET_ICONS: Record<SnippetKind, IconName> = {
  bold: "bold",
  italic: "italic",
  heading: "heading",
  list: "list",
  quote: "quote"
};

/**
 * 无活动文稿时那句诚实理由（评审 Important 4 + 复审 I-1）。
 * 它**只走可见文本**，不走 `title`：Chromium 对 disabled 按钮不弹原生 tooltip，
 * 而灰态恰恰是唯一需要解释的时刻——挂着弹不出来的解释等于没解释。
 * 本仓同律先例：左栏「本章新对话（先打开一章）」把理由写进按钮文字本身。
 */
const SNIPPET_DISABLED_HINT = "打开一篇文稿后才能插入片段";

/** 成对标记：包在选区两端；空选区时两个标记相邻，光标落正中。 */
const PAIRED_MARKS: Partial<Record<SnippetKind, string>> = { bold: "**", italic: "*" };

/**
 * 行首标记。这张表的**键域就是「行首类片段」的定义**：`LineKind` 由它派生，不再手写第二份枚举
 * （铁律 6）。文稿标题在 document-title-input 里另存，正文只用二级，别再顶出一个一级跟它抢。
 */
const LINE_MARKS = { heading: "## ", list: "- ", quote: "> " } as const;
type LineKind = keyof typeof LINE_MARKS;

/**
 * 逐行还是只作用首行：列表与引用逐行；标题即使选区跨三段也只加首行。变异 W8 改的就是这张表。
 * 键域只列行首三类，因为成对标记在 `applySnippet` 里提前返回，**永远读不到这张表**：
 * M8 变异实测过，从前给 `italic` 填 false、改成 true 后 31 条用例全绿——那两格是没人读的死值。
 * 删掉之后 `italic: true` 这发变异连编译都过不去（多余属性检查，实测 TS2353），比测试更硬。
 */
const PER_LINE: Record<LineKind, boolean> = { heading: false, list: true, quote: true };

/** 是行首类片段才返回它的行首身份；否则 undefined，由调用方原样返回，不靠猜。 */
const asLineKind = (kind: SnippetKind): LineKind | undefined =>
  (Object.keys(LINE_MARKS) as SnippetKind[]).includes(kind) ? (kind as LineKind) : undefined;

export interface SnippetSelection {
  value: string;
  start: number;
  end: number;
}

export interface SnippetResult {
  value: string;
  start: number;
  end: number;
}

export interface SnippetButton {
  kind: SnippetKind;
  label: string;
  icon: IconName;
  disabled: boolean;
  title: string;
}

/** `snippetToolbarState` 的产物形状：工具栏组件与接线只认这一个形状，不在别处再描述一遍。 */
export interface SnippetToolbarView {
  visible: boolean;
  buttons: SnippetButton[];
  /** 整条工具栏下方那一行**可见**的理由；可点与非文稿态都是空串（容器由 visible 决定，不靠它兜底）。 */
  hint: string;
}

/**
 * 工具栏「谁可见、谁可点、灰了要说为什么」（附录 F-F 明写浏览态隐藏）。
 * 右栏三态的类型只有一份实现：`stores/useBookStore.ts` 的 `RightPaneMode`（铁律 6，这里 import 而不是再抄一遍字面量）。
 * 作品资料态同样是只读视图，按钮在那儿点不出任何事 ⇒ 一并隐藏；
 * 没有活动文稿时按钮在位但 disabled：草稿还不存在，点了改谁？
 */
export function snippetToolbarState(input: {
  mode: RightPaneMode;
  hasActiveDoc: boolean;
}): SnippetToolbarView {
  const visible = input.mode === "manuscript";
  const disabled = visible && !input.hasActiveDoc;
  const buttons = SNIPPET_KINDS.map((kind) => ({
    kind,
    label: SNIPPET_LABELS[kind],
    icon: SNIPPET_ICONS[kind],
    disabled,
    // title 只在可点态说用途（灰态弹不出来，理由另有可见的 hint）；措辞照 SNIPPET_LABELS 派生，不发明新词。
    title: disabled ? "" : `插入「${SNIPPET_LABELS[kind]}」`
  }));
  return { visible, buttons, hint: disabled ? SNIPPET_DISABLED_HINT : "" };
}

function isHighSurrogate(value: string, index: number): boolean {
  const code = value.charCodeAt(index);
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(value: string, index: number): boolean {
  const code = value.charCodeAt(index);
  return code >= 0xdc00 && code <= 0xdfff;
}

/** 该下标是否正好落在一对代理中间（会把一个表情劈成两半的位置）。 */
function splitsPair(value: string, index: number): boolean {
  return (
    index > 0 &&
    index < value.length &&
    isHighSurrogate(value, index - 1) &&
    isLowSurrogate(value, index)
  );
}

/** 起点前移、终点后移：整个码点让给选区，绝不用半截代理去拼字符串。 */
function snapStart(value: string, index: number): number {
  return splitsPair(value, index) ? index - 1 : index;
}

function snapEnd(value: string, index: number): number {
  return splitsPair(value, index) ? index + 1 : index;
}

function clamp(index: number, length: number): number {
  return Math.max(0, Math.min(index, length));
}

/**
 * 与选区相交的行首（码元下标，升序，至少一个）。
 * everyLine=false 只要首行；空选区只要光标那一行。
 * 只按 "\n" 找行首：换行永远是一个码元，代理对里不可能含它，故这条通路不会因码点/码元混用而错位。
 * 终点正好落在某行行首（选区末位是换行，`end > start`）时**不含该行**：那一行没被选中一个字，
 * 牵连进去就会把「选中第一段回车」变成给第二段也加前缀（修复轮 F2）。
 */
function lineHeads(value: string, start: number, end: number, everyLine: boolean): number[] {
  const first = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
  const heads = [first];
  if (!everyLine || start === end) return heads;
  let cursor = first;
  while (cursor < end) {
    const newline = value.indexOf("\n", cursor);
    if (newline === -1 || newline + 1 >= end) break;
    heads.push(newline + 1);
    cursor = newline + 1;
  }
  return heads;
}

/** 标题行的形状：`#` 到 `######` 后跟空格或制表符——`#` 与 `## ` 在 markdown 里都是标题。 */
const HEADING_LINE = /^#{1,6}[ \t]/;

/**
 * 这一行是否已经带这类行首标记（去重判据，修复轮 F3）。
 * 列表与引用：整条 mark 字面量相等才算已有。`-手记`（`-` 后没有空格）里的 `-` 视为普通文本字符、不识别，
 * 于是点「列表」得到 `- -手记`——这条边界本轮不动，只把判据写清。
 * 标题额外认 `#` 层级：只比整条 `"## "` 会让 `# 手记` 被顶成 `## # 手记`（渲染错乱的正文）。
 * 认出已有层级后原样返回：不叠加，也不改写既有层级（口径 3「只插入、不反解析」）。
 */
function hasLineMark(kind: SnippetKind, mark: string, value: string, head: number): boolean {
  if (value.slice(head, head + mark.length) === mark) return true;
  if (kind !== "heading") return false;
  const newline = value.indexOf("\n", head);
  const line = newline === -1 ? value.slice(head) : value.slice(head, newline);
  return HEADING_LINE.test(line);
}

/**
 * 纯函数：不改入参、不抛异常、返回新字符串与新下标。
 * 成对标记（加粗）作用于选区两端；行首标记（标题/列表/引用）插在行首，已有的不重复加。
 */
export function applySnippet(kind: SnippetKind, sel: SnippetSelection): SnippetResult {
  const value = sel.value;
  let start = clamp(sel.start, value.length);
  let end = clamp(sel.end, value.length);
  if (end < start) {
    const swap = start;
    start = end;
    end = swap;
  }
  start = snapStart(value, start);
  end = snapEnd(value, end);
  if (end < start) end = start;

  const paired = PAIRED_MARKS[kind];
  if (paired !== undefined) {
    const wrapped = `${paired}${value.slice(start, end)}${paired}`;
    return {
      value: `${value.slice(0, start)}${wrapped}${value.slice(end)}`,
      start: start + paired.length,
      end: end + paired.length
    };
  }

  const lineKind = asLineKind(kind);
  if (lineKind === undefined) return { value, start, end };
  const mark = LINE_MARKS[lineKind];
  const heads = lineHeads(value, start, end, PER_LINE[lineKind]);
  let nextValue = value;
  let addedTotal = 0;
  let addedBeforeStart = 0;
  // 从后往前插：前面的插入会把后面的行首下标顶歪，倒着走就不必重算。
  for (const head of heads.slice().reverse()) {
    if (hasLineMark(kind, mark, nextValue, head)) continue;
    nextValue = `${nextValue.slice(0, head)}${mark}${nextValue.slice(head)}`;
    addedTotal += mark.length;
    if (head <= start) addedBeforeStart += mark.length;
  }
  return { value: nextValue, start: start + addedBeforeStart, end: end + addedTotal };
}
