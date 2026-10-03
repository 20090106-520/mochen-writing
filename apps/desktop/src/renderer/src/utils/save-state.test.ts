import { describe, expect, it } from "vitest";
import { SAVE_STATE_LABELS, saveStateLabel } from "./save-state";

/**
 * 这句话以前住在 `DocumentPane.vue` 的 `<script setup>` 里：`.vue` 既不进类型程序也没有运行时覆盖
 * ⇒ 把「已保存到本机」改成任何字面量，全仓没有一条用例会展红（同 `reading-time` 的 F1 教训）。
 * 搬进 `.ts` 才谈得上被钉住，所以这里**逐字**断言文案，而不是拿表当期望值（那样改坏表也照样绿）。
 */
const CLEAN = { conflict: false, saving: false, dirty: false };

describe("saveStateLabel · 四态优先级（#103b：保存态的唯一真身）", () => {
  it("冲突压过一切：盘上有别人的改动时，绝不说「已保存」", () => {
    expect(saveStateLabel({ conflict: true, saving: true, dirty: true, hasOpenDoc: true })).toBe(
      "外部已改动，已拒绝覆盖"
    );
  });

  it("保存中压过脏：正在写的过程不是「有未保存修改」", () => {
    expect(saveStateLabel({ ...CLEAN, saving: true, dirty: true, hasOpenDoc: true })).toBe(
      "正在保存到本机"
    );
  });

  it("脏态：还没落盘就还没落盘", () => {
    expect(saveStateLabel({ ...CLEAN, dirty: true, hasOpenDoc: true })).toBe("有未保存修改");
  });

  it("干净且开着文稿 ⇒ 已保存到本机", () => {
    expect(saveStateLabel({ ...CLEAN, hasOpenDoc: true })).toBe("已保存到本机");
  });

  it("干净但一篇都没开 ⇒ 未打开文稿：没有稿子就没有「已保存」可说", () => {
    expect(saveStateLabel({ ...CLEAN, hasOpenDoc: false })).toBe("未打开文稿");
  });

  it("五句互不相同：并句等于右栏头与页脚会说混话", () => {
    const values = Object.values(SAVE_STATE_LABELS);
    expect(values).toHaveLength(5);
    expect(new Set(values).size).toBe(5);
  });
});
