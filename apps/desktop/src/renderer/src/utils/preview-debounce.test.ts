/**
 * 分栏预览静默窗的判定（2026-10-10 巡检，从 DocumentPane 的接线里抽出来）。
 *
 * 判定只有一句「分栏才等」，但它是**能出错的判定**：写成「预览态也等」会在切到
 * 纯预览时白等 250ms 才出画面；写成「分栏也不等」就退回每键 437ms 的卡死。
 * 抽成纯函数后逐档钉在这里，组件里只剩 `setTimeout(…, previewDelayMs(vm))`。
 */
import { describe, expect, it } from "vitest";
import { PREVIEW_DEBOUNCE_MS, previewDelayMs } from "./preview-debounce";

describe("previewDelayMs", () => {
  it("分栏开着：等一个静默窗再刷新（每键全量重算会把打字拖死，实测 437ms/键）", () => {
    expect(previewDelayMs("split")).toBe(PREVIEW_DEBOUNCE_MS);
  });

  it("纯编辑 / 纯预览 / 收起（空串）：立即跟，不排程", () => {
    expect(previewDelayMs("edit")).toBe(0);
    expect(previewDelayMs("preview")).toBe(0);
    expect(previewDelayMs("")).toBe(0);
  });

  it("静默窗是正数且够短：手感仍是边写边看，又真省得下全量重算", () => {
    expect(PREVIEW_DEBOUNCE_MS).toBeGreaterThan(0);
    expect(PREVIEW_DEBOUNCE_MS).toBeLessThanOrEqual(300);
  });
});
