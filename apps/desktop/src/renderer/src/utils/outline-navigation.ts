import type { BookKind } from "@mochen/contracts";

/**
 * 大纲面板「↑↓ 浏览」的**唯一算术**（2026-10-09 扫描总单「假控件」大纲那一行）。
 *
 * 页脚那句 `<kbd>↑</kbd><kbd>↓</kbd> 浏览` 原先没有任何 keydown 通路——写着能做、实际不做，
 * 正是这一族里最刺眼的一类假控件。修法是把"往哪儿走"抽成纯函数放在这里（仓内既有分工：
 * 判定住 `utils/*.ts` 出纯函数用例，接线住 `*-wiring.test.ts` 读源文件，焦点动作留在组件），
 * 组件那边只负责「把算出来的那一枚节点拿到焦点并滚进视野」。
 */

/** 一个能收到焦点的大纲节点：`relPath` 是身份，`sectionId` 只用来把「谁被折叠了」讲清楚。 */
export interface OutlineNavNode {
  readonly relPath: string;
  readonly sectionId: BookKind;
}

/** 组件传进来的分组视图模型——形状与 `OutlinePanel.vue` 的 `filteredSections` 对齐，不另造枚举。 */
export interface OutlineNavSection {
  readonly id: BookKind;
  readonly nodes: readonly { relPath: string }[];
}

/**
 * 把可见节点铺平成一条 ↑↓ 走的队列。
 *
 * 折叠掉的那一节**整个跳过**：它的节点在屏上不存在（模板里是 `v-if="!collapsed[...]"`），
 * 焦点走进去等于交给一个 DOM 里根本没有的元素，表现为"按了键没反应"。
 */
export function visibleNavNodes(
  sections: readonly OutlineNavSection[],
  collapsed: Readonly<Record<string, boolean>>
): OutlineNavNode[] {
  const out: OutlineNavNode[] = [];
  for (const section of sections) {
    if (collapsed[section.id]) continue;
    for (const node of section.nodes) {
      out.push({ sectionId: section.id, relPath: node.relPath });
    }
  }
  return out;
}

/**
 * 在可见队列里走一步，返回**该拿到焦点的那一枚** `relPath`；空列表给 `null`。
 *
 * 三条口径（都写在用例里，不是随手定的）：
 * - `current === null`（焦点还在搜索框）：↓ 从第一条起、↑ 从最后一条起；
 * - 越界**停住**：首条按 ↑ 仍是首条。文档列表不是轮播标签，环回会让人下一次按键失去方向感；
 * - `current` 不在队列里（它所在的分节刚被折叠掉）：与 `null` 同处理，别让一次折叠把键盘导航打死。
 */
export function stepNavNode(
  nodes: readonly OutlineNavNode[],
  current: string | null,
  delta: 1 | -1
): string | null {
  if (nodes.length === 0) return null;
  const index = current === null ? -1 : nodes.findIndex((node) => node.relPath === current);
  // 游标不在队列里（焦点还没进列表，或它所在的分节刚被折叠掉）：从队列的一端起走。
  if (index === -1) return relPathAt(nodes, delta > 0 ? 0 : nodes.length - 1);
  // 越界停住：夹在 [0, length-1] 之内——首条按 ↑ 仍是首条，不环回。
  return relPathAt(nodes, Math.min(nodes.length - 1, Math.max(0, index + delta)));
}

/**
 * 取下标处那一枚的 `relPath`，越界给 `null`。
 *
 * 为什么单拎这一小段：`nodes[i]?.relPath` 的类型是 `string | undefined`，而本模块的出口口径是
 * `string | null`（调用方拿它当「没处可去」的凭据）。`tsc` 当场把这一处逮住过——
 * 直接写 `?.` 出来的是 `undefined`，`?? null` 补在**整个表达式外面**才换得动那个 null 口径。
 */
function relPathAt(nodes: readonly OutlineNavNode[], index: number): string | null {
  return nodes[index]?.relPath ?? null;
}
