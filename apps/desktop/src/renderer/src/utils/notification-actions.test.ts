import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_ACTION_LABELS,
  isNotificationActionKind,
  type NotificationActionKind
} from "./notification-actions";

describe("通知动作表", () => {
  it("每一枚 kind 都有一句中文标签，标签不许是空串", () => {
    const kinds = Object.keys(NOTIFICATION_ACTION_LABELS) as NotificationActionKind[];
    expect(kinds.length, "动作表不能是空的——通路建了没有真动作就删掉这一层").toBeGreaterThan(0);
    for (const kind of kinds) {
      expect(
        NOTIFICATION_ACTION_LABELS[kind].trim().length,
        `${kind} 的标签是空的`
      ).toBeGreaterThan(0);
    }
  });

  it("isNotificationActionKind 只认表内的 kind", () => {
    const kinds = Object.keys(NOTIFICATION_ACTION_LABELS) as NotificationActionKind[];
    for (const kind of kinds) {
      expect(isNotificationActionKind(kind), `${kind} 应当被认出`).toBe(true);
    }
    for (const bad of [undefined, null, 42, "", "open-nothing", "Open-Model-Settings"]) {
      expect(isNotificationActionKind(bad), `${String(bad)} 不该被认成动作`).toBe(false);
    }
  });

  it("原型链上的名字不算 kind（hasOwnProperty 判据）", () => {
    expect(isNotificationActionKind("toString")).toBe(false);
    expect(isNotificationActionKind("constructor")).toBe(false);
  });
});
