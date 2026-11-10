import { PERMISSION_LABELS, type PermissionMode } from "@mochen/contracts";
import type { IconName } from "../types/icons";

/** 无书时档位那一格的诚实文案（设计决定 4：不开口冒充任何档位名）。
 *  2026-11-10 由「未打开作品目录」收到四个字：它是右端那一排最长的一串灰字（真机 135px），
 *  而同一句话在卡底「选择作品」那一行已经说过了，这里只需要一个不冒充档位的短标签。 */
export const NO_BOOK_CHIP_LABEL = "未选作品";

/**
 * 每一档的图标（#112 照参考图：档位那一枚前面带一枚图形，右端带下拉三角）。
 * 口径对齐 deepwrite 的 `approvalModeIcon`（他那里「先问我」= user、「自动批准」= check），
 * 本仓三档按同一语义落：只读=一切由你（user）、可改当前章=动手改（edit）、全开=自动批准（check）。
 * 住在 `.ts` 而不是模板：铁律 6，且 `Record<PermissionMode, …>` 的穷尽性只有裸 tsc 才咬得住。
 */
export const PERMISSION_CHIP_ICON: Record<PermissionMode, IconName> = {
  "read-only": "user",
  "chapter-write": "edit",
  "full-access": "check"
};

export interface PermissionChipView {
  text: string;
  disabled: boolean;
  title: string;
  icon: IconName;
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
    // 图标说「目录」不说档位：这一格此刻讲的是有没有开书，不是任何一档权限。
    return {
      text: NO_BOOK_CHIP_LABEL,
      disabled: true,
      title: "还没打开作品目录，权限档改不了。",
      icon: "folder"
    };
  }
  const label = PERMISSION_LABELS[input.mode];
  return {
    text: label,
    disabled: input.saving,
    title: input.saving ? "正在保存权限档…" : `当前权限档：${label}，点击切换`,
    icon: PERMISSION_CHIP_ICON[input.mode]
  };
}
