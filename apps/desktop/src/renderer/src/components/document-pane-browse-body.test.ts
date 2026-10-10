import { describe, expect, it } from "vitest";
import {
  countNeedle,
  ruleBlock,
  scriptSource,
  styleSource,
  templateSource
} from "../utils/vue-source-reader";

/**
 * 浏览那一格的三态判据住在 `utils/browse-body`（那边逐档有用例），这份只钉接线
 * （2026-10-09 全仓扫描 P1-9）。
 *
 * 旧写法是模板里一句 `book.browseContents[browseDoc.relPath] ?? "正在读取…"`：
 * 读盘失败那一格永远没有正文，于是界面**永远停在「正在读取…」**——比空着更糟，它在撒谎。
 * 这里钉三件事：判据被接进来、兜底那句从面板消失、失败那一态有自己的告警色（不是 tertiary 灰）。
 */
const PANE = "components/DocumentPane.vue";
// `styleSource` 吃的是 `styles/` 下的文件名，不是相对 renderer/src 的路径。
const STYLE = "editor-pane.css";

describe("DocumentPane · 浏览正文走三态判据，不再用 ?? 兜底", () => {
  it("脚本把 store 的正文表与失败理由表一起交给 browseBodyViewOf", () => {
    const script = scriptSource(PANE);
    expect(countNeedle("browseBodyViewOf", script)).toBe(2); // 导入一处、调用一处
    expect(countNeedle("book.browseErrors", script)).toBe(1);
    expect(countNeedle("../utils/browse-body", script)).toBe(1);
  });

  it('模板挂的是算好的那一格，旧的 `?? "正在读取…"` 兜底一句都不留', () => {
    const template = templateSource(PANE);
    expect(countNeedle("{{ browseView.text }}", template)).toBe(1);
    expect(countNeedle('?? "正在读取…"', template)).toBe(0);
    expect(countNeedle("正在读取…", template)).toBe(0);
    expect(countNeedle("正在读取…", scriptSource(PANE))).toBe(0);
  });

  it("失败那一态有告警色：仍用 tertiary 灰就等于把错误写成又一句占位话术", () => {
    expect(countNeedle("is-browse-failed", templateSource(PANE))).toBe(1);
    const rule = ruleBlock(styleSource(STYLE), ".document-preview-empty.is-browse-failed");
    expect(rule).toContain("--danger-text");
  });
});
