import { describe, expect, it } from "vitest";
import {
  EDITOR_LEADING_DEFAULT,
  EDITOR_LEADING_OPTIONS,
  EDITOR_LEADING_PREFERENCE_KEY,
  editorLeadingOptions,
  loadEditorLeading,
  saveEditorLeading
} from "./editor-leading-preference";

interface FakeStorage {
  map: Map<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storage(initial: Record<string, string> = {}): FakeStorage {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      map.set(key, value);
    }
  };
}

describe("editor-leading-preference · 编辑器行距的记忆（2026-10-05）", () => {
  it("默认档 1.95 与样式表原值同值：没有这份偏好时排版一字不变", () => {
    expect(EDITOR_LEADING_DEFAULT).toBe(1.95);
    expect(loadEditorLeading(storage())).toBe(1.95);
    expect(loadEditorLeading(null)).toBe(1.95);
  });

  it("三档就是 1.75/1.95/2.2，档位集只有这一份（面板从这里取）", () => {
    expect([...EDITOR_LEADING_OPTIONS]).toEqual([1.75, 1.95, 2.2]);
    expect(editorLeadingOptions().map((option) => option.value)).toEqual([
      ...EDITOR_LEADING_OPTIONS
    ]);
    for (const option of editorLeadingOptions()) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.note.length).toBeGreaterThan(0);
    }
  });

  it("存什么读什么（数值直存直读），坏值/空串退回默认档", () => {
    const store = storage();
    saveEditorLeading(store, 2.2);
    expect(store.map.get(EDITOR_LEADING_PREFERENCE_KEY)).toBe("2.2");
    expect(loadEditorLeading(store)).toBe(2.2);
    for (const bad of ["", "abc", "2", "3", "1.5", "-1", "null"]) {
      expect([bad, loadEditorLeading(storage({ [EDITOR_LEADING_PREFERENCE_KEY]: bad }))]).toEqual([
        bad,
        1.95
      ]);
    }
  });

  it("三档互转都能读回来（设置页来回点不丢档）", () => {
    const store = storage();
    for (const value of EDITOR_LEADING_OPTIONS) {
      saveEditorLeading(store, value);
      expect(loadEditorLeading(store)).toBe(value);
    }
  });
});
