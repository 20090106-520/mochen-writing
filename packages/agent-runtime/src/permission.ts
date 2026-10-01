import { PERMISSION_LABELS, type PermissionMode } from "@mochen/contracts";

/** 作品文稿的五个顶层目录；book.json 与 .mochen/ 永远在天花板之外。 */
export const WRITABLE_TOP_DIRS = [
  "chapters",
  "outline",
  "characters",
  "plot",
  "materials"
] as const;

export interface WritePermissionInput {
  mode: PermissionMode;
  docRelPath: string;
  currentChapter: string | null;
}

export interface WritePermissionResult {
  allowed: boolean;
  reason: string;
}

function insideWritableDir(relPath: string): boolean {
  const top = relPath.split("/")[0] ?? "";
  return (WRITABLE_TOP_DIRS as readonly string[]).includes(top);
}

export function checkWritePermission(input: WritePermissionInput): WritePermissionResult {
  if (!insideWritableDir(input.docRelPath))
    return {
      allowed: false,
      reason:
        `${input.docRelPath} 不在作品文稿目录内。只允许写入 ${WRITABLE_TOP_DIRS.join("/")}，` +
        "book.json 与 .mochen/ 由本机管理，智能体不能碰。"
    };
  if (input.mode === "read-only")
    return {
      allowed: false,
      // F-2：不点名任何界面位置（左栏权限档切换器属 Plan 3，当前版本没有这个入口），
      // 档位名读 PERMISSION_LABELS，不手抄字面量。
      reason:
        `当前权限档为「${PERMISSION_LABELS["read-only"]}」，提案不会写入磁盘。` +
        "可以先给出提案与理由；确实要落盘时，把权限档切到" +
        `「${PERMISSION_LABELS["chapter-write"]}」或「${PERMISSION_LABELS["full-access"]}」后再批准。`
    };
  if (input.mode === "chapter-write") {
    if (input.currentChapter === null)
      return {
        allowed: false,
        reason: `当前权限档为「${PERMISSION_LABELS["chapter-write"]}」，但尚未选定当前章，无处可写。`
      };
    if (input.docRelPath !== input.currentChapter)
      return {
        allowed: false,
        reason: `当前权限档为「${PERMISSION_LABELS["chapter-write"]}」，只能写入当前章 ${input.currentChapter}。`
      };
  }
  return {
    allowed: true,
    reason: `当前权限档「${PERMISSION_LABELS[input.mode]}」允许写入 ${input.docRelPath}。`
  };
}
