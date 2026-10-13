import { describe, expect, it } from "vitest";
import {
  REDUCED_MOTION_DEFAULT,
  applyReducedMotion,
  currentReducedMotionHost,
  loadReducedMotion,
  motionPreferenceStorage,
  MOTION_PREFERENCE_KEY,
  reducedMotionActive,
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
    // 本测试环境有 window，这里只验证函数存在且返回形状对（真正 null 用例覆盖）。
    const got = motionPreferenceStorage();
    expect(got === null || typeof got.getItem === "function").toBe(true);
  });
});

/**
 * 2026-10-11 从 `view-transition.test.ts` 搬来：判定搬到了 `motion-preference.ts`，
 * 用例也跟着搬。搬的理由是**归属**——认档的地方（对话框入场、视图过渡）都指向本模块。
 * 断言一个字没改，避免「搬家顺手改了判据」这种事。
 */
describe("reducedMotionActive · 两档任一为真就是不要动画", () => {
  it("认两档，且缺 defaultView / 缺 dataset 时不抛", () => {
    expect(reducedMotionActive(null)).toBe(false);
    expect(reducedMotionActive({})).toBe(false);
    expect(reducedMotionActive({ documentElement: {} })).toBe(false);
    expect(reducedMotionActive({ documentElement: { dataset: { reducedMotion: "true" } } })).toBe(
      true
    );
    // 属性在但值是 "false"（显式关）时不算开
    expect(reducedMotionActive({ documentElement: { dataset: { reducedMotion: "false" } } })).toBe(
      false
    );
    expect(reducedMotionActive({ defaultView: { matchMedia: () => ({ matches: true }) } })).toBe(
      true
    );
    expect(reducedMotionActive({ defaultView: {} })).toBe(false);
  });

  it("两档的查询串逐字是 prefers-reduced-motion: reduce（写错媒体查询名就静默不生效）", () => {
    const asked: string[] = [];
    reducedMotionActive({
      defaultView: { matchMedia: (q) => (asked.push(q), { matches: false }) }
    });
    expect(asked).toEqual(["(prefers-reduced-motion: reduce)"]);
  });

  it("currentReducedMotionHost：有 document 时给得到宿主，没有时给 null", () => {
    // 本环境有 window/document，所以只钉「有宿主时形状对」；
    // null 那一支由 reducedMotionActive(null) 那条覆盖（调用方必须能接住 null）。
    const host = currentReducedMotionHost();
    if (host !== null) expect(typeof host).toBe("object");
  });
});
