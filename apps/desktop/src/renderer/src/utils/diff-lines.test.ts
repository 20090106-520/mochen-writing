import { describe, expect, it } from "vitest";
import { countDiffMarks, parseDiffLines } from "./diff-lines";

/**
 * diff 文本的行级分类（2026-10-13 抽出来的这一份，理由写在 diff-lines.ts 头上）。
 *
 * 抽之前它只住在 `DiffHighlighter.vue` 的 `<script setup>` 里，而 `.vue` 整体不进裸 `tsc`
 * 也没有运行时覆盖——改稿历史要在这份 diff 上再数一次「+ 几行 / − 几行」，
 * 数错的那份数字与染错色的那份行型只要分家一次，界面就在报一个自相矛盾的数。
 * 所以分类真身只留这一处，两处都从它取。
 */

/** 主进程 `unifiedDiff` 的真实产物形状（三行上下文 + hunk 头）。 */
const SAMPLE = [
  "--- a/chapters/01-开局.md",
  "+++ b/chapters/01-开局.md",
  "@@ -1,3 +1,3 @@",
  " 第一章",
  " ",
  "-雾从海面涌上来。",
  "+海雾涌上来，铁锈味很冲。",
  "+窗外传来敲铁的声音。",
  " 他没有回头。"
].join("\n");

describe("parseDiffLines", () => {
  it("四类都认得，且 add/remove 交出的是剥掉标记后的正文", () => {
    const types = parseDiffLines(SAMPLE).map((line) => line.type);
    expect(types).toEqual([
      "header",
      "header",
      "header",
      "context",
      "context",
      "remove",
      "add",
      "add",
      "context"
    ]);
    const add = parseDiffLines(SAMPLE).find((line) => line.type === "add");
    expect(add?.text).toBe("海雾涌上来，铁锈味很冲。");
    const del = parseDiffLines(SAMPLE).find((line) => line.type === "remove");
    expect(del?.text).toBe("雾从海面涌上来。");
  });

  it("空串不造出一行空 context：`+0 行`那种谎话从这里就进不来", () => {
    expect(parseDiffLines("")).toEqual([]);
  });
});

describe("countDiffMarks", () => {
  it("只数真正的改动行：+++ / --- 两行文件头一次都不算", () => {
    // SAMPLE 里 `---` 与 `+++` 各一行是文件头，真正的改动是 2 加 1 删。
    // 这一条是整个计数的心脏：文件头一旦数进去就变成「+3 行 / −2 行」，
    // 用户会到正文里去找那多出来的一行，找不到，然后开始怀疑整份对比。
    expect(countDiffMarks(SAMPLE)).toEqual({ added: 2, removed: 1 });
  });

  it("逐行相同时（diff 文本为空）两侧都是 0", () => {
    expect(countDiffMarks("")).toEqual({ added: 0, removed: 0 });
  });

  it("一行都没改动的 diff（只有文件头与 hunk 头）也是 0", () => {
    expect(countDiffMarks("--- a.md\n+++ b.md\n@@ -1 +1 @@\n 第一章\n")).toEqual({
      added: 0,
      removed: 0
    });
  });
});
