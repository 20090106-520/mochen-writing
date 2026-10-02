import { PERMISSION_LABELS, type PermissionMode } from "@mochen/contracts";

/** 无书时档位那一格的诚实文案（设计决定 4：不开口冒充任何档位名）。 */
export const NO_BOOK_CHIP_LABEL = "未打开作品目录";

export interface PermissionChipView {
  text: string;
  disabled: boolean;
  title: string;
}

/**
 * 档位 chip 的显示判定，唯一一份（判定下沉 utils，`.vue` 只接线）。
 * 无书 ⇒ 报「未打开作品目录」、disabled、且不挂 PermissionMenu；
 * 有书 ⇒ 文案只读 PERMISSION_LABELS（不兜底 DEFAULT_PERMISSION_MODE，那是「没开书也报档位名」的根）。
 * hasBook 是第一裁决项：即便调用点误传了一个 mode，无书也绝不泄露档位名（对应波 1 报告的捏造缺陷）。
 */
export function permissionChipView(input: {
  hasBook: boolean;
  mode: PermissionMode | null;
  saving: boolean;
}): PermissionChipView {
  if (!input.hasBook || input.mode === null) {
    return {
      text: NO_BOOK_CHIP_LABEL,
      disabled: true,
      title: "还没打开作品目录，权限档改不了。"
    };
  }
  const label = PERMISSION_LABELS[input.mode];
  return {
    text: label,
    disabled: input.saving,
    title: input.saving ? "正在保存权限档…" : `当前权限档：${label}，点击切换`
  };
}
