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
import { ruleBlock, scriptSource, styleSource, templateSource } from "../utils/vue-source-reader";

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

/**
 * 筛选折条（2026-11-12）。
 *
 * 真机量到：搜索 38 + 五行档 182 + 行距 ⇒ 工具区 291px，卡片网格等到 y=383 才开始；
 * 902px 的窗口里首屏只剩三排卡，而这一页是给人「看画」的——十六套，扫一遍比筛一遍快。
 * 折起来之后工具区只剩搜索框 + 一枚 25px 的胶囊，网格回到 y≈187。
 *
 * 折的是**档**，不是能力：五行、每一枚档、点已选收回这一层，全都原样留在 DOM 里。
 */
describe("皮肤广场 · 筛选收进一条折条", () => {
  const markup = templateSource("components/SkinGalleryPage.vue");

  it("用原生 details 折起来——展开态、键盘、屏读器状态都由浏览器给，不新增按键监听", () => {
    expect(markup).toContain('<details class="skin-filter-fold">');
    expect(markup).toContain('<summary class="skin-filter-fold-summary"');
    // 默认收起：模板里不许写死 `open`（那会让每一页进来都摊着五行档）。
    expect(markup).not.toMatch(/<details class="skin-filter-fold"[^>]*\bopen\b/);
  });

  it("五行档一枚不少地留在折条里", () => {
    const fold = /<div class="skin-filter-rows">([\s\S]*?)<\/details>/.exec(markup)?.[1] ?? "";
    expect(fold, "折条里没有档组").toContain('v-for="row in rows"');
    expect(fold).toContain('class="skin-filter-row"');
    expect(fold).toContain('v-for="value in row.values"');
  });

  it("收起时胶囊报告「已选 N 项」，条件生效时自己变选中态", () => {
    expect(markup).toContain("已选 {{ activeCount }} 项");
    expect(markup).toContain("'is-active': activeCount > 0");
    // 数的是五行里不是「全部」的那几行：拿搜索词凑数会让「已选 1 项」指向一个不存在的档。
    const script = scriptSource("components/SkinGalleryPage.vue");
    expect(script).toContain("row.current !== ALL_SKIN_FILTER");
  });

  it("清空条件留在折条外面：条件在生效时不该先去点开折条", () => {
    const clearAt = markup.indexOf("skin-gallery-clear");
    const foldEnd = markup.indexOf("</details>");
    expect(clearAt).toBeGreaterThan(-1);
    expect(foldEnd).toBeGreaterThan(-1);
    expect(clearAt, "清空条件又被塞回折条里了").toBeGreaterThan(foldEnd);
  });

  it("收起态的胶囊与档同形，箭头展开时转 90°（▸→▾）", () => {
    const css = styleSource("skin-gallery.css");
    const summary = ruleBlock(css, ".skin-filter-fold-summary");
    expect(summary).toContain("border-radius: 999px");
    expect(summary).toContain("list-style: none");
    expect(ruleBlock(css, ".skin-filter-fold-summary::-webkit-details-marker")).toContain(
      "display: none"
    );
    expect(ruleBlock(css, ".skin-filter-fold[open] .skin-filter-caret")).toContain(
      "transform: rotate(90deg)"
    );
  });
});
