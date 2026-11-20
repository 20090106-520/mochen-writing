/// <reference types="node" />
/**
 * 圆角阶梯（2026-11-11）。
 *
 * 【病灶】全仓 border-radius 原先有十八种取值：2 / 3 / 4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 /
 * 12 / 13 / 14 / 15 / 16 / 18 / 21 / 999。7 与 8 混排、9 与 10 混排、13 与 12 混排 ——
 * 单看每一处都「差不多」，并排就露馅：同一种按钮在不同面板里圆角差 1px。
 * 1.5 倍屏上 7px 与 8px 只差 1.5 个设备像素，肉眼说不出哪里不对，只觉得「不齐」。
 *
 * 【裁定】只有八档 + 胶囊 + 圆形：
 * 0（直角）/ 2（发丝标记）/ 4（小徽标）/ 6（行内块）/ 8（按钮、输入框、行）/
 * 10（小浮层）/ 12（菜单、卡片）/ 16（面板、对话框）/ 20（大卡片）/ 999（胶囊）/ 50%（圆）。
 * 复合圆角（气泡那种 `6px 16px 16px 16px`）逐个 token 判，同样只许落在这些档上。
 * `var(--skin-radius-*)` / `var(--radius-panel)` 这类皮肤变量整值放行——它们的真身在别处钉。
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

export const RADIUS_STEPS = [
  "0",
  "2px",
  "4px",
  "6px",
  "8px",
  "10px",
  "12px",
  "16px",
  "20px",
  "999px",
  "50%"
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

const RADIUS_DECL = /(?:^|[^-\w])border-radius\s*:\s*([^;{}]+);/g;

function declarations(): Array<{ file: string; value: string }> {
  const out: Array<{ file: string; value: string }> = [];
  for (const file of styleBearingFiles()) {
    const src = readFileSync(`${SRC_ROOT}${file}`, "utf8");
    for (const match of src.matchAll(RADIUS_DECL)) out.push({ file, value: match[1]!.trim() });
  }
  return out;
}

describe("圆角阶梯：只许八档 + 胶囊 + 圆形", () => {
  it("阶梯本身按从小到大排，且没有近似重复档", () => {
    // 0 是直角档，不带宽高单位；999 / 50% 是胶囊与圆形，不参与线性递增。
    const px = RADIUS_STEPS.filter((v) => v !== "999px" && v !== "50%").map((v) =>
      Number(v.replace("px", ""))
    );
    expect(px).toEqual([0, 2, 4, 6, 8, 10, 12, 16, 20]);
    for (let i = 1; i < px.length; i += 1) expect(px[i]!).toBeGreaterThan(px[i - 1]!);
  });

  it("样式里不存在阶外圆角（7 / 9 / 11 / 13 / 14 / 15 / 18 / 21 全部归并）", () => {
    const allowed = new Set<string>(RADIUS_STEPS);
    const offenders: string[] = [];
    for (const { file, value } of declarations()) {
      // 整值是皮肤变量：真身由皮肤表钉，这里不重复判。
      if (value.startsWith("var(") && !value.includes(" ")) continue;
      if (value === "inherit") continue;
      for (const token of value.split(/\s+/).filter(Boolean)) {
        if (token.startsWith("var(")) continue;
        if (!allowed.has(token)) offenders.push(`${file}: border-radius: ${value}`);
      }
    }
    expect(
      [...new Set(offenders)].join("\n"),
      "圆角不在阶梯上：差 1px 的两档并排时肉眼说不出哪里不对，只觉得不齐"
    ).toBe("");
  });

  it("普查有鉴别力：复合圆角逐个 token 判，变量整值放行", () => {
    expect([..."  border-radius: 7px;\n".matchAll(RADIUS_DECL)].map((m) => m[1]!.trim())).toEqual([
      "7px"
    ]);
    expect([..."  border-radius: 6px 16px 16px 16px;\n".matchAll(RADIUS_DECL)]).toHaveLength(1);
    expect([..."  border-radius: var(--radius-panel);\n".matchAll(RADIUS_DECL)]).toHaveLength(1);
  });

  it("面板那一档的兜底仍是 16px（默认皮肤下界面一字不变），源头是皮肤的 lg 那一档", () => {
    const root = readFileSync(`${SRC_ROOT}styles.css`, "utf8");
    // 【2026-11-20 · 批次②】原先是 `--radius-panel: 16px;`（写死），于是换「直角」皮肤时
    // 工作区里的面板与对话框不动——只改了皮肤广场的预览。改成以皮肤 token 为源之后，
    // 兜底值必须逐字不变（plain 皮肤的 lg 就是 16px），否则默认皮肤下凭空变形。
    expect(root).toContain("--radius-panel: var(--skin-radius-lg, 16px);");
    expect(root).toContain("--radius-card: var(--skin-radius-md, 10px);");
    expect(root).toContain("--radius-control: var(--skin-radius-control, 8px);");
  });
});
