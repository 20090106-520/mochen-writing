/**
 * 审批时读原稿的那一读（三态）。
 *
 * 【为什么单独成一份】这一读只服务审批，语义却不平凡：后两种状态**绝不能合并**——
 * 把「这一秒读不到」（EBUSY / EACCES / EISDIR…）当成「确实从没写过」，
 * 会让一条空指纹基线通过比对，于是一个刚出现的新文件被**无备份地盖掉**。
 * 它原先挤在 agent-service.ts 里，而那个文件已经贴着行数预算（800）的上限；
 * 这一块自足、只依赖 @mochen/fs-store，搬出来不改变任何判定。
 */
import { readDocFile } from "@mochen/fs-store";

export type ApprovalRead =
  | { status: "ok"; content: string; fingerprint: string }
  | { status: "absent" }
  | { status: "unreadable"; message: string };

export async function readForApproval(root: string, relPath: string): Promise<ApprovalRead> {
  try {
    const file = await readDocFile(root, relPath);
    return { status: "ok", content: file.content, fingerprint: file.fingerprint };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "absent" };
    return {
      status: "unreadable",
      message: error instanceof Error ? error.message : String(error)
    };
  }
}
