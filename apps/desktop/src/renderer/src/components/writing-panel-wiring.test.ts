/// <reference types="node" />
/**
 * 写作设置页接线契约（源码断言，2026-10-05 新增「写作」页签）：
 * ① 自动保存四档来自 utils/autosave-preference 的唯一档位表，点击写 saveAutosaveDelay——
 *    排程真身在 useBookStore.scheduleAutoSave（每次键入重读），面板不造第二份排程；
 * ② 档位按钮不禁用（与权限档同一条裁定：禁用会把「为什么改不了」藏起来）；
 * ③ 设置页有「写作」分类与渲染分支，layoutStore 的 SettingsTab 联合里有这一员——缺一边就是半截接线；
 * ④ 行距三档走 --editor-leading 变量；⑤ 正文字号三档 + 拼写检查开关走 utils/editor-text-preference
 *    （字号落 --editor-font-size，拼写检查绑 textarea 的 :spellcheck，正文字体五档在外观页不碰）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scriptSource, templateSource, vueSource } from "../utils/vue-source-reader";

const script = scriptSource("components/WritingPanel.vue");
const template = templateSource("components/WritingPanel.vue");
const page = vueSource("components/SettingsPage.vue");
const layout = readFileSync(new URL("../stores/layoutStore.ts", import.meta.url), "utf8");
const bookStore = readFileSync(new URL("../stores/useBookStore.ts", import.meta.url), "utf8");

/** 模板里每一枚档位卡片（`.agent-mode-card`）的 `<button …>` 开标签原文。 */
function optionButtonTags(tpl: string): string[] {
  return [...tpl.matchAll(/<button\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => tag.includes('class="agent-mode-card"'));
}

/** `v-for="option in <list>"` 那一枚 button 的开标签（循环列表往前找最近的那个开标签）。 */
function cardTagForList(tpl: string, list: string): string {
  const at = tpl.indexOf(`v-for="option in ${list}"`);
  expect(at, `面板里找不到 v-for="option in ${list}"`).toBeGreaterThan(-1);
  const before = tpl.slice(0, at);
  const lastOpen = before.lastIndexOf("<button");
  expect(lastOpen, `${list} 那一段里前面没有 button 开标签`).toBeGreaterThan(-1);
  return tpl.slice(lastOpen, tpl.indexOf(">", lastOpen) + 1);
}

describe("WritingPanel · 自动保存档接到既有真身", () => {
  it("选项来自 utils/autosave-preference，点击调 saveAutosaveDelay（不另造一份排程）", () => {
    expect(script).toContain('from "../utils/autosave-preference"');
    expect(script).toContain("autosaveOptions()");
    expect(script).toMatch(/saveAutosaveDelay\(storage, value\)/);
    // 排程真身在读档的那一头：store 每次键入 loadAutosaveDelay，面板只管写偏好。
    expect(bookStore).toContain("loadAutosaveDelay(autosavePreferenceStorage())");
    expect(bookStore).toContain('from "../utils/autosave-preference"');
  });

  it("反向：**档位按钮**不许禁用；选中态走 aria-pressed + check 字形", () => {
    // 守卫的判据在 2026-10-06 批次 5-⑧ 收窄过一次。原来它对整块模板断言「不含 :disabled」，
    // 那时面板里只有档位卡片与开关，两者都不该禁用；后来加了一枚「立即清理」这种
    // **动作按钮**——它没开书时就该点不动，整块断言于是失效。
    //
    // 收窄的是**范围**不是强度：被判的仍然只有档位卡片（`.agent-mode-card`），
    // 判据从「整块模板里没有」换成「每一枚档位卡片的开标签里没有」。
    // 动作按钮不在这个判据里，它自己的禁用由 writing-retention-wiring.test.ts 钉着
    // （`:disabled="pruning || !book.hasBook"` + 样式表里的 :disabled 规则）。
    const cards = optionButtonTags(template);
    expect(cards.length).toBeGreaterThan(0);
    for (const tag of cards) {
      expect(tag, `档位卡片不许禁用：${tag}`).not.toContain("disabled");
    }
    expect(template).toContain(':aria-pressed="current === option.value"');
    expect(template).toContain('name="check"');
  });

  it("设置页有「写作」这一页：分类、分支、import 三件都在", () => {
    expect(page).toContain('id: "writing"');
    expect(page).toContain('label: "写作"');
    expect(page).toContain("<WritingPanel v-else-if=\"settingsTab === 'writing'\" />");
    expect(page).toContain('import WritingPanel from "./WritingPanel.vue"');
    // 九个分类逐个认。**不许改成对联合类型整行的逐字匹配**：prettier 会按行宽把它折成
    // 一行一个 `| "x"`，整行匹配会让「格式化」这种无害操作变成测试红灯。
    // 这里比的是「这些都在联合里」，与它们排几行无关。
    // 2026-10-05：专注模式整条下线（番茄钟与 useWritingGoalStore 那套时长选择器是重复实现），
    // 「focus」这一员随之从设置页签与联合里一起消失——这里同步去掉，别把它留成永远红的一条。
    const settingsTab = /SettingsTab\s*=\s*([\s\S]*?);/.exec(layout)?.[1] ?? "";
    expect(settingsTab, "layoutStore.ts 里找不到 SettingsTab 联合类型").not.toBe("");
    for (const category of [
      "model",
      "agent",
      "writing",
      "appearance",
      "shortcuts",
      "goals",
      "projects",
      "about"
    ]) {
      expect(settingsTab, `SettingsTab 联合里少了「${category}」这一员`).toContain(`"${category}"`);
    }
    // 反向钉：功能下线了，联合里就不许再留着这一枚，否则会有人以为「设置页还能进专注模式」。
    expect(settingsTab).not.toContain('"focus"');
  });
});

describe("WritingPanel · 编辑器行距（2026-10-05 新增）", () => {
  it("三档来自 utils/editor-leading-preference，点击调 saveEditorLeading（不另造一份档位表）", () => {
    expect(script).toContain('from "../utils/editor-leading-preference"');
    expect(script).toContain("editorLeadingOptions()");
    expect(script).toMatch(
      /function chooseLeading[\s\S]{0,140}saveEditorLeading\(storage, value\)/
    );
    expect(script).toContain("loadEditorLeading(editorLeadingPreferenceStorage())");
  });

  it("值落进 DocumentPane 的 --editor-leading 变量，样式表 var 缺席即原值 1.95（两边不互相冒充默认档）", () => {
    const pane = vueSource("components/DocumentPane.vue");
    expect(pane).toContain('"--editor-leading"');
    expect(pane).toContain("loadEditorLeading(editorLeadingPreferenceStorage())");
    const css = readFileSync(new URL("../styles/editor-pane.css", import.meta.url), "utf8");
    expect(css).toContain("line-height: var(--editor-leading, 1.95)");
  });

  it("反向：行距档按钮同样不许禁用；选中态走 aria-pressed", () => {
    expect(template).toContain(':aria-pressed="currentLeading === option.value"');
    // 与自动保存那条同款判据：只看档位卡片，不看整块模板（动作按钮的禁用不在这个范围内）。
    const tag = cardTagForList(template, "leadingOptions");
    expect(tag, "行距档按钮不许禁用").not.toContain("disabled");
    expect(tag).toContain('class="agent-mode-card"');
  });
});

describe("WritingPanel · 正文字号与拼写检查（2026-10-05 新增）", () => {
  it("三档来自 utils/editor-text-preference，点击调 saveEditorSize（不另造一份档位表）", () => {
    expect(script).toContain('from "../utils/editor-text-preference"');
    expect(script).toContain("editorSizeOptions()");
    expect(script).toMatch(/function chooseSize[\s\S]{0,140}saveEditorSize\(storage, value\)/);
    expect(script).toContain("loadEditorSize(editorTextPreferenceStorage())");
  });

  it("值落进 DocumentPane 的 --editor-font-size 变量，样式表 var 缺席即原值（两边不互相冒充默认档）", () => {
    const pane = vueSource("components/DocumentPane.vue");
    expect(pane).toContain('"--editor-font-size"');
    expect(pane).toContain("loadEditorSize(editorTextPreferenceStorage())");
    const css = readFileSync(new URL("../styles/editor-pane.css", import.meta.url), "utf8");
    expect(css).toContain("font-size: var(--editor-font-size, 1.07143rem)");
  });

  it("拼写检查接同一份偏好：面板写 saveEditorSpellcheck，textarea 绑 :spellcheck 且写死 false 不许回来", () => {
    expect(script).toMatch(
      /function toggleSpellcheck[\s\S]{0,200}saveEditorSpellcheck\(storage, enabled\)/
    );
    expect(script).toContain("loadEditorSpellcheck(editorTextPreferenceStorage())");
    const paneTemplate2 = templateSource("components/DocumentPane.vue");
    expect(paneTemplate2).toContain(':spellcheck="editorSpellcheck"');
    expect(paneTemplate2).not.toContain('spellcheck="false"');
  });
});
