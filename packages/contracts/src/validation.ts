import type { ZodError } from "zod";

/**
 * 边界拒绝跨 IPC 前必须收成**单句中文**（裁定 n）：
 * 裸 ZodError 过 `ipcMain.handle` 到渲染层会长成
 * `Error invoking remote method ...: ZodError: [ { "origin": "string", ... } ]`，
 * 既把 issue 数组原文交给渲染层，也违反「面向用户文案一律简体中文」。
 * 所以调用方的写法固定为两行：
 * `const r = schema.safeParse(x); if (!r.success) throw new Error(firstIssueMessage(r.error, "中文兜底"));`
 * 这里只取第一条 issue 的 message（用户最先撞到的那条），空白或缺失时退回中文兜底。
 */
export function firstIssueMessage(error: ZodError, fallback: string): string {
  const message = error.issues[0]?.message?.trim();
  return message === undefined || message === "" ? fallback : message;
}
