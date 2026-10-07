import { PERMISSION_LABELS, PERMISSION_MODES, type PermissionMode } from "@mochen/contracts";

/**
 * 三档权限各自「这一档允许 AI 做什么」的实话（2026-10-05 设置页新增）。
 *
 * 逐句都对应 agent-runtime 的 checkWritePermission：闸的是**写盘意图**，不是「能不能提提案」——
 * 三档下 AI 都读得了全书、都提得了提案，差别只在批准后允许落到哪些文件上。
 * 文案不许暗示「全开 = 不经审批自动写」：本版任何一档都是逐条审批后才落盘。
 */
export const PERMISSION_MODE_NOTES: Record<PermissionMode, string> = {
  "read-only": "读得了整本书、提得了修改提案，但批准后也一个字不落盘。",
  "chapter-write": "只写得进你正在看的那一张文稿；别处的提案批准了也不落盘。",
  "full-access": "整本书都写得进；仍然逐条等你批准，批准后才落盘。"
};

export interface PermissionOption {
  value: PermissionMode;
  label: string;
  note: string;
}

/** 三档选项：标签取 contracts 的 PERMISSION_LABELS，顺序取 PERMISSION_MODES，本仓不抄第二份中文。 */
export function permissionOptions(): PermissionOption[] {
  return PERMISSION_MODES.map((mode) => ({
    value: mode,
    label: PERMISSION_LABELS[mode],
    note: PERMISSION_MODE_NOTES[mode]
  }));
}
