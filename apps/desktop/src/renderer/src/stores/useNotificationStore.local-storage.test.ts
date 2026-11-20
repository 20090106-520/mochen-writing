import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useNotificationStore } from "./useNotificationStore";

/**
 * 盘上坏形状不许把界面带崩（2026-11-20 审计 R-5）。
 *
 * `load()` 里的 `try` 只包得住 `JSON.parse`：存成 `{}` 这类**合法** JSON 时它照样返回成功，
 * 坏形状随后在 computed 里 `.filter(...)` 才炸——通知铃铛整块渲染直接挂掉。
 */

const STORAGE_KEY = "mochen.notifications.v1";

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

describe("useNotificationStore 读回坏形状", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("存成对象（不是数组）时回空，不抛错", () => {
    fakeStorage({ [STORAGE_KEY]: "{}" });
    const store = useNotificationStore();

    expect(store.notifications).toEqual([]);
    expect(store.unreadCount).toBe(0);
    expect(store.recentNotifications).toEqual([]);
  });

  it("数组里混着坏条目：只留形状完整的那条", () => {
    fakeStorage({
      [STORAGE_KEY]: JSON.stringify([
        {
          id: "n1",
          title: "导出完成",
          message: "已保存",
          level: "success",
          timestamp: 1,
          read: false
        },
        { id: "n2" },
        null,
        "不是对象"
      ])
    });
    const store = useNotificationStore();

    expect(store.notifications.map((one) => one.id)).toEqual(["n1"]);
  });

  it("level 不在四档里的条目也剔掉（渲染按档上色）", () => {
    fakeStorage({
      [STORAGE_KEY]: JSON.stringify([
        { id: "n1", title: "t", message: "m", level: "info", timestamp: 1, read: false },
        { id: "n2", title: "t", message: "m", level: "fatal", timestamp: 2, read: false }
      ])
    });
    const store = useNotificationStore();

    expect(store.notifications.map((one) => one.id)).toEqual(["n1"]);
  });
});
