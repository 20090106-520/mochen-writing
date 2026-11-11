/// <reference types="node" />
/**
 * 字号阶梯（2026-11-11）。
 *
 * 【病灶】全仓字号原先有二十多种取值：0.75rem(10.5px)、0.821429rem(11.5px)、
 * 0.875rem(12.25px)、0.8125rem(11.375px)、0.8rem(11.2px)、0.82rem(11.48px)……
 * 一半是「随手写个 rem」，落到 14px 基准上根本不是整数像素。1.5 倍屏上
 * 10.5px / 11.5px / 12.25px 会被取整到 1/3 设备像素，笔画一边厚一边薄 ——
 * 这就是「字体看着不精致」的真正来源，不是字族选得不对。
 *
 * 【裁定】字号只许落在这十四档上（括号里是 14px 基准下的实际像素）：
 * 9 / 10 / 11 / 12 / 13 / 14 / 15 / 16 / 18 / 20 / 22 / 24 / 28 / 36。
 * 每档都是整数像素；rem 值按 N/14 取六位小数（四舍五入到第六位）。
 *
 * 为什么允许十四档而不是 Material 的六档：中文正文与注释的层级比拉丁文密，
 * 砍到六档会把「10 与 11」「12 与 13」之间的语义差压没，反而要改大量组件的尺寸。
 * 这一轮只做**归一**（把 10.5 收进 11、12.25 收进 12），不动任何一处想表达的意思。
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { vueSource } from "../utils/vue-source-reader";

/** 十四档，按 14px 基准换算后的 rem 值。顺序即从小到大，守卫会钉它严格递增。 */
export const FONT_LADDER_REM = [
  "0.642857", // 9
  "0.714286", // 10
  "0.785714", // 11
  "0.857143", // 12
  "0.928571", // 13
  "1", // 14
  "1.071429", // 15
  "1.142857", // 16
  "1.285714", // 18
  "1.428571", // 20
  "1.571429", // 22
  "1.714286", // 24
  "2", // 28
  "2.571429" // 36
] as const;

const SRC_ROOT = fileURLToPath(new URL("../", import.meta.url));

function styleBearingFiles(): string[] {
  const files: string[] = [];
  for (const dir of ["components", "styles"]) {
    for (const name of readdirSync(`${SRC_ROOT}${dir}`)) {
      if (name.endsWith(".css") || name.endsWith(".vue")) files.push(`${dir}/${name}`);
    }
  }
  files.push("styles.css");
  return files.sort();
}

/** 只认字面数字的 rem 声明；`var(--editor-font-size, 1.071429rem)` 里的兜底也算一处。 */
const REM_FONT_SIZE = /(?:^|[^-\w])font-size\s*:\s*([\d.]+)rem/g;

function remDeclarations(): Array<{ file: string; value: string }> {
  const out: Array<{ file: string; value: string }> = [];
  for (const file of styleBearingFiles()) {
    const src = readFileSync(`${SRC_ROOT}${file}`, "utf8");
    for (const match of src.matchAll(REM_FONT_SIZE)) out.push({ file, value: match[1]! });
  }
  return out;
}

describe("字号阶梯：只许落在十四档整数像素上", () => {
  it("每一档都是 14px 基准下的整数像素，且严格递增", () => {
    const px = FONT_LADDER_REM.map((value) => Number(value) * 14);
    for (const size of px) {
      expect(Math.abs(size - Math.round(size)), `${size}px 不是整数`).toBeLessThan(0.00001);
    }
    for (let index = 1; index < px.length; index += 1) {
      expect(px[index]!).toBeGreaterThan(px[index - 1]!);
    }
    expect(px.map((size) => Math.round(size))).toEqual([
      9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 36
    ]);
  });

  it("样式里不存在阶外字号（半像素、四位小数近似写法都算）", () => {
    const allowed = new Set<string>(FONT_LADDER_REM);
    const offenders = remDeclarations()
      .filter((hit) => !allowed.has(hit.value))
      .map((hit) => `${hit.file}: font-size: ${hit.value}rem`);
    expect(
      [...new Set(offenders)].join("\n"),
      "字号不在阶梯上：半像素在 1.5 倍屏会被取整到 1/3 设备像素，笔画发虚"
    ).toBe("");
  });

  it("普查有鉴别力：能认出旧写法，也不会把 token 定义当成声明", () => {
    expect([..."  font-size: 0.875rem;\n".matchAll(REM_FONT_SIZE)].map((m) => m[1])).toEqual([
      "0.875"
    ]);
    expect([..."--code-font-size: 13px;\n".matchAll(REM_FONT_SIZE)]).toHaveLength(0);
    expect([..."font-size: var(--ui-font-size, 14px);\n".matchAll(REM_FONT_SIZE)]).toHaveLength(0);
  });

  it("锚仍是 px：字号档位由 --ui-font-size 驱动，阶梯只是它的整数倍", () => {
    const root = vueSource("styles.css");
    expect(root).toContain("--ui-font-size: 14px;");
  });
});
