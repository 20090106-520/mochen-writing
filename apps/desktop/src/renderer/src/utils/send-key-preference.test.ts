import { describe, expect, it } from "vitest";
import {
  SUBMIT_KEY_DEFAULT,
  SUBMIT_KEY_OPTIONS,
  SUBMIT_KEY_PREFERENCE_KEY,
  loadSubmitKey,
  saveSubmitKey,
  submitKeyOptions
} from "./send-key-preference";

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

describe("send-key-preference · 发送键档位的记忆（2026-10-05）", () => {
  it("默认档 enter 与原键位表同值：没有这份偏好时键位一字不变", () => {
    expect(SUBMIT_KEY_DEFAULT).toBe("enter");
    expect(loadSubmitKey(storage())).toBe("enter");
    expect(loadSubmitKey(null)).toBe("enter");
  });

  it("两档就是 enter / ctrl-enter，档位集只有这一份（面板从这里取）", () => {
    expect([...SUBMIT_KEY_OPTIONS]).toEqual(["enter", "ctrl-enter"]);
    expect(submitKeyOptions().map((option) => option.value)).toEqual([...SUBMIT_KEY_OPTIONS]);
    // 每一档都得有自己的中文说明；ctrl-enter 那档必须讲清「回车只换行」。
    for (const option of submitKeyOptions()) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.note.length).toBeGreaterThan(0);
    }
    expect(submitKeyOptions()[1]?.note).toContain("换行");
  });

  it("存什么读什么，坏值/空串退回默认档", () => {
    const store = storage();
    saveSubmitKey(store, "ctrl-enter");
    expect(store.map.get(SUBMIT_KEY_PREFERENCE_KEY)).toBe("ctrl-enter");
    expect(loadSubmitKey(store)).toBe("ctrl-enter");
    for (const bad of ["", " ", "tab", "meta-enter", "null"]) {
      expect([bad, loadSubmitKey(storage({ [SUBMIT_KEY_PREFERENCE_KEY]: bad }))]).toEqual([
        bad,
        "enter"
      ]);
    }
  });

  it("两档互转都能读回来（设置页来回点不丢档）", () => {
    const store = storage();
    saveSubmitKey(store, "ctrl-enter");
    expect(loadSubmitKey(store)).toBe("ctrl-enter");
    saveSubmitKey(store, "enter");
    expect(loadSubmitKey(store)).toBe("enter");
  });
});
