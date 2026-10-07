export const PERMISSION_MODES = ["read-only", "chapter-write", "full-access"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];
// 用户裁定：新书默认「全开」——智能体可直接落稿，审批只在显式切档时收紧。
export const DEFAULT_PERMISSION_MODE: PermissionMode = "full-access";

export const PERMISSION_LABELS: Record<PermissionMode, string> = {
  "read-only": "只读参考",
  "chapter-write": "可改当前章",
  "full-access": "全开"
};

/**
 * 工作模式（2026-10-05 批次 4）：「先计划后动手」的那一格。
 *
 * 与权限档是**两道不同的闸**，别混：权限档管「能碰多大范围」，工作模式管「这一轮动不动手」。
 * `plan` 档下智能体照样能读、能出提案、能说话，但**一个字都不落盘**——
 * 这不是「更紧的只读」，只读档是它自己选的，这是用户选的。
 *
 * 住 contracts 而不是渲染层/主进程各写一份：批准提案与放行 write_doc 都要判它，
 * 提案卡还要用它说「切到哪一格就能批」。三处一个函数（铁律 6）。
 */
export const WORK_MODES = ["plan", "act"] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  plan: "先计划",
  act: "直接动手"
};

/**
 * 书级工作模式的唯一读法（老书没有这一格 ⇒ `act`，也就是改动前的行为）。
 *
 * 为什么不让调用方直接 `meta.workMode ?? "act"`：那个 `??` 会被抄到四个地方，
 * 抄漏一处就有一本老书在计划模式之外偷偷落盘。默认值只住这一处。
 */
export function workModeOf(meta: { workMode?: WorkMode | undefined }): WorkMode {
  return meta.workMode === "plan" ? "plan" : "act";
}

/**
 * 作品文稿的五个顶层目录；book.json 与 .mochen/ 永远在天花板之外。
 *
 * 住在 contracts 而不是 agent-runtime：这道「能不能写」的闸，主进程在批准时判一次，
 * 渲染层在提案卡上也要判一次（才能说出「切到哪一档之后这条就能批」）。判定只有一份
 * （铁律 6），所以连目录清单都得在两边都能读到的地方——agent-runtime 那边从 contracts 转出。
 */
export const WRITABLE_TOP_DIRS = [
  "chapters",
  "outline",
  "characters",
  "plot",
  "materials"
] as const;

export interface WriteVerdictInput {
  mode: PermissionMode;
  docRelPath: string;
  /** 审批时这条提案所绑线程的文稿；null = 独立线程（没打开文稿标签）。 */
  currentChapter: string | null;
  /**
   * 工作模式。**必填、没有默认**——同 `startTurnInputSchema` 里那两枚每轮开关的同一条理由：
   * 少传一个字段就悄悄按「直接动手」发出去，真机上「闸坏了」和「用户没开计划」就分不出来。
   * 老书没这一格时用 `workModeOf(meta)` 取，不要在这里兜一个默认值。
   */
  workMode: WorkMode;
}

/** 判定结果。**不含任何文案**——中文理由住 agent-runtime（模型侧）与人可见的一侧，各说各的。 */
export type WriteVerdict =
  | { kind: "allowed" }
  /**
   * 先计划后动手：`plan` 档下什么都不落盘。
   * 排在所有档位判据**之前**——它是更硬的那道闸，先报它用户才知道「切档没用」；
   * 反过来先报档位，用户切完发现还是落不了盘，像坏了。
   */
  | { kind: "plan-mode" }
  /** 目标不在作品文稿目录内：再大的档也没用，切档解决不了。 */
  | { kind: "outside-writable" }
  /** 档位太紧；`needed` 是**够用的最低一档**（不保证用户就该选它，但至少那档真能过）。 */
  | { kind: "mode-too-tight"; needed: PermissionMode }
  /** chapter-write 档但没选定当前章，无处可写。 */
  | { kind: "no-current-chapter" }
  | { kind: "not-current-chapter"; currentChapter: string };

export function writeVerdict(input: WriteVerdictInput): WriteVerdict {
  if (input.workMode === "plan") return { kind: "plan-mode" };
  const top = input.docRelPath.split("/")[0] ?? "";
  if (!(WRITABLE_TOP_DIRS as readonly string[]).includes(top)) return { kind: "outside-writable" };
  if (input.mode === "read-only") {
    return {
      kind: "mode-too-tight",
      needed: minimumModeFor(input.docRelPath, input.currentChapter)
    };
  }
  if (input.mode === "chapter-write") {
    if (input.currentChapter === null) return { kind: "no-current-chapter" };
    if (input.docRelPath !== input.currentChapter) {
      return { kind: "not-current-chapter", currentChapter: input.currentChapter };
    }
  }
  return { kind: "allowed" };
}

/**
 * 这条提案**够用的最低档**：目标就是当前章 ⇒ `chapter-write`，否则 ⇒ `full-access`。
 * 调用方拿它去查 `PERMISSION_LABELS` 拼中文，不许在这里返回字面量（铁律 6）。
 *
 * 目标不在可写目录内时仍返回 `full-access`（那是够用的最低档），由调用方先看
 * `writeVerdict().kind === "outside-writable"` 决定要不要展示「切档」这条路——
 * 否则会给用户一颗按了也没用的按钮。
 */
export function minimumModeFor(docRelPath: string, currentChapter: string | null): PermissionMode {
  return currentChapter !== null && docRelPath === currentChapter ? "chapter-write" : "full-access";
}
