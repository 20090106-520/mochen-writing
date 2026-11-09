import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  scriptSource,
  styleSource,
  templateSource,
  typeScriptSource
} from "../utils/vue-source-reader";

/**
 * 多视角审稿打分的**接线契约**（2026-10-05，批次 4-②）。
 *
 * 判定在 `utils/review-score.ts`（那里有 37 条真单测），本文件只钉「接没接上」——
 * 本仓 `.vue` 不进类型程序，组件里漏一个 import 编译器一声不吭、运行时才炸
 * （批次 4-① 就在 `CenterColumn.vue` 上真撞到过一次 `workModeOf` 未导入）。
 *
 * 钉的六件事：
 * ① 入口是真按钮，禁用条件是「没开书」；
 * ② 面板挂在 DocumentPane 里、锚点就是那颗按钮，开合切的是组件那一格；
 * ③ **扫的是活动文稿的草稿**——扫盘上那份的话，作者会对着没写过的内容被指正；
 * ④ 交读数给 AI 走 `prefillComposer` 且**不自动发送**（用户保留最后一道编辑权）；
 * ⑤ 「算不出哪几项」必须真的摆在界面上，且不许和分数条混在一块（混了就像打了 0 分）；
 * ⑥ 文案不许把分数说成质量分——「60 是中性基准，不是及格线」这句必须在。
 */
const paneScript = scriptSource("components/DocumentPane.vue");
const paneTpl = templateSource("components/DocumentPane.vue");
const menuTpl = templateSource("components/ReviewMenu.vue");
const panelScript = scriptSource("components/ReviewScorePanel.vue");
const panelTpl = templateSource("components/ReviewScorePanel.vue");
const reviewTools = typeScriptSource("utils/review-tools.ts");
const css = styleSource("review.css");
const stylesCss = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const icons = readFileSync(new URL("../types/icons.ts", import.meta.url), "utf8");

describe("入口挂在哪", () => {
  // P0-5：这枚检查从平铺收进了「审稿」下拉，入口与判据不变，只是位置变了。
  it("「审稿」下拉里有这一项，禁用条件是「没开书」而不是永远可点", () => {
    expect(reviewTools).toContain('id: "review"');
    expect(reviewTools).toContain('label: "审稿打分"');
    expect(reviewTools).toContain('icon: "chart"');
    expect(menuTpl).toContain('@click="choose(tool)"');
    expect(menuTpl).toContain(':disabled="disabled"');
  });

  it("按钮用的图标名真实存在——挂一个不存在的名字会静默渲染成空白", () => {
    const names = [...(paneTpl + menuTpl).matchAll(/<AppIcon name="([a-z-]+)"/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(icons).toContain(`| "${name}"`);
    }
  });

  it("面板挂在 DocumentPane 里，锚点是「审稿」那颗稳定按钮（不是菜单行）", () => {
    expect(paneScript).toContain("const reviewMenuButton = ref<HTMLElement>();");
    expect(paneScript).toContain(
      "const reviewMenuAnchor = computed(() => reviewMenuButton.value ?? null);"
    );
    expect(paneTpl).toContain("<ReviewScorePanel");
    expect(paneTpl).toContain(':anchor="reviewMenuAnchor"');
  });

  it("组件真的 import 了（漏 import 编译器不报、运行时才炸，4-① 踩过）", () => {
    expect(paneScript).toContain('import ReviewScorePanel from "./ReviewScorePanel.vue";');
  });

  it("开合住在组件本地，不给 store 添一格——它没有第二个消费者", () => {
    expect(paneScript).toContain("const reviewOpen = ref(false);");
    // 反向钉：别哪天顺手塞进 store 变成跨组件共享，那是没有第二份需求的状态。
    expect(paneScript).not.toMatch(/book\.\w*review\w*/i);
  });
});

describe("扫的是哪一份正文", () => {
  it("用 book.draft（含未保存手改），不是盘上那份", () => {
    expect(panelScript).toContain("reviewReport(book.draft)");
  });

  it("空正文给的是「没什么可数的」，不是四个 0 分", () => {
    expect(panelTpl).toContain("这一篇还没有正文，没什么可数的。");
  });
});

describe("诚实边界：算不出的那几项必须摆在界面上", () => {
  it("MISSING_METRICS 被模板真的渲染出来，不是 import 了扔一边", () => {
    expect(panelScript).toContain("MISSING_METRICS");
    expect(panelTpl).toContain('v-for="m in MISSING_METRICS"');
    expect(panelTpl).toContain("{{ METRIC_MISSING_NOTE }}");
  });

  it("算不出的那几项有独立区块，不与分数条共用一张底——混了就像给它们打了 0 分", () => {
    expect(panelTpl).toContain("review-score-missing");
    expect(css).toContain(".review-score-missing {");
    // 独立区块的视觉标记：虚线边，和有分数的实底块区分开。
    expect(css).toMatch(/\.review-score-missing\s*\{[^}]*border:\s*1px dashed/);
  });

  it("分数条上画出 60 的刻度——不然「离 60 还差 40」会被看成「离及格还差 40」", () => {
    expect(panelTpl).toContain("neutralMark");
    expect(css).toContain(".review-score-mark {");
  });
});

describe("文案不许把读数说成质量分", () => {
  it("「不是及格线」这句免责说明真的在界面上", () => {
    expect(panelTpl).toContain("不是及格线");
  });

  it("界面上不许出现「合格 / 通过 / 得分」这类质量判断词", () => {
    for (const word of ["合格", "通过", "得了几分", "打分结果"]) {
      expect(panelTpl).not.toContain(word);
    }
  });
});

describe("交给 AI 那一步", () => {
  it("走 prefillComposer 且不自动发送", () => {
    expect(panelScript).toContain("agent.prefillComposer(");
    expect(panelScript).not.toContain("agent.send(");
  });

  it("给的是读数不是结论——明确要求 AI 别再给分", () => {
    expect(panelScript).toContain("请你**不要给分数**");
  });

  it("没打开文稿时不预填（跟 threadKeyFor 的 UNBOUND 口径一致）", () => {
    expect(panelScript).toContain("if (book.activeDocTab === null) return;");
  });
});

describe("样式表接上了", () => {
  it("review.css 挂进 styles.css，否则整份样式不生效", () => {
    expect(stylesCss).toContain('@import "./styles/review.css";');
  });

  it("主操作在滚动区**外面**，不许跟着内容滚（真机截图：sticky 按钮会压住后两个维度）", () => {
    // 2026-10-05 真机撞出来的：最初是「整个浮层滚动 + 按钮 sticky」，
    // 结果 sticky 只保证按钮不滚出视口、不保证它不压内容——它浮在列表中间，
    // 把「对白/套话」两个维度和「算不出那两项」全盖住了。
    expect(panelTpl).toContain('class="review-score-body"');
    expect(css).toMatch(/\.review-score-body\s*\{[^}]*overflow-y:\s*auto/);
    // 按钮在 .review-score-body 的闭合标签之后，所以它不参与滚动。
    const bodyEnd = panelTpl.indexOf("</div>", panelTpl.indexOf('class="review-score-body"'));
    const handAt = panelTpl.indexOf('class="review-score-hand"');
    expect(bodyEnd).toBeGreaterThan(0);
    expect(handAt).toBeGreaterThan(bodyEnd);
    // 反向钉：按钮身上不许再挂 sticky。
    expect(css).not.toMatch(/\.review-score-hand\s*\{[^}]*position:\s*sticky/);
  });

  it("分数条按档上色，但只用中性色——满屏红绿会把读数渲染成审判", () => {
    expect(css).toContain(".review-score-item.is-low .review-score-fill");
    expect(css).not.toContain("--danger");
  });
});
