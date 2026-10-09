import { describe, expect, it } from "vitest";
import { parseTags } from "./tag-input";

/**
 * 标签切法的用例（原本住在 `note-scope.test.ts`，随着实现搬到 `utils/tag-input.ts` 一起搬过来）。
 *
 * 钉的是四个面板字段共用的那一刀：笔记标签、设定标签、设定别名。
 * 中文逗号必须认——界面上的 placeholder 写的是「逗号分隔」，作者用的是中文输入法，
 * 手抄的 `.split(",")` 会把「伏笔，转折」当成一个标签存进去。
 */

describe("parseTags：录入端那一刀（此前笔记侧没有入口，设定侧有两份手抄）", () => {
  it("中英文逗号都认，去空白、去空项、去重复、保序", () => {
    expect(parseTags(" 伏笔 ， 转折,, 伏笔 ")).toEqual(["伏笔", "转折"]);
  });

  it("空串与纯标点给空数组：不许产出一枚空标签", () => {
    expect(parseTags("")).toEqual([]);
    expect(parseTags("，,,  ,")).toEqual([]);
  });

  it("单个标签不带逗号也要收到", () => {
    expect(parseTags("人物动机")).toEqual(["人物动机"]);
  });

  it("只按逗号切，不在标签内部动刀：空格包住的词原样保留", () => {
    expect(parseTags(" 深海 恐惧 ")).toEqual(["深海 恐惧"]);
  });
});
