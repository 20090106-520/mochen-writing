import { planDocRelPath, type BookKind, type DocRef } from "@mochen/contracts";

/**
 * 行内新建行的唯一判定：起名 → 规划路径（contracts 的 planDocRelPath）→ 与现有文档查重。
 * 判定住在 utils（本仓 .vue 不进类型程序），组件与 store 都从这里拿结论，不各写一份。
 */
export type NewDocPlan =
  | { ok: true; relPath: string }
  | { ok: false; reason: "empty" | "invalid" | "duplicate"; message: string };

export function newDocPlan(kind: BookKind, title: string, docs: DocRef[]): NewDocPlan {
  if (title.trim() === "") return { ok: false, reason: "empty", message: "先起个名字。" };
  const relPath = planDocRelPath(kind, title);
  if (relPath === null)
    return {
      ok: false,
      reason: "invalid",
      message: "这个标题起不了文件名（不能只含空格或点），换一个名字。"
    };
  if (docs.some((doc) => doc.relPath === relPath))
    return { ok: false, reason: "duplicate", message: `已经有同名的了：${relPath}。换一个名字。` };
  return { ok: true, relPath };
}

/** 各分组「+」按钮的 hover 说明：报得出点下去会发生什么（铁律：名字与动作相符）。 */
export function newDocButtonTitle(kindLabel: string): string {
  return `在${kindLabel}分组里新建一篇`;
}
