import type { PermissionMode } from "@mochen/contracts";
import { permissionChipView } from "./permission-chip";

export type ComposerChipId = "permission" | "palette";

export interface ComposerChipView {
  id: ComposerChipId;
  text: string;
  disabled: boolean;
  title: string;
}

export function composerChips(input: {
  hasBook: boolean;
  mode: PermissionMode | null;
  saving: boolean;
}): ComposerChipView[] {
  // 权限 chip 只调 permissionChipView 一次，不重算（设计决定 4）。
  const permission = permissionChipView(input);
  return [
    {
      id: "permission",
      text: permission.text,
      disabled: permission.disabled,
      title: permission.title
    },
    {
      id: "palette",
      text: "/ 命令",
      disabled: false,
      // T9-1：实测 hotkeys.ts:78-96 的全局 Ctrl 族没有 k，键位真身在 :98-100 的裸 / 键；
      // 旧文案宣传的「Ctrl+K 同一个入口」是不存在的键位，反向钉见 composer-chips.test.ts 第一条。
      title: "打开 / 命令面板（与直接按 / 键同一个入口）"
    }
  ];
  // 裁定 C：这里**不返回**队列数字。排队列数唯一的可见真身是 useAgentStore 的 composeStatusLine
  // （useAgentStore.ts:144，「排队 N 条」，波 1 已有单测与真机观察）；chip 行再显示一次就是同一个数两份文案。
}
