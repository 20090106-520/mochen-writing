/**
 * W-01 补完 · 源码接线契约：`.vue` 不进类型程序，芯片有没有读主进程预览、
 * 分工句是不是只有一份、样式有没有挂进全局，只能读源钉。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  countNeedle,
  scriptSource,
  styleSource,
  templateSource,
  typeScriptSource
} from "../utils/vue-source-reader";

const BAR = "components/ComposerContextBar.vue";
const BIBLE_PANEL = "components/StoryBiblePanel.vue";
const BRIEF = "utils/bible-brief.ts";

describe("输入区「本章带入」：只读主进程预览，不改装配", () => {
  it("数据来自 agent.contextPreview，判定真身只在 utils/bible-brief", () => {
    const script = scriptSource(BAR);
    expect(script).toContain("bibleBriefOf(agent.contextPreview)");
    expect(script).toContain("useAgentStore()");
    expect(countNeedle("export function bibleBriefOf(", typeScriptSource(BRIEF))).toBe(1);
    const judge = typeScriptSource(BRIEF);
    for (const needle of ["contextPreview(", "startTurn(", "excludedBible", "removeEntry"]) {
      expect(judge, `判定层不该碰 ${needle}`).not.toContain(needle);
    }
  });

  it("没有设定条目就不占位，展开用原生 details/summary（键盘可达不靠手写状态）", () => {
    const template = templateSource(BAR);
    expect(template).toContain('<details v-if="bibleBrief.count > 0" class="bible-brief">');
    expect(template).toContain('class="bible-brief-chip"');
    expect(template).toContain(':title="bibleBrief.fullText"');
    expect(template).toContain("{{ bibleBrief.chipText }}");
    expect(template).toContain('v-for="row in bibleBrief.rows"');
    expect(template).toContain("{{ row.typeLabel }}");
    expect(countNeedle("<details", template)).toBe(1);
    // 芯片不是第四枚「绑定选择器」：那三枚（书 / 文档 / 阶段）的语义与计数由既有守卫钉着。
    expect(template).not.toContain("composer-context-item bible-brief-chip");
    expect(countNeedle('class="composer-context-item', template)).toBe(3);
  });
});

describe("两套设定的分工：一句话两个入口同读", () => {
  it("常量只定义一次，两个组件都不许自己再写一遍", () => {
    expect(countNeedle("export const BIBLE_DIVISION_NOTE =", typeScriptSource(BRIEF))).toBe(1);
    const bar = scriptSource(BAR) + templateSource(BAR);
    const panel = scriptSource(BIBLE_PANEL) + templateSource(BIBLE_PANEL);
    expect(bar).toContain("BIBLE_DIVISION_NOTE");
    expect(panel).toContain("BIBLE_DIVISION_NOTE");
    expect(bar).not.toContain("短卡给 AI 看：");
    expect(panel).not.toContain("短卡给 AI 看：");
    expect(templateSource(BIBLE_PANEL)).toContain('class="bible-division-note"');
  });
});

describe("样式：单独成表并挂进全局入口", () => {
  it("弹层读层级与外框 token，分工说明复用同一份表", () => {
    const rootCss = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    expect(rootCss).toContain('@import "./styles/bible-brief.css";');
    const css = styleSource("bible-brief.css");
    expect(css).toContain(".bible-brief-pop");
    expect(css).toContain(".bible-brief-chip:focus-visible");
    expect(css).toContain("outline: 2px solid var(--accent)");
    expect(css).toContain("z-index: var(--z-menu)");
    expect(css).toContain("border-radius: var(--radius-panel)");
    expect(css).toContain(".bible-division-note");
  });
});
