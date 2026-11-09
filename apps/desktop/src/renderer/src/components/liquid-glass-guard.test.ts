/**
 * 液态玻璃材质的三条守卫（2026-11-09）。
 *
 * 这类「质感」最怕三件事，而且三件都不会被 tsc 拦住：
 *  ① **参数散落**：每个组件自己写一份 `backdrop-filter: blur(18px)`，
 *     换一套皮肤就发现有人少改一处，同一块界面上两种玻璃。
 *  ② **越界**：玻璃顺手糊到了正文阅读区——长文压在模糊底上不掉报错，只掉清晰度。
 *  ③ **深色糊字**：白字压在半透明的深玻璃上，背后的亮内容一透上来就不可读。
 *
 * 所以这里量三样：token 只有一处定义、应用点白名单、十六套皮肤 × 两个色调的
 * 文字对比度都过 4.5:1。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { appearanceSkins } from "../composables/appearanceSkins";
import { hexToRgb, mixHex } from "../composables/appearanceColor";
import { isLiquidGlassEnabled, liquidGlassMaterial } from "../composables/appearanceLiquidGlass";
import { contrastRatio } from "../composables/appearanceThemeRuntime";

const SRC = fileURLToPath(new URL("../", import.meta.url));
const css = readFileSync(path.join(SRC, "styles", "liquid-glass.css"), "utf8");
const runtimeSource = readFileSync(
  path.join(SRC, "composables", "appearanceThemeRuntime.ts"),
  "utf8"
);
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, " ");

/** 解析 `rgb(r g b / a)`（本仓 `mixRgba` 的唯一输出形状）。 */
function parseFill(fill: string): { rgb: [number, number, number]; alpha: number } {
  const match = /rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/.exec(fill);
  if (!match) throw new Error(`玻璃底色不是 mixRgba 的形状：${fill}`);
  return {
    rgb: [Number(match[1]), Number(match[2]), Number(match[3])],
    alpha: Number(match[4])
  };
}

/** 把带 alpha 的玻璃底压在某个不透明背景上（模拟「玻璃背后透出来的内容」）。 */
function compositeOver(
  fill: { rgb: [number, number, number]; alpha: number },
  backdropHex: string
): string {
  const backdrop = hexToRgb(backdropHex);
  const channels = fill.rgb.map((channel, index) =>
    Math.round(fill.alpha * channel + (1 - fill.alpha) * backdrop[index]!)
  );
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

describe("液态玻璃 · 参数只有一处定义", () => {
  it("样式表只消费 `--lg-*`，不自己写模糊数值", () => {
    expect(stripped).toContain("backdrop-filter: blur(var(--lg-blur))");
    // 反向钉：文件里不许出现任何「写死的 px 模糊」。
    expect(stripped).not.toMatch(/blur\(\s*\d+(\.\d+)?px\s*\)/);
    expect(stripped).not.toMatch(/saturate\(\s*\d/);
  });

  it("样式表用到的每个 `--lg-*` 都在运行时里有写入", () => {
    const consumed = new Set(
      [...stripped.matchAll(/var\((--lg-[a-z-]+)\)/g)].map((match) => match[1]!)
    );
    expect(consumed.size).toBeGreaterThanOrEqual(8);
    const written = new Set(
      [...runtimeSource.matchAll(/setProperty\("(--lg-[a-z-]+)"/g)].map((match) => match[1]!)
    );
    const missing = [...consumed].filter((name) => !written.has(name));
    expect(missing, `这些 token 样式表在用、运行时没写：${missing.join(", ")}`).toEqual([]);
  });
});

describe("液态玻璃 · 只给浮在内容之上的表面", () => {
  const selectors = [...stripped.matchAll(/^html\[data-liquid-glass="on"\][^{]*\{/gm)].map(
    (match) => match[0]
  );

  it("六类目标表面都覆盖到了", () => {
    const all = selectors.join("\n");
    // 输入卡 / 菜单 / 检查浮层 / 对话框 / 标题带 / 状态提示。
    for (const target of [
      ".composer-input-surface",
      ".review-menu",
      ".review-score",
      ".workspace-dialog",
      ".conversation-header",
      ".toast"
    ]) {
      expect(all, `缺了 ${target}`).toContain(target);
    }
  });

  it("正文阅读区一个都没进白名单", () => {
    const all = selectors.join("\n");
    for (const forbidden of [
      ".message-body",
      ".message-markdown",
      ".message-text",
      ".editor-document",
      ".markdown-body"
    ]) {
      expect(all, `正文区被玻璃化了：${forbidden}`).not.toContain(forbidden);
    }
  });

  it("总闸是 data 属性：关掉时连选择器都不命中", () => {
    // 每一条规则都挂在总闸下面（`@media` 里的那两组也是）。
    expect(stripped).not.toMatch(/^\.(composer-input-surface|review-menu|workspace-dialog)/m);
  });
});

describe("液态玻璃 · 十六套皮肤 × 两个色调的文字对比度", () => {
  it("每套皮肤都能算出一组参数，且文字到玻璃底的对比度 ≥ 4.5:1", () => {
    expect(appearanceSkins.length).toBe(16);
    const failures: string[] = [];

    for (const skin of appearanceSkins) {
      for (const scheme of ["light", "dark"] as const) {
        const tone = skin[scheme];
        const material = liquidGlassMaterial({
          setting: "on",
          glass: skin.glass,
          accent: tone.accent,
          background: tone.background,
          foreground: tone.foreground
        });
        const fill = parseFill(material.fill);

        // 最坏的背板：底色与字色的中间调。玻璃透出的内容越接近它，对比度越低。
        const worstBackdrop = mixHex(tone.background, tone.foreground, 0.5);
        const effective = compositeOver(fill, worstBackdrop);
        const ratio = contrastRatio(tone.foreground, effective);

        if (ratio < 4.5) {
          failures.push(`${skin.id}/${scheme} 只有 ${ratio.toFixed(2)}:1`);
        }
      }
    }

    expect(failures, `深色玻璃掉到可读阈值以下：\n${failures.join("\n")}`).toEqual([]);
  });

  it("深色底的玻璃不透明度单独抬档（≥ 0.78），避免白字糊在浅玻璃上", () => {
    const thin: string[] = [];
    for (const skin of appearanceSkins) {
      for (const scheme of ["light", "dark"] as const) {
        const tone = skin[scheme];
        // 底色比字色深 ⇒ 这一档必须用高不透明度。用亮度差判，不按 scheme：
        // `xi-night` 这类皮肤在浅色模式下底色本来就是深蓝。
        const backgroundIsDeep =
          contrastRatio("#ffffff", tone.background) > contrastRatio("#ffffff", tone.foreground);
        if (!backgroundIsDeep) continue;
        const material = liquidGlassMaterial({
          setting: "on",
          glass: skin.glass,
          accent: tone.accent,
          background: tone.background,
          foreground: tone.foreground
        });
        const { alpha } = parseFill(material.fill);
        if (alpha < 0.78) thin.push(`${skin.id}/${scheme} alpha=${alpha}`);
      }
    }
    expect(thin).toEqual([]);
  });

  it("auto 跟随皮肤：素面皮肤不开、有玻璃档的皮肤开；on/off 直接覆盖", () => {
    expect(isLiquidGlassEnabled("auto", "none")).toBe(false);
    expect(isLiquidGlassEnabled("auto", "standard")).toBe(true);
    expect(isLiquidGlassEnabled("on", "none")).toBe(true);
    expect(isLiquidGlassEnabled("off", "regions")).toBe(false);
  });
});
