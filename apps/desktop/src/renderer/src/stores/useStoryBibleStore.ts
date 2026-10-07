/**
 * StoryBibleStore —— 故事圣经
 *
 * 管理世界观设定的核心功能：人物卡片、地点设定、时间线事件。
 * 每个条目支持类型专属字段与颜色标记，持久化到 localStorage。
 */
import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";

export type BibleEntryType = "character" | "location" | "timeline";

export interface BibleEntry {
  id: string;
  type: BibleEntryType;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  tags: string[];
  color?: string;
  // 人物类型专属
  aliases?: string[];
  role?: string;
  // 地点类型专属
  parentLocation?: string;
  // 时间线专属
  eventDate?: string;
  importance?: "high" | "medium" | "low";
  // 归档态
  archived?: boolean;
}

const STORAGE_KEY = "mochen.story-bible.v1";

const COLORS = ["#e0556e", "#4a76c4", "#3ba564", "#8e5cd6", "#d68f3c", "#6b7280", "#c9b037"];

export const BIBLE_COLORS = COLORS;

function defaultEntries(): BibleEntry[] {
  const now = Date.now();
  return [
    {
      id: "bible_seed_character_1",
      type: "character",
      title: "示例人物 · 林夜",
      content:
        "身份神秘的引路人。平时以书店老板身份示人，实则掌握着关于深渊的古老知识。性格温和但偶尔流露出深沉的疲惫。",
      createdAt: now,
      updatedAt: now,
      tags: ["引路人", "深渊知识"],
      color: "#4a76c4",
      aliases: ["夜老板", "林老板"],
      role: "配角"
    },
    {
      id: "bible_seed_location_1",
      type: "location",
      title: "示例地点 · 无尽图书馆",
      content:
        "一座不存于任何地图的建筑。外层是普通的旧书店，底层藏着能通往不同时空的回廊。入口处有一盏永不熄灭的铜灯。",
      createdAt: now,
      updatedAt: now,
      tags: ["枢纽", "神秘建筑"],
      color: "#8e5cd6"
    },
    {
      id: "bible_seed_timeline_1",
      type: "timeline",
      title: "示例事件 · 第一次门扉开启",
      content:
        "主角无意间触动了图书馆深处的机关，发现了回廊的存在。这一事件正式将他卷入了两个世界之间的漩涡。",
      createdAt: now,
      updatedAt: now,
      tags: ["转折点", "开篇"],
      color: "#e05650",
      eventDate: "故事序章",
      importance: "high"
    }
  ];
}

function loadEntries(): BibleEntry[] {
  if (typeof localStorage === "undefined") return defaultEntries();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultEntries();
    const parsed = JSON.parse(raw) as BibleEntry[];
    if (!Array.isArray(parsed) || parsed.length === 0) return defaultEntries();
    return parsed;
  } catch {
    return defaultEntries();
  }
}

function saveEntries(entries: BibleEntry[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // 静默
  }
}

function genId(): string {
  return `bible_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useStoryBibleStore = defineStore("story-bible", () => {
  const entries = ref<BibleEntry[]>(loadEntries());

  watch(entries, (val) => saveEntries(val), { deep: true });

  /** 所有未归档条目，按更新时间倒序 */
  const activeEntries = computed(() =>
    [...entries.value].filter((e) => !e.archived).sort((a, b) => b.updatedAt - a.updatedAt)
  );

  /** 按类型过滤 */
  function getEntriesByType(type: BibleEntryType): BibleEntry[] {
    return activeEntries.value.filter((e) => e.type === type);
  }

  /** 搜索：标题/标签/正文/别名/角色/日期 */
  function searchEntries(query: string): BibleEntry[] {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return activeEntries.value;
    return activeEntries.value.filter((e) => {
      if (e.title.toLocaleLowerCase().includes(q)) return true;
      if (e.content.toLocaleLowerCase().includes(q)) return true;
      if (e.tags.some((t) => t.toLocaleLowerCase().includes(q))) return true;
      if (e.aliases?.some((a) => a.toLocaleLowerCase().includes(q))) return true;
      if (e.role?.toLocaleLowerCase().includes(q)) return true;
      if (e.eventDate?.toLocaleLowerCase().includes(q)) return true;
      if (e.parentLocation?.toLocaleLowerCase().includes(q)) return true;
      return false;
    });
  }

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

  return {
    entries,
    activeEntries,
    getEntriesByType,
    searchEntries,
    addEntry,
    updateEntry,
    removeEntry,
    archiveEntry,
    restoreEntry
  };
});
