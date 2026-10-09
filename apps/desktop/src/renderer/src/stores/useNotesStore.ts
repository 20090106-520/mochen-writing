/**
 * NotesStore —— 笔记系统
 *
 * 支持两种笔记类型：
 * 1. 全局笔记（Quick Note）：灵感速记，不绑定文档
 * 2. 文档批注（Annotation）：绑定到文档的某个位置
 *
 * 数据持久化（2026-10-09 扫描总单 P0-7 改的）：笔记落在**当前这本书**的
 * `.mochen/data/notes.json`，由主进程按白名单键拼路径写盘，于是 A 本的批注不会再
 * 出现在 B 本里，存不下时面板上也会说一句人话。通路本体在 `composables/useBookFileData`。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useBookFileData } from "../composables/useBookFileData";
import { normalizeNotes } from "../utils/note-shape";

export interface Note {
  id: string;
  kind: "quick" | "annotation";
  content: string;
  createdAt: number;
  updatedAt: number;
  /** 文档批注时绑定 */
  docRelPath?: string;
  /** 文档批注时光标位置（行号） */
  lineNumber?: number;
  /** 关联的 AI 对话 threadKey（可选） */
  threadKey?: string;
  /** 标签（逗号分隔文本，存的时候已经 split 好） */
  tags: string[];
  /** true = 已归档（软删除） */
  archived: boolean;
}

/** 迁移来源：P0-7 之前那份不带书标识的全局数据。盘上有东西时绝不碰它。 */
const LEGACY_STORAGE_KEY = "mochen.notes.v1";

function genId(): string {
  return `note_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export const useNotesStore = defineStore("notes", () => {
  const notes = ref<Note[]>([]);
  const { saveError } = useBookFileData<Note[]>({
    key: "notes",
    legacyStorageKey: LEGACY_STORAGE_KEY,
    data: notes,
    empty: () => [],
    normalize: normalizeNotes
  });

  const allNotes = computed(() => [...notes.value].sort((a, b) => b.updatedAt - a.updatedAt));

  const activeNotes = computed(() => allNotes.value.filter((n) => !n.archived));
  const archivedNotes = computed(() => allNotes.value.filter((n) => n.archived));

  /** 文档批注列表（按文档分组） */
  const annotationsByDoc = computed(() => {
    const map = new Map<string, Note[]>();
    for (const note of activeNotes.value) {
      if (note.kind === "annotation" && note.docRelPath) {
        if (!map.has(note.docRelPath)) map.set(note.docRelPath, []);
        map.get(note.docRelPath)!.push(note);
      }
    }
    return map;
  });

  /** 所有已用标签 */
  const allTags = computed(() => {
    const set = new Set<string>();
    for (const note of notes.value) {
      for (const tag of note.tags) set.add(tag);
    }
    return [...set].sort();
  });

  /** 创建快速笔记 */
  function createQuickNote(content: string, tags: string[] = []): Note {
    const now = Date.now();
    const note: Note = {
      id: genId(),
      kind: "quick",
      content,
      createdAt: now,
      updatedAt: now,
      tags,
      archived: false
    };
    notes.value.push(note);
    return note;
  }

  /** 创建文档批注 */
  function createAnnotation(
    content: string,
    docRelPath: string,
    lineNumber?: number,
    tags: string[] = []
  ): Note {
    const now = Date.now();
    const note: Note = {
      id: genId(),
      kind: "annotation",
      content,
      createdAt: now,
      updatedAt: now,
      docRelPath,
      ...(lineNumber !== undefined ? { lineNumber } : {}),
      tags,
      archived: false
    };
    notes.value.push(note);
    return note;
  }

  /** 更新笔记内容 */
  function updateNote(id: string, content: string): void {
    const note = notes.value.find((n) => n.id === id);
    if (note) {
      note.content = content;
      note.updatedAt = Date.now();
    }
  }

  /** 归档笔记（软删除） */
  function archiveNote(id: string): void {
    const note = notes.value.find((n) => n.id === id);
    if (note) note.archived = true;
  }

  /** 取消归档 */
  function unarchiveNote(id: string): void {
    const note = notes.value.find((n) => n.id === id);
    if (note) note.archived = false;
  }

  /** 彻底删除笔记 */
  function deleteNote(id: string): void {
    const idx = notes.value.findIndex((n) => n.id === id);
    if (idx !== -1) notes.value.splice(idx, 1);
  }

  /** 给笔记打标签 */
  function setTags(id: string, tags: string[]): void {
    const note = notes.value.find((n) => n.id === id);
    if (note) note.tags = tags;
  }

  /** 搜索笔记 */
  function searchNotes(query: string): Note[] {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return activeNotes.value;
    return activeNotes.value.filter(
      (n) =>
        n.content.toLocaleLowerCase().includes(q) ||
        n.tags.some((t) => t.toLocaleLowerCase().includes(q))
    );
  }

  /** 绑定某文档的批注：开笔记面板时用 */
  function getAnnotationsForDoc(docRelPath: string): Note[] {
    return activeNotes.value
      .filter((n) => n.kind === "annotation" && n.docRelPath === docRelPath)
      .sort((a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0));
  }

  return {
    notes,
    saveError,
    allNotes,
    activeNotes,
    archivedNotes,
    annotationsByDoc,
    allTags,
    createQuickNote,
    createAnnotation,
    updateNote,
    archiveNote,
    unarchiveNote,
    deleteNote,
    setTags,
    searchNotes,
    getAnnotationsForDoc
  };
});
