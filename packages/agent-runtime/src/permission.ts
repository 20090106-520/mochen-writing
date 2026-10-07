import {
  PERMISSION_LABELS,
  WORK_MODE_LABELS,
  WRITABLE_TOP_DIRS,
  writeVerdict,
  type PermissionMode,
  type WorkMode
} from "@mochen/contracts";

export { WRITABLE_TOP_DIRS };

export interface WritePermissionInput {
  mode: PermissionMode;
  docRelPath: string;
  currentChapter: string | null;
  /** 工作模式：必填、无默认（理由同 contracts 的 WriteVerdictInput.workMode）。 */
  workMode: WorkMode;
}

export interface WritePermissionResult {
  allowed: boolean;
  reason: string;
}

/**
 * 档位闸的**中文理由**。判定本身在 contracts 的 writeVerdict（渲染层的提案卡要判同一件事，
 * 铁律 6），本文件只负责把判定结果说成人话——两边共用一份判定，文案各说各的。
 */
export function checkWritePermission(input: WritePermissionInput): WritePermissionResult {
  const verdict = writeVerdict(input);
  if (verdict.kind === "allowed") {
    return {
      allowed: true,
      reason: `当前权限档「${PERMISSION_LABELS[input.mode]}」允许写入 ${input.docRelPath}。`
    };
  }
  // 这句要回喂给模型，所以必须**说清下一步**：只说「被拒了」，模型会反复换写法重试。
  if (verdict.kind === "plan-mode") {
    return {
      allowed: false,
      reason:
        `工作模式是「${WORK_MODE_LABELS.plan}」，这一轮不写入磁盘。` +
        "把打算先讲出来（改哪几篇、每篇改什么、为什么），等人批准；" +
        `确要落盘时，把工作模式切到「${WORK_MODE_LABELS.act}」后再批准。`
    };
  }
  if (verdict.kind === "outside-writable") {
    return {
      allowed: false,
      reason:
        `${input.docRelPath} 不在作品文稿目录内。只允许写入 ${WRITABLE_TOP_DIRS.join("/")}，` +
        "book.json 与 .mochen/ 由本机管理，智能体不能碰。"
    };
  }
  if (verdict.kind === "mode-too-tight") {
    return {
      allowed: false,
      // 档位名读 PERMISSION_LABELS，不手抄字面量；`needed` 就是提案卡上那颗按钮要切过去的那一档。
      reason:
        `当前权限档为「${PERMISSION_LABELS["read-only"]}」，提案不会写入磁盘。` +
        "可以先给出提案与理由；确实要落盘时，把权限档切到" +
        `「${PERMISSION_LABELS[verdict.needed]}」后再批准。`
    };
  }
  if (verdict.kind === "no-current-chapter") {
    return {
      allowed: false,
      reason: `当前权限档为「${PERMISSION_LABELS["chapter-write"]}」，但尚未选定当前章，无处可写。`
    };
  }
  return {
    allowed: false,
    reason: `当前权限档为「${PERMISSION_LABELS["chapter-write"]}」，只能写入当前章 ${verdict.currentChapter}。`
  };
}
