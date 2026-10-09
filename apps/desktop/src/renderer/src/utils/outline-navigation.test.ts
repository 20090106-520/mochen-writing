import { describe, expect, it } from "vitest";
import { stepNavNode, visibleNavNodes, type OutlineNavSection } from "./outline-navigation";

/**
 * 大纲面板底部那句「↑↓ 浏览」的判定真身（2026-10-09 扫描总单「假控件」大纲那一行）。
 *
 * 病灶：页脚写着 `<kbd>↑</kbd><kbd>↓</kbd> 浏览`，全组件却一个 keydown 都没有——
 * 那句提示是一件**没通路的事**。这里先住下"往哪儿走"的算术（折叠掉的分组不在场内、
 * 越界停住不环回），接线与焦点动作由 `OutlinePanel.vue` 承担（另有 wiring 用例钉）。
 *
 * 为什么"越界停住"而不是环回：这是一列**文档**，不是轮播标签。列表首条按 ↑ 又跳到末条，
 * 用户的下一次按键就失去方向感；标签环回（Ctrl+PageUp/Down 那一族）是另一件事，那里才该环。
 */

const CHAPTERS: OutlineNavSection = {
  id: "chapter",
  nodes: [{ relPath: "a.md" }, { relPath: "b.md" }]
};
const CHARACTERS: OutlineNavSection = { id: "character", nodes: [{ relPath: "c.md" }] };

describe("visibleNavNodes：折叠掉的分节不该收到 ↑↓", () => {
  it("未折叠的分节按给定顺序把节点铺平", () => {
    expect(visibleNavNodes([CHAPTERS, CHARACTERS], {})).toEqual([
      { sectionId: "chapter", relPath: "a.md" },
      { sectionId: "chapter", relPath: "b.md" },
      { sectionId: "character", relPath: "c.md" }
    ]);
  });

  it("折叠其中一节：只有那一节的节点消失，其它节照旧", () => {
    expect(visibleNavNodes([CHAPTERS, CHARACTERS], { chapter: true })).toEqual([
      { sectionId: "character", relPath: "c.md" }
    ]);
  });

  it("全部折叠 ⇒ 空列表：没有可去之处，别硬凑一个假焦点", () => {
    expect(visibleNavNodes([CHAPTERS, CHARACTERS], { chapter: true, character: true })).toEqual([]);
  });
});

describe("stepNavNode：一步走到哪儿", () => {
  const nodes = visibleNavNodes([CHAPTERS, CHARACTERS], {});

  it("焦点还不在任何节点上（在搜索框）：↓ 给第一条、↑ 给最后一条", () => {
    expect(stepNavNode(nodes, null, 1)).toBe("a.md");
    expect(stepNavNode(nodes, null, -1)).toBe("c.md");
  });

  it("列表中间：上下各走一步", () => {
    expect(stepNavNode(nodes, "a.md", 1)).toBe("b.md");
    expect(stepNavNode(nodes, "b.md", -1)).toBe("a.md");
    expect(stepNavNode(nodes, "b.md", 1)).toBe("c.md");
  });

  it("首条按 ↑、末条按 ↓ 都**停住不动**（不环回）", () => {
    expect(stepNavNode(nodes, "a.md", -1)).toBe("a.md");
    expect(stepNavNode(nodes, "c.md", 1)).toBe("c.md");
  });

  it("当前节点已经不在可见列表里（它所在的分节刚被折叠）：按 ↓ 从头给、按 ↑ 从尾给", () => {
    const onlyChapters = visibleNavNodes([CHAPTERS], {});
    expect(stepNavNode(onlyChapters, "c.md", 1)).toBe("a.md");
    expect(stepNavNode(onlyChapters, "c.md", -1)).toBe("b.md");
  });

  it("空列表给 null：调用方据此一个焦点也不动", () => {
    expect(stepNavNode([], null, 1)).toBeNull();
    expect(stepNavNode([], "a.md", -1)).toBeNull();
  });

  it("多走一步不越界：末条之后仍是末条，绝不返回 undefined 或越界下标", () => {
    expect(stepNavNode(nodes, "b.md", 1)).toBe("c.md");
    expect(stepNavNode(nodes, "c.md", 1)).toBe("c.md");
    expect(stepNavNode(nodes, "c.md", 1)).not.toBeUndefined();
  });
});
