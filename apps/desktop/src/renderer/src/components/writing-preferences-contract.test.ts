/// <reference types="node" />
/**
 * 写作设置页新增控件的接线契约（源码断言，2026-10-06：正文宽度档 + 「自动行为」两枚开关）。
 *
 * 为什么另起一个文件而不是并进 `writing-panel-wiring.test.ts`：那份是既有守卫，
 * 两侧同时改一个测试文件迟早对撞。这里只钉本轮新增的东西，钉法照旧例：
 * ① 控件真的摆在「写作」这一节里（`tagAttributes` 按标签切开取属性，注释与旁白喂不饱它）；
 * ② 绑的是那个偏好而不是写死的字面量（`v-for` 循环源 + 点击回调 + 模板里不许出现档位字面量）；
 * ③ 默认档与样式表里现值一致（从 CSS 里把 var 的兜底抠出来比，不抄一份）；
 * ④ 值挂对了地方：三档变量都挂 `.editor-document`（它是编辑面 / 分栏预览 / 浏览态 /
 *    查找高亮这四个盒子的共同祖先），挂到其中任意一个上，另外几个就读不到——
 *    这条用「textarea 与 wrap 上都不许出现 :style」反着钉（2026-10-06 批次 5-㉒）。
 *
 * 顺带把行距那一档钉住（2026-10-06 复查：控件本来就在 WritingPanel「编辑器行距」一节里，
 * 所以这里只加守卫，不动面板那几行）。
 */
import { describe, expect, it } from "vitest";
import {
  countNeedle,
  ruleBlock,
  scriptSource,
  styleSource,
  tagAttributes,
  templateSource
} from "../utils/vue-source-reader";
import { EDITOR_MEASURE_DEFAULT } from "../utils/editor-measure-preference";

const PANEL = "components/WritingPanel.vue";
const panelScript = scriptSource(PANEL);
const panelTpl = templateSource(PANEL);
const paneScript = scriptSource("components/DocumentPane.vue");
const paneTpl = templateSource("components/DocumentPane.vue");

/** 取某个 aria-label 的那一组档位按钮的外壳属性（结构：这样的组恰好一个）。 */
function groupFor(label: string): string {
  const groups = tagAttributes(panelTpl, "agent-mode-grid").filter((attrs) =>
    attrs.includes(`aria-label="${label}"`)
  );
  expect(groups, `面板里找不到 aria-label="${label}" 的那一组档位按钮`).toHaveLength(1);
  return groups[0] ?? "";
}

/**
 * 那一组的**整节** markup：从 `aria-label="…"` 那组按钮切到下一个 `<h2>`（下一节的分界）。
 * `tagAttributes` 只给出外壳标签自己的属性，`v-for` / `@click` 在节内的 `<button>` 上——
 * 只看外壳会把「循环挂在哪个列表上」这条漏成永绿。
 */
function sectionFor(label: string): string {
  const at = panelTpl.indexOf(`aria-label="${label}"`);
  expect(at, `面板里找不到 aria-label="${label}" 的那一组档位按钮`).toBeGreaterThan(-1);
  const nextHeading = panelTpl.indexOf('<h2 class="settings-group-title">', at);
  return panelTpl.slice(at, nextHeading === -1 ? undefined : nextHeading);
}

describe("WritingPanel · 正文宽度档（2026-10-06 新增）", () => {
  it("档位来自 utils/editor-measure-preference，循环渲染 + 点击调 saveEditorMeasure", () => {
    expect(panelScript).toContain('from "../utils/editor-measure-preference"');
    expect(panelScript).toContain("editorMeasureOptions()");
    expect(panelScript).toMatch(
      /function chooseMeasure[\s\S]{0,140}saveEditorMeasure\(storage, value\)/
    );
    expect(panelScript).toContain("loadEditorMeasure(editorMeasurePreferenceStorage())");
    const group = groupFor("正文宽度");
    expect(group).toContain('aria-label="正文宽度"');
    const section = sectionFor("正文宽度");
    expect(section).toContain('v-for="option in measureOptions"');
    expect(section).toContain('@click="chooseMeasure(option.value)"');
    expect(section).toContain(':aria-pressed="currentMeasure === option.value"');
  });

  it("反向：模板里不许出现档位字面量与档位标签（那是 .vue 里抄的第二份档位表）", () => {
    for (const literal of [
      "44ch",
      "52ch",
      "60ch",
      "68ch",
      "76ch",
      "满宽",
      "超宽",
      "宽屏",
      "疏朗",
      "特大"
    ]) {
      expect(panelTpl, `面板模板里不该出现字面量 ${literal}`).not.toContain(literal);
    }
    // 五组循环各出现一次：多画一遍就是同一档位表的第二份实现，少画一遍就是控件没摆出来。
    for (const loop of [
      'v-for="option in options"',
      'v-for="option in leadingOptions"',
      'v-for="option in sizeOptions"',
      'v-for="option in measureOptions"',
      'v-for="option in autoSwitches"'
    ]) {
      expect(countNeedle(loop, panelTpl), `${loop} 的出现次数不对`).toBe(1);
    }
  });

  it("三档变量都挂 .editor-document（三面 + 高亮层的共同祖先），任何单个读稿子的盒子都不许带", () => {
    const docs = tagAttributes(paneTpl, "editor-document");
    expect(docs.filter((attrs) => attrs.includes(':style="editorLayoutStyle"'))).toHaveLength(1);
    // 变量挂在其中任意一个盒子上，另外几个就读不到、只吃样式表兜底：
    // 挂 textarea → mirror 不跟（字号 18px 对 15px，行数 12 对 14）；
    // 挂 .editor-textarea-wrap → 分栏预览与浏览两面不跟（左右并排两种字号）。
    // 这条从「只禁 textarea」扩到「三个盒子一起禁」，保证是变大不是变小。
    const textarea = /<textarea\b[\s\S]*?\/>/.exec(paneTpl)?.[0] ?? "";
    expect(textarea).not.toContain(":style=");
    const wraps = tagAttributes(paneTpl, "editor-textarea-wrap");
    expect(
      wraps.filter((attrs) => attrs.includes(":style=")),
      "wrap 上不该再有 :style"
    ).toHaveLength(0);
    expect(paneScript).toContain("loadEditorMeasure(editorMeasurePreferenceStorage())");
    expect(paneScript).toContain('"--editor-measure"');
    expect(paneScript).toContain('"--editor-font-size"');
    expect(paneScript).toContain('"--editor-leading"');
  });

  it("样式表：var 的兜底就是默认档 none，两边不互相冒充默认档", () => {
    const css = styleSource("editor-pane.css");
    const rule = ruleBlock(css, ".editor-textarea-wrap");
    expect(rule).toContain("max-width: var(--editor-measure, none)");
    // 收窄之后那一列要居中；不限宽时没有余量可分，与改动前逐像素相同。
    expect(rule).toContain("width: 100%");
    expect(rule).toContain("margin-inline: auto");
    const fallback = /max-width:\s*var\(--editor-measure,\s*([^)]+)\)/.exec(rule)?.[1]?.trim();
    expect(fallback).toBe(EDITOR_MEASURE_DEFAULT);
  });
});

describe("WritingPanel · 自动行为一节（2026-10-06 新增）", () => {
  it("两行开关从 utils/auto-behavior-preference 的表里循环出来", () => {
    expect(panelScript).toContain('from "../utils/auto-behavior-preference"');
    expect(panelScript).toContain("autoBehaviorOptions()");
    expect(panelScript).toMatch(
      /function toggleAuto[\s\S]{0,200}saveAutoSwitch\(storage, id, enabled\)/
    );
    expect(panelTpl).toContain('v-for="option in autoSwitches"');
    expect(panelTpl).toContain(':checked="autoStates[option.id]"');
    expect(panelTpl).toContain('@change="toggleAuto(option.id, $event)"');
  });

  it("关掉之后会怎样由表里那句 offEffect 渲染，面板不另抄一段后果文案", () => {
    expect(panelTpl).toContain("option.offEffect");
    for (const literal of ["输入框留住原文", "写盘要你自己触发"]) {
      expect(panelTpl, `面板模板里不该出现字面量 ${literal}`).not.toContain(literal);
    }
  });

  /**
   * 自动保存的档位表**只画一遍**。
   *
   * 原来这条是靠「整块模板里 `agent-mode-grid` 一共 4 组」来数的——那时面板里恰好只有那四组，
   * 于是总数成了「有没有多画一遍自动保存」的代理指标。2026-10-06 批次 5-⑧ 加了
   * 「改稿历史保留」的份数/体积两组之后代理指标失效了（变成 6），而**被守的东西没变**。
   *
   * 改成直接数自动保存自己那一组：`aria-label="自动保存静默窗"` 只该出现一次。
   * 这样以后再加任何一组档位都不用回来改这条守卫，而「自动保存被画了两遍」照样会红。
   */
  it("自动保存的档位表没有被第二遍画出来（自动保存自己那一组只出现一次）", () => {
    expect(countNeedle('aria-label="自动保存静默窗"', panelTpl)).toBe(1);
    // 并且那一组里画的就是自动保存那一份档位表，不是别的。
    // 用 sectionFor（取整节）而不是 groupFor（只取外壳标签属性）——循环挂在节内的按钮上。
    const section = sectionFor("自动保存静默窗");
    expect(section).toContain('v-for="option in options"');
    expect(section).toContain('@click="choose(option.value)"');
    expect(panelScript).toContain("autosaveOptions()");
  });
});

describe("WritingPanel · 编辑器行距那一档（2026-10-06 复查：控件本来就在，只加守卫）", () => {
  it("「编辑器行距」这一节真的渲染了 editor-leading-preference 那三档", () => {
    expect(panelScript).toContain('from "../utils/editor-leading-preference"');
    expect(panelScript).toContain("editorLeadingOptions()");
    const group = groupFor("编辑器行距");
    expect(group).toContain('aria-label="编辑器行距"');
    const section = sectionFor("编辑器行距");
    expect(section).toContain('v-for="option in leadingOptions"');
    expect(section).toContain('@click="chooseLeading(option.value)"');
    expect(section).toContain(':aria-pressed="currentLeading === option.value"');
    // 值落到 DocumentPane 的 --editor-leading 变量上（样式表兜底 1.95 = 原值）。
    expect(paneScript).toContain("loadEditorLeading(editorLeadingPreferenceStorage())");
    expect(styleSource("editor-pane.css")).toContain("line-height: var(--editor-leading, 1.95)");
  });
});
