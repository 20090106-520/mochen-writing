/**
 * 通知分级驻留表（2026-11-20 通知整修 A1+C1）。
 *
 * 【为什么要有这一张表】
 * Toast 原先对四种级别一律 4 秒自动消失——「导出失败」和「草稿已预填」在屏幕上
 * 逗留的时间一样长，而前者恰恰是用户最需要多看两眼的。
 * 收成纯函数是为了能钉边界（本仓判据一律住 utils，.vue 不进类型程序）。
 *
 * 数值口径：
 * - info / success 4s：确认型提示，扫一眼标题就够；
 * - warning 7s：需要读理由（「为什么按不了」这一族），单行截断时 4s 读不完；
 * - error 12s：失败理由往往是最长的一句，而且错过就只剩通知中心（2026-11-20 起）能找回。
 */
import type { NotificationLevel } from "../stores/useNotificationStore";

const DWELL_MS: Record<NotificationLevel, number> = {
  info: 4000,
  success: 4000,
  warning: 7000,
  error: 12000
};

/** 一条通知按级别该在屏幕上逗留多少毫秒。未知级别按最保守的 error 档。 */
export function notificationDwellMs(level: NotificationLevel): number {
  return DWELL_MS[level] ?? DWELL_MS.error;
}
