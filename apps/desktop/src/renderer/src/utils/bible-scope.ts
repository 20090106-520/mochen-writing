import type { BibleEntry, BibleEntryType } from "../stores/useStoryBibleStore";

/**
 * 故事圣经面板的档位、搜索与空态判定（2026-10-09 扫描总单·假控件那一批的第三族）。
 *
 * 三条病灶：
 * - 归档是单向门：`archiveEntry` 有按钮，`restoreEntry` 全仓零调用——点完归档，条目从此
 *   既看不见也回不来，在作者眼里等同于软件删了他的设定；
 * - 详情跟着筛选走：`selectedEntry` 从「筛完的列表」里查，换一档（或搜一个词）就丢选中，
 *   右侧整块变成"未选中"占位；
 * - 空库时往用户数据里种三条示例条目（`defaultEntries`），而 `loadEntries` 在
 *   「存过但是空数组」时又把种子塞回去——作者删光示例，下次开软件示例又回来。
 *
 * 判定住在这里而不是面板里，是因为 `.vue` 不进类型程序；仓内分工是判定进 `utils/*.ts`
 * 出纯函数用例、接线进 `*-wiring.test.ts` 读源文件、行为进 store 用例。
 */

/** 五档：三档类型 + 全档 + 归档档。类型与 `BIBLE_SCOPES` 必须一一对应，用例钉着双向对齐。 */
export type BibleScope = "all" | BibleEntryType | "archived";

/** 类型标签的唯一一份：面板列表、详情、档位表都从这里取。 */
export const BIBLE_TYPE_LABEL: Record<BibleEntryType, string> = {
  character: "人物",
  location: "地点",
  timeline: "时间线"
};

export const BIBLE_SCOPES: readonly { id: BibleScope; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "character", label: BIBLE_TYPE_LABEL.character },
  { id: "location", label: BIBLE_TYPE_LABEL.location },
  { id: "timeline", label: BIBLE_TYPE_LABEL.timeline },
  { id: "archived", label: "已归档" }
];

/**
 * 「未归档」与「已归档」两份列表由 store 给。这里刻意收两份而不是一份再自己筛：
 * 归档与否的落库判定已经住在 store，utils 只负责按档位挑一路——挑错了才是 bug。
 */
export interface BibleSources {
  readonly active: readonly BibleEntry[];
  readonly archived: readonly BibleEntry[];
}

/** 按档位取该显示的那些条目。归档那一档不参与类型过滤——三种类型都要能取回来。 */
export function entriesForScope(scope: BibleScope, sources: BibleSources): BibleEntry[] {
  if (scope === "archived") return [...sources.archived];
  if (scope === "all") return [...sources.active];
  return sources.active.filter((e) => e.type === scope);
}

/**
 * 一条搜索实现，字段覆盖面沿用 store 原本那份（标题、正文、标签、别名、身份、事件日期、上级地点）。
 * 大小写一律不敏感——旧写法里正文转过小写，其余字段也各自转，但没有一处统一口径，
 * 加字段时就有人漏（`matchesEntry` 是唯一一份，store 的 `searchEntries` 也改成调它）。
 */
export function matchesEntry(entry: BibleEntry, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (q === "") return true;
  if (entry.title.toLocaleLowerCase().includes(q)) return true;
  if (entry.content.toLocaleLowerCase().includes(q)) return true;
  if (entry.tags.some((t) => t.toLocaleLowerCase().includes(q))) return true;
  if (entry.aliases?.some((a) => a.toLocaleLowerCase().includes(q))) return true;
  if (entry.role?.toLocaleLowerCase().includes(q)) return true;
  if (entry.eventDate?.toLocaleLowerCase().includes(q)) return true;
  if (entry.parentLocation?.toLocaleLowerCase().includes(q)) return true;
  return false;
}

/** 档位 + 搜索叠在一起：先按档位取范围，再在范围里搜。 */
export function visibleEntries(
  scope: BibleScope,
  sources: BibleSources,
  query: string
): BibleEntry[] {
  const list = entriesForScope(scope, sources);
  if (query.trim() === "") return list;
  return list.filter((e) => matchesEntry(e, query));
}

export interface BibleEmptyTextInput {
  scope: BibleScope;
  /** 库里一条未归档的都没有（区别于"有内容，只是这一档/这个词筛空了"）。 */
  libraryEmpty: boolean;
  query: string;
}

/**
 * 空态那两行文案的唯一来源。
 *
 * 旧写法只有一句「没有匹配的条目」，且只在列表为空时出现——整个库是空的也写"没有匹配"，
 * 而"匹配"什么都没有搜的时候，这句话等于什么都没说。现在四件事分开判：
 * 在搜东西、看的是归档档、这一档本来就空、整个库本来就空。
 */
export function bibleScopeEmptyText(input: BibleEmptyTextInput): { title: string; hint: string } {
  const q = input.query.trim();
  if (q !== "") {
    return {
      title: `没有匹配「${q}」的设定条目。`,
      hint: "换个词，或清空搜索框看这一档的全部。"
    };
  }
  if (input.scope === "archived") {
    return {
      title: "没有已归档的条目。",
      hint: "详情里的「归档」是把设定收起来，不是删掉——收进来的都在这里取回。"
    };
  }
  if (!input.libraryEmpty) {
    const label = input.scope === "all" ? "这一档" : `「${BIBLE_TYPE_LABEL[input.scope]}」这一档`;
    return { title: `${label}里还没有条目。`, hint: "换一档看看，或用上面「＋」新建一条。" };
  }
  return {
    title: "故事圣经还是空的。",
    hint: "用上面「＋」建第一条设定：人物、地点，或一件按顺序发生的事。"
  };
}
