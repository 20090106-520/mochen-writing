import { describe, expect, it } from "vitest";
import { countNeedle, scriptSource, templateSource, vueSource } from "../utils/vue-source-reader";

/**
 * 文档大纲面板（`OutlinePanel.vue`）的两处「界面说了、代码没做」（2026-10-09 扫描总单·假控件）。
 *
 * ① 页脚写着 `<kbd>↑</kbd><kbd>↓</kbd> 浏览`，全组件却一个 keydown 都没有；
 * ② 排序三档里的「按类型」点下去什么也不变——列表本来就按 `BOOK_KIND_ORDER` 分节渲染，
 *    `sortDocs` 对它的处理就是原样返回。②按「摘掉」收口，①按「接真」收口。
 *
 * 判定算术住在 `utils/outline-navigation.ts`（那边 9 条纯函数用例）；这里只钉**接线**：
 * `.vue` 不进类型程序，组件里少写一个 import、少挂一个 `@keydown`，tsc 与 build 都不报，
 * 要到用户按键那一刻才发现（批次 4-① 在 `CenterColumn.vue` 上真撞过同一类漏 import）。
 */
const script = scriptSource("components/OutlinePanel.vue");
const tpl = templateSource("components/OutlinePanel.vue");
/**
 * 整份原文（注释没剥）：下面那两条「为什么写在源文件里」的断言读的是注释，
 * 而 `scriptSource` 会剥掉注释——注释里的宣称不能给功能断言喂饱，但"这段说明在不在"
 * 本身就是断言对象，所以那份原文只能单独读。
 */
const vueRaw = vueSource("components/OutlinePanel.vue");

describe("↑↓ 浏览：页脚承诺的那件事真有通路", () => {
  it("引的是 utils/outline-navigation，组件内不自带第二份「下一步」算术", () => {
    expect(script).toContain('from "../utils/outline-navigation"');
    expect(script).toContain("stepNavNode(navNodes.value, cursorPath.value, delta)");
    // 走位规则（跳过折叠分节、越界停住）只能在 util 那一处；组件里出现 Math.min/max 夹下标
    // 就是有人把算术又抄了一遍。
    expect(script).not.toMatch(/Math\.(min|max)\([^)]*(index|idx)/);
  });

  it("面板根上挂了 keydown，节点按钮把「焦点在哪」交给游标", () => {
    expect(tpl).toContain('@keydown="onPanelKeydown"');
    expect(tpl).toContain(':ref="(el) => setNodeRef(node.relPath, el)"');
    expect(tpl).toContain('@focus="cursorPath = node.relPath"');
    // 拿到焦点之后要滚进视野，否则连着按 ↓ 会走出屏幕外——那等于只走了一半。
    expect(script).toContain('el.scrollIntoView({ block: "nearest" })');
    expect(script).toContain("el.focus()");
  });

  it("输入法组合态那一闸用的是 imeOwnsKey 那一份（判据不许在组件里散写）", () => {
    expect(script).toContain("if (imeOwnsKey(event)) return;");
    expect(script).not.toContain("event.isComposing");
    expect(script).not.toMatch(/keyCode\s*===\s*229/);
  });

  it("只在真的走了一步时才吞按键：没处可去（全折叠/空列表）时按键照常冒泡", () => {
    expect(script).toContain("if (moveCursor(delta)) event.preventDefault();");
    expect(script).toContain("if (next === null) return false;");
  });

  it("页脚那句提示仍在（接真之后不许把话删掉当作问题解决）", () => {
    expect(tpl).toContain("<kbd>↑</kbd><kbd>↓</kbd> 浏览");
  });
});

describe("排序档位：档位表与 sortDocs 双向对齐，「按类型」不许复活", () => {
  it(`SortMode 联合成员与 SORT_OPTIONS 的 value 一一对应（加一档不实现、或留个没人实现的档位都红）`, () => {
    const declared = /type SortMode =([^;]*);/.exec(script)?.[1] ?? "";
    const modes = [...declared.matchAll(/"([a-z]+)"/g)].map((m) => m[1] ?? "");
    expect(modes.length).toBeGreaterThan(0);
    const options = [...script.matchAll(/value:\s*"([a-z]+)"/g)].map((m) => m[1] ?? "");
    expect([...options].sort()).toEqual([...modes].sort());
  });

  it("「按类型」那一档已从档位表和实现里一起摘掉", () => {
    expect(script).not.toContain('value: "kind"');
    expect(script).not.toMatch(/type SortMode[^;]*"kind"/);
    expect(script).not.toContain("按类型");
    expect(tpl).not.toContain("按类型");
  });

  it("剩下的两档各有一句为什么：字数档真的排，顺序档沿用 store 排好的次序", () => {
    expect(script).toContain('if (mode === "chars") {');
    expect(script).toContain("(b.chars ?? 0) - (a.chars ?? 0)");
    // 摘掉一档之后 sortDocs 只剩一条分支；「章节顺序 = 不另排」必须写在源文件里说清楚，
    // 否则下一个人会把它当成漏实现又补一层空转排序。
    expect(vueRaw).toContain("useBookStore.sortDocsByOrder");
    expect(countNeedle("假控件", vueRaw)).toBeGreaterThan(0);
  });

  it("拖拽那两句「视觉占位」注释按事实改掉：这一层确实没有拖拽，也没留假承诺", () => {
    expect(vueRaw).toContain("LeftSidebar.vue");
    expect(vueRaw).toContain("moveChapterByRelPath");
    expect(tpl).not.toContain("draggable");
    expect(script).not.toContain("onDrop");
  });
});
