import { describe, expect, it } from "vitest";
import { BOOK_DATA_KEYS, BOOK_DATA_LABELS, type BookDataKey } from "../src/index.js";

/**
 * 设定数据白名单（2026-10-09 扫描总单 P0-7）。
 *
 * 这两张表是全链路唯一的真身：fs-store 拿它拼路径、主进程拿它当闸、渲染层拿它显示人话。
 * 用例钉的是「两张表必须一模一样宽」——加第四份设定时只改 keys 忘了 labels，
 * 换书提示就会说出 undefined。
 */

describe("BOOK_DATA_KEYS / BOOK_DATA_LABELS", () => {
  it("白名单里就那三份设定，顺序固定（新增先改这里再改 store）", () => {
    expect(BOOK_DATA_KEYS).toEqual(["notes", "story-bible", "writing-goal"]);
  });

  it("每一枚键都有对应的中文显示名，一枚不多一枚不少", () => {
    expect(Object.keys(BOOK_DATA_LABELS).sort()).toEqual([...BOOK_DATA_KEYS].sort());
  });

  it("显示名非空且不重复（提示里点名靠它，重名就等于没说清是哪份）", () => {
    const labels = BOOK_DATA_KEYS.map((key) => BOOK_DATA_LABELS[key as BookDataKey]);
    expect(labels.every((label) => label.trim() !== "")).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
