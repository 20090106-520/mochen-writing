/// <reference types="node" />
/**
 * 整屏面板互斥的判定与接线契约（2026-11-11）。
 *
 * 修的是一个真机可用性 bug：九个整屏面板各持一个 boolean，开合时谁也不关谁，
 * 而层级又写死成 1500 / 1600 / 2000 三档。先开搜索(2000) 再开笔记(1500) 时，
 * 搜索永远盖在笔记上面，焦点栈却以后开的笔记为栈顶 ⇒ 焦点落进看不见的层、
 * Esc 收的也是看不见的层，看起来像「按了没反应」。
 *
 * 裁定：整屏面板同时开两枚没有正当用例（都带遮罩、都困焦点），
 * 任一枚打开时收掉其它，只留刚开的；九枚层级随之归一到 --z-drawer
 * （那一半的判据在 z-ladder.test.ts）。
 *
 * 判定的真身是纯函数，装配层 App.vue 只负责把结果应用到九枚状态上。
 * 这里两头都钉：纯函数管边界，源码守卫管「新增第十枚面板时别漏接线」。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FULLSCREEN_PANEL_KEYS,
  panelsToDismiss,
  type FullscreenFlags,
  type FullscreenPanelKey
} from "../utils/fullscreen-panel-exclusivity";

const appSource = readFileSync(fileURLToPath(new URL("../App.vue", import.meta.url)), "utf8");

function flags(...live: FullscreenPanelKey[]): FullscreenFlags {
  const out = {} as FullscreenFlags;
  for (const key of FULLSCREEN_PANEL_KEYS) out[key] = live.includes(key);
  return out;
}

describe("panelsToDismiss · 判定真身", () => {
  it("没开任何一枚 / 只开一枚：都不动（watch 不会自己触发自己）", () => {
    expect(panelsToDismiss(flags(), flags())).toEqual([]);
    expect(panelsToDismiss(flags(), flags("search"))).toEqual([]);
    expect(panelsToDismiss(flags("search"), flags("search"))).toEqual([]);
  });

  it("先开搜索再开笔记：收掉搜索，留后开的笔记", () => {
    expect(panelsToDismiss(flags("search"), flags("search", "notes"))).toEqual(["search"]);
  });

  it("只关不开：不收任何一枚", () => {
    expect(panelsToDismiss(flags("search", "notes"), flags("notes"))).toEqual([]);
  });

  it("关一枚同时开另一枚：终态只有一枚，不误伤", () => {
    expect(panelsToDismiss(flags("search"), flags("outline"))).toEqual([]);
  });

  it("同一 tick 开了三枚：保留登记顺序里最后一枚，其余全收", () => {
    expect(panelsToDismiss(flags(), flags("search", "notes", "export"))).toEqual([
      "search",
      "notes"
    ]);
  });

  it("初始就是脏的两枚、没有新开的：也收敛到一枚", () => {
    expect(panelsToDismiss(flags("bible", "goals"), flags("bible", "goals"))).toEqual(["bible"]);
  });

  it("store 那三格与本地 ref 混着开，同样只留一枚", () => {
    expect(
      panelsToDismiss(flags("wordCount"), flags("wordCount", "chapterStatus", "templates"))
    ).toEqual(["templates", "wordCount"]);
  });
});

describe("App.vue 装配层 · 九枚都在同一份快照里", () => {
  const snapshotStart = appSource.indexOf("const fullscreenFlags");
  const snapshot =
    snapshotStart < 0
      ? ""
      : appSource.slice(snapshotStart, appSource.indexOf("function closeFullscreenPanel"));
  const closer = /function closeFullscreenPanel[\s\S]*?\n\}/.exec(appSource)?.[0] ?? "";

  it("computed 快照逐枚登记，且与纯函数的键表一一对应", () => {
    expect(snapshot, "读不到 fullscreenFlags 的 computed 块").not.toBe("");
    for (const key of FULLSCREEN_PANEL_KEYS) {
      expect(snapshot, `快照漏了 ${key}`).toContain(`${key}:`);
    }
  });

  it("closeFullscreenPanel 的 switch 覆盖九枚，并留穷尽性守卫", () => {
    expect(closer, "读不到 closeFullscreenPanel").not.toBe("");
    for (const key of FULLSCREEN_PANEL_KEYS) {
      expect(closer, `${key} 没有关闭分支`).toContain(`case "${key}"`);
    }
    expect(closer).toContain("const unhandled: never = key");
  });

  it("watch 把判定结果逐枚应用到状态上", () => {
    expect(appSource).toContain("watch(fullscreenFlags, (next, prev) => {");
    expect(appSource).toContain("panelsToDismiss(prev, next)");
    expect(appSource).toContain("closeFullscreenPanel(key)");
  });

  it("九个面板组件都挂在 App.vue（新增第十枚时这条会提醒登记）", () => {
    for (const component of [
      "SearchPanel",
      "NotesPanel",
      "WordCountPanel",
      "ChapterInventoryPanel",
      "ExportDialog",
      "PromptTemplatePanel",
      "OutlinePanel",
      "WritingGoalPanel",
      "StoryBiblePanel"
    ]) {
      expect(appSource, `${component} 没挂在 App.vue`).toContain(`<${component}`);
    }
  });
});
