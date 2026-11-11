/// <reference types="node" />
/**
 * 对话框外壳 / 焦点环 / 弹层动效的一致性契约（2026-11-11）。
 *
 * 这一轮的四件事都是「同一件事散在各处，改一处忘一处」的老病灶：
 *  ① 五个 MODAL_DIALOGS 里只有 ImportTxtDialog 把样式写在 .vue 里，
 *     于是宽度 64px / 圆角 10px / 描边 --border 与基类 48px / 8px / --theme-line 各成一档；
 *  ② 对话框整族只有外观页三枚有实色焦点环，textarea 与 new-book-dir-input 还用
 *     `outline: none/0` 把全局键盘环盖掉（特异性比全局那条高）；
 *  ③ 三处手写 mochen-pop-in 各带一份时长兜底（140ms / 170ms / 无），且都不在
 *     motion.css 那张表、也不走 useComposerContextPopover——守卫口径完全量不到；
 *  ④ .dialog-content 是滚动容器却没进这一轮滚动条美化，玻璃底上全局那条淡 thumb 看不见。
 *
 * 【为什么动效那条要「白名单 ∪ 表」双向对齐】
 * overlay-chrome.test.ts 从「谁用了 popover composable」反推要求，只量得到表里的浮层。
 * 手写那三枚是自己的接线（注释里写明不归那张表管），不能硬塞进表里。
 * 于是这里把三枚钉成**带理由的白名单**，并要求「全 styles 里所有 mochen-pop-in 规则的选择器」
 * 恰好等于 `表 ∪ 白名单`：多一枚新的手写动画没登记会红，白名单里哪枚被删了也会红。
 *
 * 判据的字面量写在测试里，不从生产代码 import（与 skill-catalog.test.ts 的出处前缀同一条规矩）。
 */
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MODAL_DIALOGS,
  countNeedle,
  cssRules,
  popInSelectors,
  ruleBlock,
  scopedStyleSource,
  strippedStyleSource,
  styleSource,
  vueSource
} from "../utils/vue-source-reader";

const STYLES_DIR = fileURLToPath(new URL("../styles/", import.meta.url));
const dialogCss = strippedStyleSource("dialog.css");
const importTxtCss = strippedStyleSource("import-txt.css");

/** 一条规则（选择器用逗号并列时，按分号切开认每一枚）。 */
function ruleFor(css: string, selector: string): string | undefined {
  return cssRules(css).find((rule) =>
    rule.selector
      .split(",")
      .map((part) => part.trim())
      .includes(selector)
  )?.body;
}

describe("对话框族样式不进 .vue：ImportTxtDialog 收编进 styles/", () => {
  it("五个 MODAL_DIALOGS 全都不带 <style> 块", () => {
    for (const dialog of MODAL_DIALOGS) {
      expect(countNeedle("<style", vueSource(dialog.file)), `${dialog.name} 还在内联样式`).toBe(0);
    }
  });

  it("import-txt.css 接进了 styles.css，否则整份样式不会生效", () => {
    expect(vueSource("styles.css")).toContain('@import "./styles/import-txt.css";');
  });

  it("收编后与对话框族同口径：不再覆写宽度、不再用 10px 圆角、描边读 --theme-line", () => {
    expect(styleSource("import-txt.css")).not.toContain("width: min(");
    expect(importTxtCss).not.toContain("border-radius: 10px");
    expect(importTxtCss).not.toContain("var(--border)");
    expect(ruleBlock(importTxtCss, ".import-target")).toContain("border-radius: 8px");
    expect(ruleBlock(importTxtCss, ".import-chapter-row")).toContain("var(--theme-line)");
  });
});

describe("键盘焦点环：对话框整族同一条实色环，不许有规则把它盖掉", () => {
  const RING_SELECTORS = [
    ".appearance-select:focus-visible",
    ".appearance-segment-button:focus-visible",
    ".appearance-toggle:focus-visible",
    ".dialog-close:focus-visible",
    ".dialog-primary-button:focus-visible",
    ".dialog-secondary-button:focus-visible",
    ".dialog-content textarea:focus-visible",
    ".new-book-dir-input:focus-visible"
  ];

  it("八枚选择器共用同一条规则（不是两套口径），环是实色 --accent + 2px 偏移", () => {
    const bodies = RING_SELECTORS.map((sel) => {
      const body = ruleFor(dialogCss, sel);
      expect(body, `${sel} 没有焦点环规则`).toBeDefined();
      return body ?? "";
    });
    expect(new Set(bodies).size, "焦点环被拆成了多条规则").toBe(1);
    expect(bodies[0]).toContain("outline: 2px solid var(--accent)");
    expect(bodies[0]).toContain("outline-offset: 2px");
  });

  it("导入对话框的标题输入也挂同一条环", () => {
    const body = ruleFor(importTxtCss, ".import-chapter-title:focus-visible");
    expect(body).toContain("outline: 2px solid var(--accent)");
    expect(body).toContain("outline-offset: 2px");
  });

  it("三份对话框/设置样式里没有 `outline: none/0`：键盘环不许被特异性更高的规则吃掉", () => {
    const sources = [
      { name: "dialog.css", css: dialogCss },
      { name: "import-txt.css", css: importTxtCss },
      {
        name: "WritingGoalSettingsPanel.vue",
        css: scopedStyleSource("components/WritingGoalSettingsPanel.vue")
      }
    ];
    for (const { name, css } of sources) {
      const killers = cssRules(css)
        .filter((rule) => /outline:\s*(none|0)\b/.test(rule.body))
        .map((rule) => rule.selector.trim());
      expect(killers, `${name} 里还有把焦点环盖掉的规则`).toEqual([]);
    }
  });
});

/**
 * 手写入场动画的三枚（理由逐条写在这里，删一枚就要连这条守卫一起改）：
 * - .composer-more-menu：自己的 keydown 接线，注释明说不归 popover 那张表管；
 * - .scroll-to-bottom：常驻按钮的浮现，不是面板；
 * - .selection-rewrite-bar：选区改写条，锚在选区上，不用 popover 定位。
 */
const HANDWRITTEN_POP_IN = [
  ".composer-more-menu",
  ".scroll-to-bottom",
  ".selection-rewrite-bar"
] as const;

/** 选择器并列的规则里取「根类名」：`.editor-textarea-wrap .selection-rewrite-bar` 这类后代写法
 *  也只认最后一枚类，才能与 motion.css 那张表（都是单类选择器）对齐。 */
function rootClassOf(part: string): string | null {
  const classes = part.match(/\.[A-Za-z0-9_-]+/g);
  return classes === null ? null : (classes[classes.length - 1] ?? null);
}

describe("弹层入场：时长/曲线只有一个写法，表与手写白名单双向对齐", () => {
  const animated = readdirSync(STYLES_DIR)
    .filter((file) => file.endsWith(".css"))
    .flatMap((file) =>
      cssRules(strippedStyleSource(file))
        .filter((rule) => /animation:\s*mochen-pop-in/.test(rule.body))
        .map((rule) => ({ file, selector: rule.selector, body: rule.body }))
    );

  it("全 styles 下确实扫到了 mochen-pop-in 规则（空表 = 假绿）", () => {
    expect(animated.length).toBeGreaterThan(0);
  });

  it("每条动画都只读 token：不许再出现 140ms / 170ms / ease-out 各写一份兜底", () => {
    for (const rule of animated) {
      const declaration = /animation:\s*(mochen-pop-in[^;]*);/.exec(rule.body)?.[1]?.trim();
      expect(declaration, `${rule.file} ${rule.selector} 的入场写法漂了`).toBe(
        "mochen-pop-in var(--dur-pop) var(--ease-out-soft)"
      );
    }
  });

  it("所有 mochen-pop-in 选择器 = motion.css 的表 ∪ 手写白名单（多一枚/少一枚都红）", () => {
    const found = [
      ...new Set(
        animated
          .flatMap((rule) => rule.selector.split(",").map((part) => rootClassOf(part.trim())))
          .filter((cls): cls is string => cls !== null)
      )
    ].sort();
    const tabled = popInSelectors(strippedStyleSource("motion.css"));
    const expected = [...new Set([...tabled, ...HANDWRITTEN_POP_IN])].sort();
    expect(found).toEqual(expected);
    for (const sel of HANDWRITTEN_POP_IN) {
      expect(found, `白名单里那枚 ${sel} 已经不在样式表里了，白名单该跟着删`).toContain(sel);
    }
  });
});

describe("对话框滚动条：玻璃底上也看得见", () => {
  it(".dialog-content 的标准属性与 webkit hover 都给了", () => {
    const base = ruleBlock(dialogCss, ".dialog-content");
    expect(base).toContain("overflow-y: auto");
    expect(base).toContain("scrollbar-width: thin");
    expect(base).toContain("scrollbar-color:");
    expect(ruleBlock(dialogCss, ".dialog-content::-webkit-scrollbar-thumb")).toContain(
      "color-mix("
    );
    expect(ruleBlock(dialogCss, ".dialog-content::-webkit-scrollbar-thumb:hover")).toContain("85%");
  });

  it("导入对话框的章目列表同样有细滚动条：它自己也是滚动容器", () => {
    const list = ruleBlock(importTxtCss, ".import-chapter-list");
    expect(list).toContain("overflow-y: auto");
    expect(list).toContain("scrollbar-width: thin");
  });
});
