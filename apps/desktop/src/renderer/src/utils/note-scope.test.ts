import { describe, expect, it } from "vitest";
import type { Note } from "../stores/useNotesStore";
import {
  NOTE_SCOPES,
  annotationTarget,
  filterNotesByQuery,
  notesForScope,
  scopeEmptyText,
  type NoteScope
} from "./note-scope";

/**
 * 笔记面板那三处「界面说了、代码没做」的判定真身（2026-10-09 扫描总单·假控件）：
 * ① 「批注」页签筛的是 `kind === "annotation"`，而全仓没有一处调用 `createAnnotation`
 *    ——那一页永远是空的，空态文案却写着「或在文档上添加批注」；
 * ② 标签只在展示端出现（`note.tags`、标签集那一块），录入端一个都没有 ⇒ `allTags` 恒空；
 * ③ 「归档」是单向门：`unarchiveNote` 全仓零调用，归档过的笔记从此看不见也取不回。
 *
 * 三条的判定都住在这里（仓内既有分工：判定进 `utils/*.ts` 出纯函数用例，接线进 `*-wiring.test.ts`，
 * 行为进 store 用例），面板那边只负责把它们摆上屏。
 */

function note(over: Partial<Note> & { id: string }): Note {
  return {
    kind: "quick",
    content: "",
    createdAt: 0,
    updatedAt: 0,
    tags: [],
    archived: false,
    ...over
  };
}

const QUICK = note({ id: "q1", content: "灵感一条" });
const QUICK_2 = note({ id: "q2", content: "另一条灵感", tags: ["伏笔"] });
const ANNO = note({ id: "a1", kind: "annotation", content: "这段过渡太急", docRelPath: "c1.md" });
const ARCHIVED = note({ id: "old", content: "收起来的旧笔记", archived: true });

const sources = {
  active: [QUICK, QUICK_2, ANNO],
  archived: [ARCHIVED]
};

describe("notesForScope：四档各筛什么", () => {
  it("「全部」只给未归档的——归档不该混在日常列表里", () => {
    expect(notesForScope("all", sources)).toEqual([QUICK, QUICK_2, ANNO]);
  });

  it("速记 / 批注各自只认自己的 kind，且都不带归档的那一枚", () => {
    expect(notesForScope("quick", sources)).toEqual([QUICK, QUICK_2]);
    expect(notesForScope("annotations", sources)).toEqual([ANNO]);
  });

  it("「已归档」给归档那一堆，且不再按 kind 分（批注和速记都收得回来）", () => {
    expect(notesForScope("archived", sources)).toEqual([ARCHIVED]);
    expect(
      notesForScope("archived", {
        active: sources.active,
        archived: [ARCHIVED, note({ id: "old2", kind: "annotation", archived: true })]
      })
    ).toHaveLength(2);
  });

  it("档位表与 NoteScope 双向对齐：加一档不给标签、或留一枚没人实现的档位都红", () => {
    const ids = NOTE_SCOPES.map((s) => s.id);
    expect([...ids].sort()).toEqual(["all", "annotations", "archived", "quick"]);
    // 每一档都得有一句人话标签（模板直接铺这张表，标签为空就是屏上一个空白钮）。
    for (const scope of NOTE_SCOPES) {
      expect(scope.label.trim(), `档位 ${scope.id} 缺标签`).not.toBe("");
    }
    // 类型侧的四个成员也要在表里都有：把 NoteScope 扩一档而不加按钮，这里就该红。
    const asScope: NoteScope[] = ["all", "quick", "annotations", "archived"];
    expect(ids).toEqual(expect.arrayContaining(asScope));
  });
});

describe("搜索：命中的是正文或标签，不是别的东西", () => {
  it("空查询（含只有空格）原样返回，不做任何过滤", () => {
    expect(filterNotesByQuery([QUICK, QUICK_2], "")).toEqual([QUICK, QUICK_2]);
    expect(filterNotesByQuery([QUICK, QUICK_2], "   ")).toEqual([QUICK, QUICK_2]);
  });

  it("正文命中与标签命中都算，且大小写不敏感", () => {
    expect(filterNotesByQuery([QUICK, QUICK_2, ANNO], "灵感")).toEqual([QUICK, QUICK_2]);
    expect(filterNotesByQuery([QUICK, QUICK_2, ANNO], "伏笔")).toEqual([QUICK_2]);
    expect(filterNotesByQuery([note({ id: "e", content: "Chapter Note" })], "chapter")).toEqual([
      { ...QUICK, id: "e", content: "Chapter Note" }
    ]);
  });

  it("谁都不命中时给空数组（面板据此走空态，而不是留一份陈旧列表）", () => {
    expect(filterNotesByQuery([QUICK, QUICK_2], "没有这个词")).toEqual([]);
  });
});

describe("批注挂在哪一章：没有当前章时不许假装挂上了", () => {
  it("有当前章 ⇒ 用它作 docRelPath", () => {
    expect(annotationTarget("c1.md")).toEqual({ ok: true, docRelPath: "c1.md" });
  });

  it("没选章（activeDocTab 为 null）⇒ 给一句能看懂的话，而不是一个空批注", () => {
    const outcome = annotationTarget(null);
    expect(outcome.ok).toBe(false);
    const reason = outcome.ok === false ? outcome.reason : "";
    expect(reason).toContain("章");
  });
});

describe("scopeEmptyText：空态那两行按状态分岔，不再一句通吃", () => {
  it("搜索没命中时先说搜索，别说「还没有笔记」", () => {
    const text = scopeEmptyText({ scope: "all", libraryEmpty: false, query: " 伏笔 " });
    expect(text.title).toContain("伏笔");
    expect(text.hint).toContain("清空搜索");
  });

  it("「已归档」那一档说的是「收起来不是删掉」——旧文案在这里整句是错的", () => {
    const text = scopeEmptyText({ scope: "archived", libraryEmpty: false, query: "" });
    expect(text.title).toBe("没有已归档的笔记。");
    expect(text.hint).toContain("取回");
  });

  it("「批注」那一档给的是怎么建批注，而不是一句没有入口的承诺", () => {
    const text = scopeEmptyText({ scope: "annotations", libraryEmpty: true, query: "" });
    expect(text.hint).toContain("附在当前章上");
  });

  it("整个库是空的与只有这一档是空的，两句话不一样", () => {
    expect(scopeEmptyText({ scope: "all", libraryEmpty: true, query: "" }).title).toBe(
      "还没有笔记。"
    );
    expect(scopeEmptyText({ scope: "all", libraryEmpty: false, query: "" }).title).not.toBe(
      "还没有笔记。"
    );
  });

  it("每一档都有一句 title 与一句 hint：屏上不许出现空白空态", () => {
    for (const scope of ["all", "quick", "annotations", "archived"] as NoteScope[]) {
      const text = scopeEmptyText({ scope, libraryEmpty: true, query: "" });
      expect(text.title, `${scope} 缺 title`).not.toBe("");
      expect(text.hint, `${scope} 缺 hint`).not.toBe("");
    }
  });
});
