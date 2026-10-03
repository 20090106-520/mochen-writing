import type { RightPaneMode } from "../stores/useBookStore";

/**
 * 右栏三态的两张契约文案表（修复轮 F5 / 评审 Minor #8）：标签带名与三枚页签。
 * 为什么住 `.ts`：本仓 verify 用裸 `tsc`，`.vue` 的 `<script setup>` 整体不进类型程序、也没有运行时覆盖
 * ⇒ 文案漂在 `.vue` 里改名能全绿通过；这里被 vitest 钉死，姿态与 `SNIPPET_LABELS: Record<SnippetKind, string>` 一致。
 * 三态的联合类型只有一份实现（铁律 6）：`stores/useBookStore.ts` 的 `RightPaneMode`，这里 import 而不抄字面量。
 */

/** 标签带的名字跟着右栏三态走；作品资料态整条标签带不渲染，父侧的 gate 不归这张表管。 */
export const BAND_LABELS: Record<RightPaneMode, string> = {
  manuscript: "文稿标签",
  browse: "浏览标签",
  dossier: "作品资料"
};

/** 右栏三枚页签的唯一标签表：数组顺序就是模板渲染顺序，模板不再各写一遍字面量。 */
export const VIEW_TABS: { mode: RightPaneMode; label: string }[] = [
  { mode: "manuscript", label: "文稿" },
  { mode: "browse", label: "浏览" },
  { mode: "dossier", label: "作品资料" }
];
