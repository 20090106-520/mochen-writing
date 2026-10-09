import type { Note } from "../stores/useNotesStore";

/**
 * 笔记面板那三处「界面说了、代码没做」的**唯一判定**（2026-10-09 扫描总单·假控件）。
 *
 * 病灶逐条：
 * - 「批注」页签筛的是 `kind === "annotation"`，可全仓没有一处调用 `createAnnotation`
 *   （只有定义与导出两处命中）——那一页永远空着，空态文案却写着「或在文档上添加批注」；
 * - 标签只在展示端出现（`note.tags` 与底部标签集），录入端一个字段都没有 ⇒ `allTags` 恒空；
 * - 「归档」是单向门：`unarchiveNote` 零调用，归档过的笔记从此看不见也取不回。
 *
 * 判定住在这里而不是面板里，是因为 `.vue` 不进类型程序也没有自动化覆盖；仓内既有分工是
 * 判定进 `utils/*.ts` 出纯函数用例、接线进 `*-wiring.test.ts` 读源文件、行为进 store 用例。
 */

/** 面板顶部的四个档位。类型与 `NOTE_SCOPES` 必须一一对应，用例里钉着双向对齐。 */
export type NoteScope = "all" | "quick" | "annotations" | "archived";

/** 档位表是模板唯一的数据源：再加一档只改这里一处，按钮与判定一起跟上。 */
export const NOTE_SCOPES: readonly { id: NoteScope; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "quick", label: "速记" },
  { id: "annotations", label: "批注" },
  { id: "archived", label: "已归档" }
];

/**
 * 「未归档」与「已归档」两份列表由 store 给（`activeNotes` / `archivedNotes`）。
 * 这里刻意收**两份**而不是一份再自己筛：归档与否的落库判定已经住在 store，
 * 面板拿到的就是那两个视图，utils 只负责按档位挑一路——挑错了才是 bug。
 */
export interface NoteSources {
  readonly active: readonly Note[];
  readonly archived: readonly Note[];
}

/** 按档位取该显示的那些条目：归档那一档不参与 kind 过滤（速记与批注都要能取回来）。 */
export function notesForScope(scope: NoteScope, sources: NoteSources): Note[] {
  if (scope === "archived") return [...sources.archived];
  if (scope === "quick") return sources.active.filter((n) => n.kind === "quick");
  if (scope === "annotations") return sources.active.filter((n) => n.kind === "annotation");
  return [...sources.active];
}

/** 命中正文或标签；只有空格的查询按「没筛」处理。大小写一律不敏感（旧写法只把正文转了小写）。 */
export function filterNotesByQuery(list: readonly Note[], query: string): Note[] {
  const q = query.trim().toLocaleLowerCase();
  if (q === "") return [...list];
  return list.filter(
    (n) =>
      n.content.toLocaleLowerCase().includes(q) ||
      n.tags.some((tag) => tag.toLocaleLowerCase().includes(q))
  );
}

/**
 * 标签录入那一刀不在这里：它跟"档位"无关，两个面板共用，住在 `utils/tag-input.ts`。
 */

export type AnnotationTarget = { ok: true; docRelPath: string } | { ok: false; reason: string };

/** 空态那两行文案的入参。`query` 是搜索框当前内容（未 trim）。 */
export interface EmptyTextInput {
  scope: NoteScope;
  /** 库里一条未归档的都没有（区别于"有内容但这一档/这个搜索词筛空了"）。 */
  libraryEmpty: boolean;
  query: string;
}

/**
 * 空态文案（界面那两行 `<p>` 的唯一来源）。
 *
 * 为什么也要抽出来：旧写法无论什么情况都写「还没有笔记。／速记灵感，或在文档上添加批注。」——
 * 后半句承诺的是一件**没有入口**的事（批注），而在「已归档」那一档它连前半句都不对。
 * 现在三件事分开判：在搜东西、这一档本来就是空的、整个库是空的。
 */
export function scopeEmptyText(input: EmptyTextInput): { title: string; hint: string } {
  const q = input.query.trim();
  if (q !== "") {
    return {
      title: `没有匹配「${q}」的笔记。`,
      hint: "换个词，或清空搜索框看这一档的全部。"
    };
  }
  if (input.scope === "archived") {
    return {
      title: "没有已归档的笔记。",
      hint: "列表里的「归档」是把笔记收起来，不是删掉——收进来的都在这里取回。"
    };
  }
  if (input.scope === "annotations") {
    return {
      title: "还没有批注。",
      hint: "新建笔记时勾上「附在当前章上」，这条就挂在那一章上。"
    };
  }
  if (input.scope === "quick") {
    return { title: "还没有速记。", hint: "用上面「＋」记一条灵感，不勾附在当前章上就是速记。" };
  }
  if (!input.libraryEmpty) {
    // 库里有东西，只是这一档筛空了（全档筛空只在归档件都存在时出现）。
    return { title: "这一档里没有笔记。", hint: "换一档看看，或用上面「＋」记一条。" };
  }
  return {
    title: "还没有笔记。",
    hint: "用上面「＋」记一条灵感；勾上「附在当前章上」就是那一章的批注。"
  };
}

/**
 * 这条批注挂到哪一章。没有当前章时给的是**一句人话**，不是一个挂在空 `docRelPath` 上的批注——
 * 后者会造出一条永远点不开的记录（`jumpToDoc` 拿 `docRelPath` 找不到 ref 就静默返回）。
 */
export function annotationTarget(activeDocTab: string | null): AnnotationTarget {
  if (activeDocTab === null || activeDocTab.trim() === "") {
    return { ok: false, reason: "先在中栏打开一章，这条才会记成那一章的批注。" };
  }
  return { ok: true, docRelPath: activeDocTab };
}
