import { describe, expect, it } from "vitest";
import {
  EDITOR_SIZE_DEFAULT,
  EDITOR_SIZE_OPTIONS,
  EDITOR_SIZE_STORAGE_KEY,
  EDITOR_SPELLCHECK_DEFAULT,
  EDITOR_SPELLCHECK_STORAGE_KEY,
  editorSizeOptions,
  loadEditorSize,
  loadEditorSpellcheck,
  saveEditorSize,
  saveEditorSpellcheck
} from "./editor-text-preference";

interface FakeStorage {
  map: Map<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(initial: Record<string, string> = {}): FakeStorage {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      map.set(key, value);
    },
    removeItem: (key: string): void => {
      map.delete(key);
    }
  };
}

describe("editor-text-preference · 正文字号与拼写检查的记忆（2026-10-05）", () => {
  it("字号默认档 15 与原样式同值（1.07143rem × 14px 基准）：没有这份偏好时排版一字不变", () => {
    expect(EDITOR_SIZE_DEFAULT).toBe(15);
    expect(loadEditorSize(storage())).toBe(15);
    expect(loadEditorSize(null)).toBe(15);
  });

  it("三档就是 15/17/19，档位集只有这一份（面板从这里取）", () => {
    expect([...EDITOR_SIZE_OPTIONS]).toEqual([15, 17, 19]);
    expect(editorSizeOptions().map((option) => option.value)).toEqual([...EDITOR_SIZE_OPTIONS]);
    for (const option of editorSizeOptions()) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.note.length).toBeGreaterThan(0);
    }
  });

  it("字号存什么读什么，坏值/空串退回默认档", () => {
    const store = storage();
    saveEditorSize(store, 19);
    expect(store.map.get(EDITOR_SIZE_STORAGE_KEY)).toBe("19");
    expect(loadEditorSize(store)).toBe(19);
    for (const bad of ["", "abc", "16", "21", "-1", "null"]) {
      expect([bad, loadEditorSize(storage({ [EDITOR_SIZE_STORAGE_KEY]: bad }))]).toEqual([bad, 15]);
    }
  });

  it("拼写检查默认关（textarea 原本写死 false）；开=写 true，关=删键，坏值算关", () => {
    expect(EDITOR_SPELLCHECK_DEFAULT).toBe(false);
    const store = storage();
    expect(loadEditorSpellcheck(store)).toBe(false);
    saveEditorSpellcheck(store, true);
    expect(store.map.get(EDITOR_SPELLCHECK_STORAGE_KEY)).toBe("true");
    expect(loadEditorSpellcheck(store)).toBe(true);
    saveEditorSpellcheck(store, false);
    expect(store.map.has(EDITOR_SPELLCHECK_STORAGE_KEY)).toBe(false);
    expect(loadEditorSpellcheck(storage({ [EDITOR_SPELLCHECK_STORAGE_KEY]: "1" }))).toBe(false);
    expect(loadEditorSpellcheck(null)).toBe(false);
  });
});
