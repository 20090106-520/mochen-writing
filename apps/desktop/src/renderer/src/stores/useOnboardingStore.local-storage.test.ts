import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useOnboardingStore } from "./useOnboardingStore";

/**
 * 盘上坏形状不许把引导带崩（2026-11-20 审计 R-5）。
 *
 * 原实现拿到 `{}` 后原样返回：`completed` 是 undefined，`currentStep` 也不在白名单里，
 * 于是 `STEP_ORDER.indexOf` 算出 -1、进度变成负数——引导面板整块渲染失败。
 */

const STORAGE_KEY = "mochen.onboarding.v1";

function fakeStorage(seed: Record<string, string>): void {
  const cells = new Map(Object.entries(seed));
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => cells.get(key) ?? null,
      setItem: (key: string, value: string) => {
        cells.set(key, value);
      },
      removeItem: (key: string) => {
        cells.delete(key);
      }
    }
  });
}

describe("useOnboardingStore 读回坏形状", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("存成 {} 时回到默认首步，进度不为负", () => {
    fakeStorage({ [STORAGE_KEY]: "{}" });
    const store = useOnboardingStore();

    expect(store.currentStep).toBe("welcome");
    expect(store.state.completed).toBe(false);
    expect(store.showGuide).toBe(true);
    expect(store.progress).toBe(0);
  });

  it("currentStep 不在白名单里时回 welcome，其余合法字段保留", () => {
    fakeStorage({
      [STORAGE_KEY]: JSON.stringify({ completed: false, currentStep: "乱写", showGuide: false })
    });
    const store = useOnboardingStore();

    expect(store.currentStep).toBe("welcome");
    expect(store.showGuide).toBe(false);
  });

  it("已完成的那一份：复盘时不再弹引导", () => {
    fakeStorage({
      [STORAGE_KEY]: JSON.stringify({ completed: true, currentStep: "complete", showGuide: true })
    });
    const store = useOnboardingStore();

    expect(store.state.completed).toBe(true);
    expect(store.currentStep).toBe("complete");
    expect(store.showGuide).toBe(false);
  });
});
