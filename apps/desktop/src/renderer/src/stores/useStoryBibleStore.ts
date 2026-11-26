/**
 * StoryBibleStore —— 故事圣经
 *
 * 管理世界观设定的核心功能：人物卡片、地点设定、时间线事件。
 * 每个条目支持类型专属字段与颜色标记。
 *
 * 数据持久化（2026-10-09 扫描总单 P0-7 改的）：落在**当前这本书**的
 * `.mochen/data/story-bible.json`，通路本体在 `composables/useBookFileData`。
 * 存储里**不再有示例条目**：没有存档、存档是空数组、存档读不懂这三种情况一律当空库起点
 * （作者删光就是删光，回灌"示例人物·林夜"是往他的书里塞脏数据），空态文案由 `utils/bible-scope` 给。
 *
 * 两条口径不在这里重复实现：
 * - 「按档位/搜索该显示哪些条目」住在 `utils/bible-scope.ts`，这里只给 `activeEntries`
 *   与 `archivedEntries` 两份视图；
 * - 「这份文件是不是我们认识的那份」住在 contracts 的 `story-bible`（2026-11-08 W-01 下沉，
 *   主进程的上下文装配与本面板共用同一份）：认不得的形状判读不懂（通路随即
 *   停止写盘），只是缺了后加字段的补默认值放行。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  mergeBibleEntries,
  normalizeBibleEntries,
  type BibleEntry,
  type BibleEntryType
} from "@mochen/contracts";
import { useBookFileData } from "../composables/useBookFileData";

/** 类型与形状校验的真身住 contracts；这里转导出，面板与工具沿原来的 import 路径照用。 */
export type { BibleEntry, BibleEntryType };

/** 迁移来源：P0-7 之前那份不带书标识的全局数据。盘上有东西时绝不碰它。 */
const LEGACY_STORAGE_KEY = "mochen.story-bible.v1";

const COLORS = ["#e0556e", "#4a76c4", "#3ba564", "#8e5cd6", "#d68f3c", "#6b7280", "#c9b037"];

export const BIBLE_COLORS = COLORS;

function genId(): string {
  return `bible_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useStoryBibleStore = defineStore("story-bible", () => {
  const entries = ref<BibleEntry[]>([]);
  const { saveError } = useBookFileData<BibleEntry[]>({
    key: "story-bible",
    legacyStorageKey: LEGACY_STORAGE_KEY,
    data: entries,
    empty: () => [],
    normalize: normalizeBibleEntries
  });

  /** 所有未归档条目，按更新时间倒序。（档位过滤与搜索住在 `utils/bible-scope.ts`，这里不再自己写一份；
   * 原先那两个 `getEntriesByType` / `searchEntries` 一个全仓零调用、一个与 utils 口径重复，已摘掉。） */
  const activeEntries = computed(() =>
    [...entries.value].filter((e) => !e.archived).sort((a, b) => b.updatedAt - a.updatedAt)
  );

  /**
   * 归档视图：面板「已归档」那一档与取回按钮都读这一份。
   * 与 `activeEntries` 是**完整二分**——每条要么在这要么在那，用例钉着。
   */
  const archivedEntries = computed(() =>
    [...entries.value].filter((e) => e.archived === true).sort((a, b) => b.updatedAt - a.updatedAt)
  );

  function addEntry(
    type: BibleEntryType,
    title: string,
    content: string,
    extra?: Partial<
      Omit<BibleEntry, "id" | "type" | "title" | "content" | "createdAt" | "updatedAt">
    >
  ): BibleEntry {
    const now = Date.now();
    const entry: BibleEntry = {
      id: genId(),
      type,
      title: title.trim() || "未命名",
      content,
      createdAt: now,
      updatedAt: now,
      tags: extra?.tags ?? [],
      ...(extra?.color !== undefined ? { color: extra.color } : {}),
      ...(type === "character"
        ? {
            ...(extra?.aliases !== undefined ? { aliases: extra.aliases } : {}),
            ...(extra?.role !== undefined ? { role: extra.role } : {})
          }
        : {}),
      ...(type === "location"
        ? {
            ...(extra?.parentLocation !== undefined ? { parentLocation: extra.parentLocation } : {})
          }
        : {}),
      ...(type === "timeline"
        ? {
            ...(extra?.eventDate !== undefined ? { eventDate: extra.eventDate } : {}),
            ...(extra?.importance !== undefined ? { importance: extra.importance } : {})
          }
        : {})
    };
    entries.value.push(entry);
    return entry;
  }

  function updateEntry(id: string, partial: Partial<Omit<BibleEntry, "id">>): void {
    const entry = entries.value.find((e) => e.id === id);
    if (!entry) return;
    Object.assign(entry, partial, { updatedAt: Date.now() });
  }

  function removeEntry(id: string): void {
    const idx = entries.value.findIndex((e) => e.id === id);
    if (idx !== -1) entries.value.splice(idx, 1);
  }

  function archiveEntry(id: string): void {
    const entry = entries.value.find((e) => e.id === id);
    if (entry) {
      entry.archived = true;
      entry.updatedAt = Date.now();
    }
  }

  function restoreEntry(id: string): void {
    const entry = entries.value.find((e) => e.id === id);
    if (entry) {
      entry.archived = false;
      entry.updatedAt = Date.now();
    }
  }

  /**
   * 从另一本书导入设定条目（2026-11-24，系列共享设定的复制式导入）。
   *
   * 判定（谁算重复、谁追加、id 撞车怎么换）在 contracts 的 `mergeBibleEntries`：
   * **当前书已有的跳过不覆盖**（新书里改过的设定不能被来源书冲掉），新增按来源原序追加。
   * 合并结果直接交给 `entries`——`useBookFileData` 的既有防抖与坏文件停写闸照常把关，
   * 这里不开第二条写盘通路。
   */
  function importEntries(incoming: readonly BibleEntry[]): { added: number; skipped: number } {
    const report = mergeBibleEntries(entries.value, incoming);
    entries.value = report.merged;
    return { added: report.added, skipped: report.skipped };
  }

  return {
    entries,
    saveError,
    activeEntries,
    archivedEntries,
    addEntry,
    updateEntry,
    removeEntry,
    archiveEntry,
    restoreEntry,
    importEntries
  };
});
