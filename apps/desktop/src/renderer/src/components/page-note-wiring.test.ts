/// <reference types="node" />
/**
 * 页面说明折叠条（2026-11-12）。
 *
 * 【这一轮修的是什么】
 * 技能库与皮肤广场的中栏里各躺着一段说明正文，长度 4 行与 9 段。真机量过皮肤广场那九段
 * 合计 **246.6px**、卡片网格从 **y=670** 才开始，而窗口高 902px —— 首屏只剩一排卡，
 * 而下面还有十六套皮肤要看。说明本身没有一句是错的，错在它一直摊开。
 * 现在收进 `<details>`：收起占一行，展开后与原来逐字一致。
 *
 * 【这里钉四件事，一件都不多】
 * ① 外壳用的是原生 `<details>`/`<summary>`，且**不许自己监听 keydown**（裁定 G5：全局按键
 *    只有 `useHotkeys` 一处）。用原生元素这件事本身就是「不新增按键通路」的实现方式；
 *    哪天有人为了「点 Esc 收起」加一个 window 监听，`hotkey-markers.test.ts` 会红，
 *    这条守卫则钉住「不需要也不许这么改」的理由还在。
 * ② 两个页面真的把说明段包进去了 —— 只 import 不包，等于白拿一件组件。
 * ③ 折叠条的标题必须是**具体的一件事**：「说明」「了解更多」这种标题等于没写，
 *    用户得点开才知道值不值那一次点击。
 * ④ 样式表那几条形状（去原生三角、箭头翻转、竖线、焦点环）与 import 顺序。
 */
import { describe, expect, it } from "vitest";
import { scriptSource, styleSource, templateSource } from "../utils/vue-source-reader";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const NOTE = "components/PageNote.vue";
const NOTE_CSS = styleSource("page-note.css");

/** `<PageNote …>…</PageNote>` 这一段的正文（只取到第一个闭合标签，本页没有嵌套调用）。 */
function noteBlocks(page: string): string[] {
  const markup = templateSource(page);
  return [...markup.matchAll(/<PageNote\b([^>]*)>([\s\S]*?)<\/PageNote>/g)].map(
    (m) => `${m[1] ?? ""}\u0000${m[2] ?? ""}`
  );
}

describe("折叠条本体：原生 details，不新增按键通路", () => {
  const markup = templateSource(NOTE);
  const script = scriptSource(NOTE);

  it("用原生 <details>/<summary>（展开态、键盘、屏读器状态、Ctrl+F 自动展开都是它自带的）", () => {
    expect(markup).toContain('<details class="page-note">');
    expect(markup).toContain('<summary class="page-note-summary">');
  });

  it("默认收起：模板里不许写 open 属性", () => {
    expect(markup, "折叠条默认展开了 —— 那这一件就没意义了").not.toMatch(/<details[^>]*\sopen\b/);
  });

  it("不许自己监听按键（裁定 G5：全局 keydown 只有 useHotkeys 一处）", () => {
    expect(script).not.toContain("keydown");
    expect(markup).not.toContain("keydown");
  });

  it("标题通过 prop 传进来，且是必填项（漏传就是一条没有牌子的横条）", () => {
    expect(script).toContain("summary: string;");
    expect(script, "summary 变成可选了 —— 可选就等于允许空标题").not.toContain("summary?:");
    expect(markup).toContain("{{ summary }}");
  });
});

describe("两个页面真的用上了", () => {
  it("技能库：两处说明都包进了折叠条（技能页一处、插件页一处）", () => {
    expect(scriptSource("components/ExtensionsPage.vue")).toContain(
      'import PageNote from "./PageNote.vue";'
    );
    const blocks = noteBlocks("components/ExtensionsPage.vue");
    expect(blocks.length, "技能库只挂了一处 —— 插件页那段还摊着").toBe(2);
    // 说明段落原样留在槽里：守卫（extensions-page-wiring）读源码要读得到 `.extensions-note`。
    for (const block of blocks) {
      expect(block, "折叠条里没有 .extensions-note —— 正文被搬走了").toContain(
        'class="extensions-note"'
      );
    }
  });

  it("皮肤广场：九段说明整段进了同一个折叠条", () => {
    expect(scriptSource("components/SkinGalleryPage.vue")).toContain(
      'import PageNote from "./PageNote.vue";'
    );
    const blocks = noteBlocks("components/SkinGalleryPage.vue");
    expect(blocks.length, "皮肤广场的说明被拆成了多个折叠条").toBe(1);
    const paragraphs = (blocks[0]?.match(/class="skin-gallery-note"/g) ?? []).length;
    expect(paragraphs, "有说明段落在折叠条外面").toBe(8);
  });

  it("标题写的是具体的事，不是「说明」「了解更多」", () => {
    const summaries = [
      ...noteBlocks("components/ExtensionsPage.vue"),
      ...noteBlocks("components/SkinGalleryPage.vue")
    ].map((block) => /summary="([^"]*)"/.exec(block)?.[1] ?? "");
    expect(summaries.length).toBe(3);
    for (const summary of summaries) {
      expect(summary.length, `标题太短，等于没说：${summary}`).toBeGreaterThanOrEqual(6);
      for (const empty of ["说明", "了解更多", "详情", "更多"]) {
        expect(summary, `标题是空话「${empty}」`).not.toBe(empty);
      }
    }
  });
});

describe("样式表：收起是一行，展开有竖线，焦点环不缺席", () => {
  it("原生三角要去掉（它是一枚实心三角，与全站描边图标不是一套）", () => {
    expect(NOTE_CSS).toContain("::-webkit-details-marker");
    expect(NOTE_CSS).toContain("list-style: none;");
  });

  it("summary 是可点的控件：鼠标指针 + 悬停底 + 自己的焦点环", () => {
    const block = /\.page-note-summary \{([\s\S]*?)\}/.exec(NOTE_CSS)?.[1] ?? "";
    expect(block).toContain("cursor: pointer");
    expect(NOTE_CSS).toContain(".page-note-summary:hover");
    // summary 不在 styles.css 那条全局焦点环的选择器组里（那里只有 button/input/select/textarea），
    // 所以这一枚必须自带，否则键盘 Tab 过去是无形的。
    const focus = /\.page-note-summary:focus-visible \{([\s\S]*?)\}/.exec(NOTE_CSS)?.[1] ?? "";
    expect(focus).toContain("outline:");
    expect(focus).toContain("var(--focus)");
  });

  it("展开时箭头从 ▸ 转成 ▾（与左栏目录树同一档 90°）", () => {
    const open = /\.page-note\[open\] \.page-note-caret \{([\s\S]*?)\}/.exec(NOTE_CSS)?.[1] ?? "";
    expect(open).toContain("transform: rotate(90deg)");
  });

  it("展开的正文左侧有一道竖线（读起来是附注，不是又一段正文）", () => {
    const body = /\.page-note-body \{([\s\S]*?)\}/.exec(NOTE_CSS)?.[1] ?? "";
    expect(body).toContain("border-left:");
    expect(body).toContain("--line-soft");
  });

  it("过渡走令牌，不写裸毫秒（与全站 --dur-fast 同一条）", () => {
    expect(NOTE_CSS).toContain("var(--dur-fast");
    expect(NOTE_CSS, "写死了毫秒数 —— 与全站那档脱钩").not.toMatch(/transition:[^;]*\d+ms/);
  });
});

describe("接线：样式表进了主表，且排在两个具体页之后", () => {
  const main = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");

  it("styles.css 导入了 page-note.css", () => {
    expect(main).toContain('@import "./styles/page-note.css";');
  });

  it("排在 extensions.css 与 skin-gallery.css 之后（同特异性时才轮得到它说话）", () => {
    const at = (needle: string): number => {
      const index = main.indexOf(needle);
      expect(index, `styles.css 里没有 ${needle}`).toBeGreaterThan(-1);
      return index;
    };
    expect(at('@import "./styles/page-note.css";')).toBeGreaterThan(
      at('@import "./styles/extensions.css";')
    );
    expect(at('@import "./styles/page-note.css";')).toBeGreaterThan(
      at('@import "./styles/skin-gallery.css";')
    );
  });

  it("`info` 图标真画出来了（没画就是标题前面一块空白）", () => {
    const icon = templateSource("components/AppIcon.vue");
    expect(icon).toContain("name === 'info'");
    const types = readFileSync(
      fileURLToPath(new URL("../types/icons.ts", import.meta.url)),
      "utf8"
    );
    expect(types).toContain('"info"');
  });
});
