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

describe("输入区「本章带入」：读数仍只来自主进程预览；移除只影响下一轮装配", () => {
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

  it("「本轮不带」只经 useBibleExclusionStore 转手（不自己拼 IPC、不改 story-bible 文件）", () => {
    const script = scriptSource(BAR);
    expect(script).toContain("useBibleExclusionStore()");
    expect(script).toContain("exclusion.rowsOf(book.meta.id)");
    expect(script).toContain("exclusion.exclude(book.meta.id, row)");
    expect(script).toContain("exclusion.include(book.meta.id, key)");
    expect(script).toContain("exclusion.clear(book.meta.id)");
    for (const needle of ["window.mochen", "startTurn(", "contextPreview("]) {
      expect(script, `组件不该自己发 ${needle}`).not.toContain(needle);
    }
  });

  it("没有条目也不许整个消失：全部点掉后芯片仍在，能一条条恢复", () => {
    const template = templateSource(BAR);
    expect(template).toContain(
      '<details v-if="bibleBrief.count > 0 || excludedBible.length > 0" class="bible-brief">'
    );
    expect(template).toContain('class="bible-brief-chip"');
    expect(template).toContain("bibleBrief.chipText");
    expect(template).toContain("bibleBrief.fullText");
    expect(template).toContain("excludedChipText");
    expect(template).toContain('v-for="row in bibleBrief.rows"');
    expect(template).toContain("{{ row.typeLabel }}");
    expect(template).toContain('class="bible-brief-drop"');
    expect(template).toContain('class="bible-brief-restore"');
    expect(template).toContain('class="bible-brief-restore-all"');
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
    // 「本轮不带」的三枚按钮与恢复区：焦点环与前两枚同一取值，键盘一样能走到。
    expect(css).toContain(".bible-brief-excluded-head");
    expect(css).toContain(".bible-brief-drop:focus-visible");
    expect(css).toContain(".bible-brief-restore-all");
  });
});
