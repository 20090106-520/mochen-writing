/**
 * 中栏正文这一格的显示判定（2026-10-05 批次 3 尾巴）。
 *
 * 起因是读代码时撞见的一个比「空白」更坏的状态：`openDocTab` 先把 `activeDocTab`
 * 换掉（标题立刻跟着换），`draft` 却要等 `await readDoc` 回来才换。那中间一段，
 * 中栏摆的是**新标题配旧正文**——不是没内容，是撒谎：用户照着改，
 * 就会把上一篇的稿子写进这一篇，而自动保存会照单全收地存进去。
 *
 * 所以「正文有没有对上当前标签」这件事是一个判定，不该各写各的：
 * store 只报事实（在途标志），这里只出结论与话术。
 *
 * 住 `.ts` 的理由与 `change-history.ts` 同款：本仓 verify 跑裸 `tsc`，
 * `.vue` 的 `<script setup>` 整体不进类型程序也没有运行时覆盖，
 * 判定与文案写在组件里改名能全绿通过。这里被 vitest 钉死。
 */

export type EditorBodyState = "loading" | "empty" | "body";

export interface EditorBodyInput {
  /** store 的在途标志：正文的 IPC 还没回来。 */
  loading: boolean;
  /** 有没有打开着一篇文稿（`activeDocTab !== null`）。 */
  hasDoc: boolean;
}

export function editorBodyState({ loading, hasDoc }: EditorBodyInput): EditorBodyState {
  // 又没文稿又在读：判空态。没人是在等一篇不存在的稿子，
  // 判成 loading 的话冷启动会先抖一下骨架再退回空态，纯属自找的闪烁。
  if (!hasDoc) return "empty";
  return loading ? "loading" : "body";
}

/** 骨架上方那句话。标题自带书名号就不再包一层，否则摆出「《《开局》》」这种破字。 */
export function editorLoadingLabel(title: string): string {
  const trimmed = title.trim();
  if (trimmed === "") return "正在读这一篇…";
  const quoted = trimmed.startsWith("《") && trimmed.endsWith("》") ? trimmed : `《${trimmed}》`;
  return `正在读${quoted}…`;
}

/**
 * 空态那句话。
 * 刻意不写「没有内容」——那句话会被读成「你写空了」，而实际是「你还没打开一篇」。
 * 要说的是**下一步去哪**，不是现状有多惨。
 */
export const EDITOR_EMPTY_HINT = "在左栏点一篇文稿就能在这儿写；还没打开文稿时这一格是空的。";
