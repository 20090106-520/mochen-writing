import { describe, expect, it } from "vitest";
import { decideCopy, shouldAssemble, type CopyInput } from "./export-clipboard";

/**
 * 导出对话框那两枚「说假话」的控件（2026-10-09 扫描总单）。
 *
 * 这一族全部对着**修复前的真实行为**写：旧 `copyToClipboard` 是
 * `await writeText(previewResult.content); copyDone = true`——组装失败时 `content` 已被清成 ""，
 * 于是复制了一个空串却显示「已复制」；旧 `refreshPreview` 把空选传成 `docRelPaths: []`，
 * 服务层按「[] = 全部章节」组装，预览摆出全书而按钮禁用。
 * 下面每条用例都在钉这两种谎；把 `export-clipboard.ts` 换成
 * 「一律 return { kind: "copy", text: input.content }」「shouldAssemble 恒 true」时，
 * 标着的这几条必须红（本轮以此代替先红后绿的那一步，如实记在台账）。
 */
const base: CopyInput = { format: "markdown", content: "正文内容", assembleError: "" };

describe("decideCopy · 复制这一刀不许说谎", () => {
  it("有内容、没失败：才真的复制，且复制的就是那一份内容", () => {
    expect(decideCopy(base)).toEqual({ kind: "copy", text: "正文内容" });
  });

  it("组装失败（内容已被清成空串）：拦下来并说明原因，绝不给「已复制」", () => {
    const blocked = decideCopy({
      ...base,
      content: "",
      assembleError: "导出内容没组装出来：EPERM"
    });
    expect(blocked.kind).toBe("blocked");
    if (blocked.kind !== "blocked") return;
    expect(blocked.level).toBe("warning");
    // 理由要说的是「没组装出来」，而不是格式问题——那会把人引偏。
    expect(blocked.message).toContain("没有组装成功");
  });

  it("EPUB 永远不许走复制：那是二进制包，贴出来是乱码", () => {
    const blocked = decideCopy({ ...base, format: "epub", content: "PK\u0003\u0004" });
    expect(blocked.kind).toBe("blocked");
    if (blocked.kind !== "blocked") return;
    expect(blocked.message).toContain(".epub");
  });

  it("EPUB 与组装失败同时成立时报组装失败：真正的原因是后者", () => {
    const blocked = decideCopy({
      format: "epub",
      content: "",
      assembleError: "导出内容没组装出来：EPERM"
    });
    if (blocked.kind !== "blocked") throw new Error("这一格该拦");
    expect(blocked.message).toContain("没有组装成功");
  });

  it("空选／全空白内容：按「没有可复制的内容」拦下，而不是复制一个空串", () => {
    for (const content of ["", "   ", "\n\n"]) {
      const blocked = decideCopy({ ...base, content });
      expect(blocked.kind, `空内容（${JSON.stringify(content)}）不许放行复制`).toBe("blocked");
    }
  });

  it("只有空白的 EPUB 也不给复制：两条拦截任一命中都不放行", () => {
    expect(decideCopy({ format: "epub", content: "", assembleError: "" }).kind).toBe("blocked");
  });
});

describe("shouldAssemble · 空选不去组装（服务层那套「[]=全部」不许在界面上当「没选」用）", () => {
  it("一枚都没勾：不去调用 buildExport", () => {
    expect(shouldAssemble(0)).toBe(false);
  });

  it("勾了任意一枚：照常组装", () => {
    expect(shouldAssemble(1)).toBe(true);
    expect(shouldAssemble(128)).toBe(true);
  });
});
