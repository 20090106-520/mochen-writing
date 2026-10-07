import { describe, expect, it } from "vitest";
import {
  WEB_SEARCH_DEFAULT,
  WEB_SEARCH_PREFERENCE_KEY,
  loadWebSearchDefault,
  saveWebSearchDefault
} from "./web-search-preference";

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

describe("web-search-preference · 联网默认档的记忆（2026-10-05）", () => {
  it("没存过 ⇒ 退回默认（关）：出网是显式动作，不该由「上次忘了关」替用户决定", () => {
    expect(WEB_SEARCH_DEFAULT).toBe(false);
    expect(loadWebSearchDefault(storage())).toBe(false);
  });

  it("存过 on ⇒ 开；存过 off ⇒ 关", () => {
    expect(loadWebSearchDefault(storage({ [WEB_SEARCH_PREFERENCE_KEY]: "on" }))).toBe(true);
    expect(loadWebSearchDefault(storage({ [WEB_SEARCH_PREFERENCE_KEY]: "off" }))).toBe(false);
  });

  it("坏值一律按关处理：读坏了退回默认，不让设置页开不了", () => {
    for (const bad of ["", "true", "ON", "1", "yes", "on "]) {
      expect([bad, loadWebSearchDefault(storage({ [WEB_SEARCH_PREFERENCE_KEY]: bad }))]).toEqual([
        bad,
        false
      ]);
    }
  });

  it("写进去的就是读回来认的那两个值（save/load 同键同形）", () => {
    const store = storage();
    saveWebSearchDefault(store, true);
    expect(store.map.get(WEB_SEARCH_PREFERENCE_KEY)).toBe("on");
    expect(loadWebSearchDefault(store)).toBe(true);
    saveWebSearchDefault(store, false);
    expect(loadWebSearchDefault(store)).toBe(false);
  });
});
