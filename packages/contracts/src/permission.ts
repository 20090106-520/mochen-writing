export const PERMISSION_MODES = ["read-only", "chapter-write", "full-access"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];
export const DEFAULT_PERMISSION_MODE: PermissionMode = "read-only";

export const PERMISSION_LABELS: Record<PermissionMode, string> = {
  "read-only": "只读参考",
  "chapter-write": "可改当前章",
  "full-access": "全开"
};
