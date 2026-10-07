/**
 * 正文列宽档位的单测（2026-10-06）。
 *
 * 密度与 `autosave-preference.test.ts` / `editor-leading-preference.test.ts` 照抄：
 * 默认档 ↔ 样式表现值、档位集唯一、坏值退回默认、逐档往返。
 * 最后一条是跨文件的那道关：默认档必须与 `styles/editor-pane.css` 里 var 的兜底**同一个值**——
 * 两边不互相冒充默认档，否则「没设置过」就会悄悄换一种版式。
 */
import { describe, expect, it } from "vitest";
import {
  EDITOR_MEASURE_DEFAULT,
  EDITOR_MEASURE_OPTIONS,
  EDITOR_MEASURE_PREFERENCE_KEY,
  editorMeasureOptions,
  loadEditorMeasure,
  saveEditorMeasure
} from "./editor-measure-preference";
import { styleSource } from "./vue-source-reader";

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

describe("editor-measure-preference · 正文列宽的记忆（2026-10-06）", () => {
  it("默认档 none：原版式没有 max-width，none 就是「不设上限」，没设置过时排版一字不变", () => {
    expect(EDITOR_MEASURE_DEFAULT).toBe("none");
    expect(loadEditorMeasure(storage())).toBe("none");
    expect(loadEditorMeasure(null)).toBe("none");
  });

  it("六档就是 none/44/52/60/68/76 ch，档位集只有这一份（面板从这里取）", () => {
    expect([...EDITOR_MEASURE_OPTIONS]).toEqual(["none", "44ch", "52ch", "60ch", "68ch", "76ch"]);
    expect(editorMeasureOptions().map((option) => option.value)).toEqual([
      ...EDITOR_MEASURE_OPTIONS
    ]);
    // 每档都得有自己的 label 与 note，且彼此不同（同一句话抄六遍等于没有档位）。
    const notes = editorMeasureOptions().map((option) => option.note);
    expect(new Set(notes).size).toBe(notes.length);
    for (const option of editorMeasureOptions()) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.note.length).toBeGreaterThan(0);
    }
  });

  it("存什么读什么（档位就是 CSS 长度，直存直读），坏值退回默认档", () => {
    const store = storage();
    saveEditorMeasure(store, "60ch");
    expect(store.map.get(EDITOR_MEASURE_PREFERENCE_KEY)).toBe("60ch");
    expect(loadEditorMeasure(store)).toBe("60ch");
    // 单位与大小写都算坏值：档位表是逐字比的不是解析出来的。
    for (const bad of ["", "abc", "60px", "60CH", "0", "100%", "-1", "null"]) {
      expect([bad, loadEditorMeasure(storage({ [EDITOR_MEASURE_PREFERENCE_KEY]: bad }))]).toEqual([
        bad,
        "none"
      ]);
    }
  });

  it("六档互转都能读回来（设置页来回点不丢档）", () => {
    const store = storage();
    for (const value of EDITOR_MEASURE_OPTIONS) {
      saveEditorMeasure(store, value);
      expect(loadEditorMeasure(store)).toBe(value);
    }
  });

  it("默认档与样式表 var 的兜底同值：从 CSS 里把兜底抠出来比，不抄一份字面量", () => {
    const css = styleSource("editor-pane.css");
    const fallback = /max-width:\s*var\(--editor-measure,\s*([^)]+)\)/.exec(css)?.[1]?.trim();
    expect(fallback, "editor-pane.css 里找不到 --editor-measure 的兜底").toBeDefined();
    expect(fallback).toBe(EDITOR_MEASURE_DEFAULT);
  });
});
