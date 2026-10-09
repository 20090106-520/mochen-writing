import { describe, expect, it } from "vitest";
import {
  BIBLE_SCOPES,
  BIBLE_TYPE_LABEL,
  bibleScopeEmptyText,
  entriesForScope,
  matchesEntry,
  visibleEntries,
  type BibleScope,
  type BibleSources
} from "./bible-scope";
import type { BibleEntry, BibleEntryType } from "../stores/useStoryBibleStore";

/**
 * 故事圣经的档位与空态判定（2026-10-09 扫描总单·假控件那一批的第三族）。
 *
 * 这一族要解决的三件事都住在纯函数里，面板只负责接线：
 * ① 归档是单向门（`restoreEntry` 全仓零调用）——所以必须有一档看得见已归档的条目；
 * ② 选中跟着筛选走（换一档就丢详情），判定改成"按 id 在全量里查"，这里先把档位筛法定死；
 * ③ 空库时往用户数据里种三条示例条目（真书里那就是脏数据）——现在空态给的是指引文案。
 */

function entry(overrides: Partial<BibleEntry> & { id: string; type: BibleEntryType }): BibleEntry {
  const now = 1_700_000_000_000;
  return {
    title: "",
    content: "",
    createdAt: now,
    updatedAt: now,
    tags: [],
    ...overrides
  };
}

const ye = entry({ id: "e_ye", type: "character", title: "沈砚", tags: ["引路人"] });
const su = entry({
  id: "e_su",
  type: "character",
  title: "苏黎",
  content: "档案馆员",
  aliases: ["小苏"]
});
const lib = entry({ id: "e_lib", type: "location", title: "旧港图书馆" });
const gate = entry({ id: "e_gate", type: "timeline", title: "第二次涨潮", eventDate: "序章" });
const old = entry({ id: "e_old", type: "location", title: "旧灯塔", archived: true });

const active = [ye, su, lib, gate];
const sources: BibleSources = { active, archived: [old] };

describe("① 档位筛法：五档，其中「已归档」是独立的一档", () => {
  it("全档给未归档的全部，归档的那条不在里面", () => {
    expect(entriesForScope("all", sources).map((e) => e.id)).toEqual([
      "e_ye",
      "e_su",
      "e_lib",
      "e_gate"
    ]);
  });

  it("类型档只筛该类型，且不看归档件", () => {
    expect(entriesForScope("character", sources).map((e) => e.id)).toEqual(["e_ye", "e_su"]);
    expect(entriesForScope("location", sources).map((e) => e.id)).toEqual(["e_lib"]);
    expect(entriesForScope("timeline", sources).map((e) => e.id)).toEqual(["e_gate"]);
  });

  it("「已归档」那一档只给归档件，且不再按类型二次筛（三种类型都要能取回）", () => {
    const archivedOnly = entry({
      id: "e_old_char",
      type: "character",
      title: "退休的角色",
      archived: true
    });
    const withTwo: BibleSources = { active, archived: [old, archivedOnly] };
    expect(entriesForScope("archived", withTwo).map((e) => e.id)).toEqual(["e_old", "e_old_char"]);
  });

  it("档位表五档、顺序是「全部 人物 地点 时间线 已归档」，每档都有非空标签", () => {
    expect(BIBLE_SCOPES.map((s) => s.id)).toEqual([
      "all",
      "character",
      "location",
      "timeline",
      "archived"
    ]);
    for (const s of BIBLE_SCOPES) expect(s.label.trim()).not.toBe("");
    // 类型标签只有一份：面板与档位表都从这里取，不再各写一遍三元链。
    expect(BIBLE_SCOPES.find((s) => s.id === "character")?.label).toBe(BIBLE_TYPE_LABEL.character);
  });

  it("档位 id 与 BibleScope 联合是同一批（加一档必须两处一起改）", () => {
    const ids: BibleScope[] = ["all", "character", "location", "timeline", "archived"];
    expect(BIBLE_SCOPES.map((s) => s.id as BibleScope).sort()).toEqual([...ids].sort());
  });
});

describe("② 搜索：一条实现，字段覆盖面按 store 原来那份", () => {
  it("空查询与只有空格都算「没筛」，原样返回", () => {
    expect(visibleEntries("all", sources, "")).toHaveLength(4);
    expect(visibleEntries("all", sources, "   ")).toHaveLength(4);
  });

  it("标题、正文、标签、别名、事件日期都能命中", () => {
    expect(visibleEntries("all", sources, "沈砚").map((e) => e.id)).toEqual(["e_ye"]);
    expect(visibleEntries("all", sources, "档案馆员").map((e) => e.id)).toEqual(["e_su"]);
    expect(visibleEntries("all", sources, "引路人").map((e) => e.id)).toEqual(["e_ye"]);
    expect(visibleEntries("all", sources, "小苏").map((e) => e.id)).toEqual(["e_su"]);
    expect(visibleEntries("all", sources, "序章").map((e) => e.id)).toEqual(["e_gate"]);
  });

  it("大小写一律不敏感（旧的实现里标签与别名的口径不一致）", () => {
    expect(matchesEntry(lib, "LIBRARY")).toBe(false);
    const withLatin = entry({ id: "e_lat", type: "location", title: "The Library", tags: ["Hub"] });
    expect(matchesEntry(withLatin, "the library")).toBe(true);
    expect(matchesEntry(withLatin, "HUB")).toBe(true);
  });

  it("搜索叠在档位上：搜得到、但只在该档的范围里搜", () => {
    expect(visibleEntries("character", sources, "沈砚").map((e) => e.id)).toEqual(["e_ye"]);
    expect(visibleEntries("character", sources, "图书馆")).toEqual([]);
    expect(visibleEntries("archived", sources, "灯塔").map((e) => e.id)).toEqual(["e_old"]);
  });

  it("没命中给空表，而不是把整档塞回去", () => {
    expect(visibleEntries("all", sources, "不存在的东西")).toEqual([]);
  });
});

describe("③ 空态：库里真没有时说的是「怎么开始」，不是三条示例人物", () => {
  it("搜索中：说的是这个词没匹配，提示换词或清空", () => {
    const text = bibleScopeEmptyText({ scope: "all", libraryEmpty: false, query: "灯塔" });
    expect(text.title).toContain("灯塔");
    expect(text.hint).toContain("清空");
  });

  it("「已归档」档：说的是没有归档件，并告诉用户从哪儿取回", () => {
    const text = bibleScopeEmptyText({ scope: "archived", libraryEmpty: false, query: "" });
    expect(text.title).toContain("归档");
    expect(text.hint).toContain("取回");
  });

  it("整库为空：给的是新建指引，不是「这里有三条示例你先看着」", () => {
    const text = bibleScopeEmptyText({ scope: "all", libraryEmpty: true, query: "" });
    expect(text.hint).toContain("＋");
    expect(text.title + text.hint).not.toMatch(/示例|试读|演示/);
  });

  it("库里有东西、只是这一档空：说的是这一档，不是整个库", () => {
    const text = bibleScopeEmptyText({ scope: "timeline", libraryEmpty: false, query: "" });
    expect(text.title).toContain(BIBLE_TYPE_LABEL.timeline);
    expect(text.hint).not.toContain("清空");
  });

  it("每条分岔出来的两行都不是空串（空态不能只有一行字）", () => {
    const scopes: BibleScope[] = ["all", "character", "location", "timeline", "archived"];
    for (const scope of scopes) {
      for (const libraryEmpty of [true, false]) {
        for (const query of ["", "  ", "人物"]) {
          const text = bibleScopeEmptyText({ scope, libraryEmpty, query });
          expect(text.title.trim(), `${scope}/${libraryEmpty}/${query}`).not.toBe("");
          expect(text.hint.trim(), `${scope}/${libraryEmpty}/${query}`).not.toBe("");
        }
      }
    }
  });
});
