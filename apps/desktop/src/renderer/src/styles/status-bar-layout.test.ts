/**
 * 状态栏是**一条一行的横带**（2026-11-20 真机撞到）。
 *
 * 真机症状：提示一长（那条「这只清空本页显示；盘上的会话历史不动，重启后仍会完整回放。」），
 * 状态栏里的 flex 子项就被压扁——屏幕上「就绪」竖成两行、「设定未存好」竖成三行、
 * 「重试保存」的胶囊被压成两行碎字。中文是按字断行的，不是出省略号，
 * 所以屏上读出来是「一排碎字」，不是「一条状态栏」。
 *
 * ⇒ 这一行不许换行；每一格钉死不缩；长提示是唯一可以变窄的东西（自己截断）；
 *   上下文占用读数钉在最右端。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../", import.meta.url));
const agentPane = readFileSync(path.join(SRC, "styles", "agent-pane.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  " "
);

function blocksOf(source: string, suffix: string): string[] {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1]!.split(",").some((selector) => selector.trim().endsWith(suffix)))
    .map((match) => match[2]!);
}

describe("状态栏 · 一行横带", () => {
  it("这一行不许换行，也不许横向溢出", () => {
    const bar = blocksOf(agentPane, ".agent-statusbar")[0];
    expect(bar, "读不到 .agent-statusbar 的基规则").toBeDefined();
    expect(bar).toContain("flex-wrap: nowrap");
    expect(bar).toContain("overflow: hidden");
  });

  it("每一格钉死不缩：压扁的后果是中文按字断行", () => {
    const rule = blocksOf(agentPane, ".agent-statusbar > *")[0];
    expect(rule, "读不到 .agent-statusbar > * 这条").toBeDefined();
    expect(rule).toContain("flex: 0 0 auto");
    expect(rule).toContain("white-space: nowrap");
  });

  it("长提示是唯一可以变窄的那一格：自己截成一行带省略号", () => {
    const rule = blocksOf(agentPane, ".agent-statusbar > .status-note")[0];
    expect(rule, "读不到 .agent-statusbar > .status-note 这条").toBeDefined();
    expect(rule).toContain("flex: 0 1 auto");
    expect(rule).toContain("min-width: 0");
    expect(rule).toContain("text-overflow: ellipsis");
  });

  it("上下文占用读数钉在最右端（常驻且要一眼扫到的那一格）", () => {
    const rule = blocksOf(agentPane, ".agent-statusbar > .context-meter")[0];
    expect(rule, "读不到 .agent-statusbar > .context-meter 这条").toBeDefined();
    expect(rule).toContain("margin-left: auto");
  });
});
