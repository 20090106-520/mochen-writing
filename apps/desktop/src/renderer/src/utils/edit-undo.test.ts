import { describe, expect, it } from "vitest";
import {
  UNDO_STACK_LIMIT,
  createEditUndoStack,
  takeUndoFor,
  undoNotice,
  undoOwnsKey,
  type EditUndoSnapshot
} from "./edit-undo";

/**
 * 「替换 / 全部替换」之后的撤销（2026-10-09 扫描总单·不存在表）。
 *
 * 病灶：`applyReplace` 把整篇新文本一次赋给 textarea（`:value` 重渲染），Chromium 在程序赋值时
 * 会**清空原生撤销栈**，而本仓没有自制快照 ⇒ 一次「全部替换」换错了一个词，30 处一起错，Ctrl+Z 救不回。
 *
 * 为什么判定住在这里而不是 `.vue`：`.vue` 的 `<script setup>` 不进类型程序、也没有 jsdom 覆盖，
 * 而"哪份快照能还原到哪一章""组合态里那下 Ctrl+Z 不许接手"恰恰是编译管不住的部分。
 *
 * 三条安全红线（用例逐条钉着）：
 * ① 快照属于哪一章就只还给那一章——跨章还原等于把 A 章全文盖进 B 章，是丢稿不是撤销；
 * ② 用户在 textarea 里打过字之后栈必须清空——原生撤销从那一刻重新当家，我们再还原就是覆盖他刚打的内容；
 * ③ 输入法组合态里的 Ctrl+Z 不归我们（判据仍是 `imeOwnsKey` 那一份，本模块不重抄）。
 */

function snap(over: Partial<EditUndoSnapshot> = {}): EditUndoSnapshot {
  return {
    docRelPath: "chapters/01.md",
    text: "改前的全文",
    start: 3,
    end: 3,
    kind: "replace-all",
    count: 12,
    ...over
  };
}

describe("createEditUndoStack · 栈形状", () => {
  it("空栈没有可撤销的东西", () => {
    const stack = createEditUndoStack();
    expect(stack.top()).toBeNull();
    expect(stack.size()).toBe(0);
  });

  it("push 之后 top 给的就是那一份，且不弹出", () => {
    const stack = createEditUndoStack();
    stack.push(snap());
    expect(stack.top()).toEqual(snap());
    expect(stack.size()).toBe(1);
  });

  it("后进先出：连着两次替换，撤销先回到第二次改前", () => {
    const stack = createEditUndoStack();
    stack.push(snap({ text: "第一次改前", count: 1 }));
    stack.push(snap({ text: "第二次改前", count: 2 }));
    expect(takeUndoFor(stack, "chapters/01.md")?.text).toBe("第二次改前");
    expect(takeUndoFor(stack, "chapters/01.md")?.text).toBe("第一次改前");
    expect(takeUndoFor(stack, "chapters/01.md")).toBeNull();
  });

  it("有上限：超出后丢最旧的那份， newest 仍在（不无界吃内存）", () => {
    const stack = createEditUndoStack(3);
    for (let i = 1; i <= 5; i += 1) stack.push(snap({ text: `第 ${i} 次改前`, count: i }));
    expect(stack.size()).toBe(3);
    expect(stack.top()?.text).toBe("第 5 次改前");
    expect(takeUndoFor(stack, "chapters/01.md")?.text).toBe("第 5 次改前");
    expect(takeUndoFor(stack, "chapters/01.md")?.text).toBe("第 4 次改前");
    expect(takeUndoFor(stack, "chapters/01.md")?.text).toBe("第 3 次改前");
    expect(takeUndoFor(stack, "chapters/01.md")).toBeNull();
  });

  it("默认上限是一条明写的红线，不是随手的大数", () => {
    expect(UNDO_STACK_LIMIT).toBe(20);
  });

  it("上限传 0 或负数时至少还留得住一份（「永远没有可撤销的」是最难查的那种坏）", () => {
    const stack = createEditUndoStack(0);
    stack.push(snap());
    expect(stack.size()).toBe(1);
    expect(takeUndoFor(stack, "chapters/01.md")?.text).toBe("改前的全文");
  });
});

describe("takeUndoFor · 跨文档与空栈（红线①）", () => {
  it("章不对就不还原，并把那一份丢掉——绝不把别的章的全文盖进来", () => {
    const stack = createEditUndoStack();
    stack.push(snap({ docRelPath: "chapters/02.md", text: "第二章改前" }));
    expect(takeUndoFor(stack, "chapters/01.md")).toBeNull();
    expect(stack.size()).toBe(0);
  });

  it("没打开任何文档（activeDoc 为 null）时不还原，栈清空", () => {
    const stack = createEditUndoStack();
    stack.push(snap());
    expect(takeUndoFor(stack, null)).toBeNull();
    expect(stack.size()).toBe(0);
  });

  it("途中遇到旧文档的快照只丢那一份，同文档的那一份照样能取回", () => {
    const stack = createEditUndoStack();
    stack.push(snap({ docRelPath: "chapters/01.md", text: "01 改前" }));
    stack.push(snap({ docRelPath: "chapters/09.md", text: "09 改前" }));
    expect(takeUndoFor(stack, "chapters/01.md")?.text).toBe("01 改前");
    expect(stack.size()).toBe(0);
  });
});

describe("clear（红线②：用户一打字，撤销就交回原生）", () => {
  it("clear 之后什么都取不到", () => {
    const stack = createEditUndoStack();
    stack.push(snap());
    stack.push(snap({ text: "第二次" }));
    stack.clear();
    expect(stack.size()).toBe(0);
    expect(takeUndoFor(stack, "chapters/01.md")).toBeNull();
  });
});

describe("undoOwnsKey · 哪一下 Ctrl+Z 归我们", () => {
  // 形状就是 KeyboardEvent 的那五个成员（utils 里是 Pick 出来的），替身必须用真名：
  // 写成 ctrl/shift 这类简称，接线一侧读的是 ctrlKey，两边静默错配而用例照样全绿。
  const key = (
    over: Partial<Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">> = {}
  ) => ({
    key: "z",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...over
  });

  it("Ctrl+Z 与 Cmd+Z 归我们，且只在全仓那份组合态闸门说'不在组合态'时归我们", () => {
    expect(undoOwnsKey({ ...key({ ctrlKey: true }) }, false)).toBe(true);
    expect(undoOwnsKey({ ...key({ metaKey: true }) }, false)).toBe(true);
  });

  it("输入法正在选词时不接手（判据是 imeOwnsKey 那一份传进来的布尔，不在此重抄）", () => {
    expect(undoOwnsKey({ ...key({ ctrlKey: true }) }, true)).toBe(false);
  });

  it("Shift/Ctrl+Shift+Z（重做）与裸 Z 都不接手——那两把键不是我们的语义", () => {
    expect(undoOwnsKey({ ...key({ shiftKey: true }) }, false)).toBe(false);
    expect(undoOwnsKey({ ...key({ ctrlKey: true, shiftKey: true }) }, false)).toBe(false);
    expect(undoOwnsKey({ ...key({ ctrlKey: true, altKey: true }) }, false)).toBe(false);
    expect(undoOwnsKey({ ...key({}) }, false)).toBe(false);
  });

  it("其他键（Ctrl+A / Ctrl+C）一律不接手", () => {
    expect(undoOwnsKey({ ...key({ key: "a", ctrlKey: true }) }, false)).toBe(false);
    expect(undoOwnsKey({ ...key({ key: "c", ctrlKey: true }) }, false)).toBe(false);
    // Caps Lock 打开时 key 是大写 Z 而没有 shiftKey：那仍然是用户按的撤销键。
    expect(undoOwnsKey({ ...key({ key: "Z", ctrlKey: true }) }, false)).toBe(true);
  });
});

describe("undoNotice · 面板那行提示的唯一来源", () => {
  it("空栈时是空串：模板 v-if 直接用它，不留一句'已替换 0 处'", () => {
    expect(undoNotice(null)).toBe("");
  });

  it("批量替换报处数（用户要确认的是'到底换了几处'）", () => {
    expect(undoNotice(snap({ kind: "replace-all", count: 12 }))).toContain("12");
  });

  it("单处替换报 1 处，不是 0 也不是空", () => {
    const text = undoNotice(snap({ kind: "replace", count: 1 }));
    expect(text).toContain("1");
    expect(text).not.toContain("0");
  });

  it("两种 kind 都说明这是'替换'", () => {
    expect(undoNotice(snap({ kind: "replace-all" }))).toContain("替换");
    expect(undoNotice(snap({ kind: "replace" }))).toContain("替换");
  });

  it("片段插入说的是'插入'，不是'替换'——界面不许把另一件事报成替换", () => {
    expect(undoNotice(snap({ kind: "snippet", count: 1 }))).toContain("插入");
    expect(undoNotice(snap({ kind: "snippet", count: 1 }))).not.toContain("替换");
  });
});
