/**
 * 皮肤广场筛选档的排版守卫（2026-10-22 窄窗逐页走查第三站）。
 *
 * 【为什么单独一个文件】
 * 原本打算写进 `appearance-skin-plaza-wiring.test.ts`，但那份正好在 800 行预算的边缘
 * （799 行），加一条就触发 `check-source-line-budget.mjs`。拆点按**钉的对象**切：
 * 这一份只钉「筛选档放不下时怎么排」，与那份「这一页到底接没接上」不是同一类判据。
 *
 * 【钉的是哪一次真机】
 * 「画面」「挂件」两行各有十六枚档，原先直接挂在 `.skin-filter-row` 这条单行 flex 上：
 * 档默认 `flex-shrink: 1`，而按钮里的中文能在任意字间折行 ⇒ 放不下时不折行，
 * 而是每枚被压成两个字宽（1600 CSS：「绯青夜景」→「绯青夜 / 景」，「全部」→「全 / 部」），
 * 再往后整枚溢出窗口右缘（1000 CSS：「樱站昼樱」「枫叶」落在窗外，点不到）。
 * 同一个成因族见 §一百四十七（右栏页签折成竖排）。
 */
import { describe, expect, it } from "vitest";
import { ruleBlock, styleSource, templateSource } from "../utils/vue-source-reader";

describe("皮肤广场 · 筛选档放不下时折行", () => {
  const PAGE = "components/SkinGalleryPage.vue";

  it("档整组允许折行，单枚不收缩、文字不折行", () => {
    const css = styleSource("skin-gallery.css");
    const values = ruleBlock(css, ".skin-filter-values");
    expect(values).toContain("flex-wrap: wrap");
    // 同 .skin-gallery 那条：flex 子项不给 min-width: 0 就不肯缩，会把这一格撑开。
    expect(values).toContain("min-width: 0");
    const chip = ruleBlock(css, ".skin-filter");
    expect(chip).toContain("flex: 0 0 auto");
    expect(chip).toContain("white-space: nowrap");
  });

  it("折行发生在「标签右侧那一组」里，不在整行上", () => {
    // 折在 `.skin-filter-row` 本身上也能不出两行字，但续行会回到组标签左边、
    // 与标签起始位对齐着掉下来，四行的档就不再横向对齐（那正是定宽 52px 想保住的东西）。
    expect(templateSource(PAGE)).toMatch(
      /class="skin-filter-values"[\s\S]*?v-for="value in row\.values"/
    );
  });
});
