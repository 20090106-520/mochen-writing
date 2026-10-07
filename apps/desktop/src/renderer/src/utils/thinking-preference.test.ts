import { describe, expect, it } from "vitest";
import {
  THINKING_LEVEL_STORAGE_KEY,
  THINKING_PREFERENCE_KEY,
  THINKING_REMEMBER_DEFAULT,
  clearThinkingLevel,
  loadThinkingLevel,
  loadThinkingRemember,
  saveThinkingLevel,
  saveThinkingRemember
} from "./thinking-preference";

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

describe("thinking-preference · 「记住思考档」的记忆（2026-10-05）", () => {
  it("默认不记（false）：每次启动从「关」开始是现状，开关只是把记忆权交给用户", () => {
    expect(THINKING_REMEMBER_DEFAULT).toBe(false);
    expect(loadThinkingRemember(storage())).toBe(false);
  });

  it("开关存 on/off；关掉时档位记忆一并清掉，不留半份", () => {
    const store = storage();
    saveThinkingRemember(store, true);
    expect(loadThinkingRemember(store)).toBe(true);
    saveThinkingLevel(store, "high");
    expect(loadThinkingLevel(store)).toBe("high");
    saveThinkingRemember(store, false);
    expect(store.map.get(THINKING_PREFERENCE_KEY)).toBeUndefined();
    clearThinkingLevel(store);
    expect(store.map.get(THINKING_LEVEL_STORAGE_KEY)).toBeUndefined();
  });

  it("坏值一律按「不记」处理", () => {
    for (const bad of ["", "true", "ON", "1", "yes"]) {
      expect(loadThinkingRemember(storage({ [THINKING_PREFERENCE_KEY]: bad }))).toBe(false);
    }
  });

  it("档位键与开关键是两枚键：档位只存字符串，合法性由调用方对照 contracts 校验", () => {
    const store = storage();
    saveThinkingLevel(store, "deep");
    expect(store.map.get(THINKING_LEVEL_STORAGE_KEY)).toBe("deep");
    expect(loadThinkingLevel(store)).toBe("deep");
  });
});
