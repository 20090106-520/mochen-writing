import { describe, expect, it } from "vitest";
import {
  AUTOSAVE_DEFAULT_DELAY_MS,
  AUTOSAVE_DELAY_OPTIONS,
  AUTOSAVE_PREFERENCE_KEY,
  autosaveOptions,
  loadAutosaveDelay,
  saveAutosaveDelay
} from "./autosave-preference";

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

describe("autosave-preference · 自动保存静默窗的记忆（2026-10-05）", () => {
  it("默认档与原常量同值（2000ms）：没有这份偏好时行为一字不变", () => {
    expect(AUTOSAVE_DEFAULT_DELAY_MS).toBe(2000);
    expect(loadAutosaveDelay(storage())).toBe(2000);
    expect(loadAutosaveDelay(null)).toBe(2000);
  });

  it("四档就是 0/1/2/5 秒，档位集只有这一份（store 与面板都从这里取）", () => {
    expect([...AUTOSAVE_DELAY_OPTIONS]).toEqual([0, 1000, 2000, 5000]);
    expect(autosaveOptions().map((option) => option.value)).toEqual([...AUTOSAVE_DELAY_OPTIONS]);
    // 每一档都得有自己的中文说明，「关」那一档必须说清只剩手动保存。
    for (const option of autosaveOptions()) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.note.length).toBeGreaterThan(0);
    }
    expect(autosaveOptions()[0]?.note).toContain("手动保存");
  });

  it("存什么读什么（毫秒数直存直读），坏值退回默认档", () => {
    const store = storage();
    saveAutosaveDelay(store, 5000);
    expect(store.map.get(AUTOSAVE_PREFERENCE_KEY)).toBe("5000");
    expect(loadAutosaveDelay(store)).toBe(5000);
    for (const bad of ["", "abc", "3000", "1.5", "-1", "null"]) {
      expect([bad, loadAutosaveDelay(storage({ [AUTOSAVE_PREFERENCE_KEY]: bad }))]).toEqual([
        bad,
        2000
      ]);
    }
  });

  it("0 就是关：读回来还是 0，排程那边用它判「不排程」", () => {
    const store = storage();
    saveAutosaveDelay(store, 0);
    expect(loadAutosaveDelay(store)).toBe(0);
  });
});
