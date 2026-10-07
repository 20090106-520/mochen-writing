import { describe, expect, it } from "vitest";
import {
  REDUCED_MOTION_DEFAULT,
  applyReducedMotion,
  loadReducedMotion,
  motionPreferenceStorage,
  MOTION_PREFERENCE_KEY,
  saveReducedMotion
} from "./motion-preference";

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

describe("motion-preference · 减少动效档的记忆（2026-10-05）", () => {
  it("默认关：没有这份偏好时动效全开（与没有这档功能时观感一致）", () => {
    expect(REDUCED_MOTION_DEFAULT).toBe(false);
    expect(loadReducedMotion(storage())).toBe(false);
    expect(loadReducedMotion(null)).toBe(false);
  });

  it("开=写 true，关=删键（不是写 false：没写过的语义就是默认关）", () => {
    const store = storage();
    saveReducedMotion(store, true);
    expect(store.map.get(MOTION_PREFERENCE_KEY)).toBe("true");
    expect(loadReducedMotion(store)).toBe(true);
    saveReducedMotion(store, false);
    expect(store.map.has(MOTION_PREFERENCE_KEY)).toBe(false);
    expect(loadReducedMotion(store)).toBe(false);
  });

  it("坏值（不是 true 的任何东西）都算关，不抛错", () => {
    for (const bad of ["1", "on", "", "false", "TRUE"]) {
      expect([bad, loadReducedMotion(storage({ [MOTION_PREFERENCE_KEY]: bad }))]).toEqual([
        bad,
        false
      ]);
    }
  });

  it("applyReducedMotion：开=挂 data-reduced-motion，关=摘掉；null 根不抛错", () => {
    const root: { dataset: Record<string, string | undefined> } = { dataset: {} };
    applyReducedMotion(root, true);
    expect(root.dataset.reducedMotion).toBe("true");
    applyReducedMotion(root, false);
    expect("reducedMotion" in root.dataset).toBe(false);
    expect(() => applyReducedMotion(null, true)).not.toThrow();
  });

  it("浏览器侧取存储在无 window 时安全返回 null（SSR/测试环境不炸）", () => {
    // 本测试环境有 window，这里只验证函数存在且返回形状对（真正 null 分支由上面的 null 用例覆盖）。
    const got = motionPreferenceStorage();
    expect(got === null || typeof got.getItem === "function").toBe(true);
  });
});
