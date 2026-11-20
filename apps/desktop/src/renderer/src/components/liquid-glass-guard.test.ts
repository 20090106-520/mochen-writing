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
      ".toast",
      ".model-select",
      ".tool-roster",
      ".context-meter-panel",
      ".composer-context-menu",
      // 2026-11-10 铺开面：素材库浮层、「回到最新」胶囊、技能工坊弹层（向下开，不压 hero）。
      ".material-panel",
      ".scroll-to-bottom",
      ".redeem-sheet",
      // 2026-11-20 材质刀：状态栏原先自带一份写死的 blur(8px)（不归总闸管），
      // 左栏走的是皮肤那层玻璃（当前皮肤是素面档 ⇒ 一块不透明的纸色）。
      // 两处收进总闸之后，一栏之内才只有一种材质。
      ".agent-statusbar",
      ".left-sidebar"
    ]) {
      expect(all, `缺了 ${target}`).toContain(target);
    }
  });

  it("收进白名单的菜单基态不再自带毛玻璃（否则「关」关不干净）", () => {
    // 2026-11-09：这四张菜单原先各写一份 blur(18px)，开关关掉后它们依旧糊着——
    // 同一屏上「关掉的玻璃」和「关不掉的玻璃」并存。基态只留不透明底，玻璃全归总闸。
    const menus: Array<[string, string]> = [
      ["interaction.css", ".model-select"],
      ["interaction.css", ".tool-roster"],
      ["context-meter.css", ".context-meter-panel"],
      ["agent-pane.css", ".composer-context-menu"],
      ["left-nav.css", ".tree-node-action-menu"],
      // 铺开面进玻璃族后，基态同样不许自带毛玻璃（「关」要关得干净）。
      ["material-panel.css", ".material-panel"],
      ["conversation-pane.css", ".scroll-to-bottom"],
      ["skill-redeem.css", ".redeem-sheet"],
      // 2026-11-20 材质刀：状态栏原先自己写了一份 `backdrop-filter: blur(8px)`，
      // 不归总闸管 ⇒ 液态玻璃关掉它照样糊着，而且是第三套模糊数值。
      ["agent-pane.css", ".agent-statusbar"]
    ];
    for (const [file, selector] of menus) {
      const source = readFileSync(path.join(SRC, "styles", file), "utf8").replace(
        /\/\*[\s\S]*?\*\//g,
        " "
      );
      const blocks = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((match) =>
        match[1]!.split(",").some((sel) => sel.trim() === selector)
      );
      expect(blocks.length, `${file} 里找不到 ${selector} 的基规则`).toBeGreaterThan(0);
      for (const block of blocks) {
        expect(
          block[2],
          `${file} 的 ${selector} 基态还自带 backdrop-filter：玻璃开关关不掉它`
        ).not.toContain("backdrop-filter");
      }
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

  it("强开在素面皮肤上也真的给玻璃：不落 `none` 档的占位参数", () => {
    const plain = appearanceSkins.find((skin) => skin.glass === "none");
    expect(plain, "表里至少要有一套素面皮肤，否则这条守卫量不到东西").toBeDefined();
    const tone = plain!.light;
    const material = liquidGlassMaterial({
      setting: "on",
      glass: "none",
      accent: tone.accent,
      background: tone.background,
      foreground: tone.foreground
    });
    expect(material.enabled).toBe(true);
    expect(material.blur).not.toBe("0px");
    expect(parseFill(material.fill).alpha).toBeLessThan(1);
  });
});

describe("液态玻璃 · 浓度档（2026-11-10）", () => {
  const base = {
    setting: "on" as const,
    glass: "standard" as const,
    accent: "#8a6a3a",
    background: "#f6eed4",
    foreground: "#2c2415"
  };

  it("不传 intensity 就是克制档：老调用点一行不改，观感与从前一致", () => {
    const implicit = liquidGlassMaterial(base);
    const calm = liquidGlassMaterial({ ...base, intensity: "calm" });
    expect(implicit).toEqual(calm);
  });

  it("浓郁档五处都往上推：模糊、饱和、光斑、亮带、内缘高光环", () => {
    const calm = liquidGlassMaterial(base);
    const vivid = liquidGlassMaterial({ ...base, intensity: "vivid" });
    expect(parseFloat(vivid.blur)).toBeGreaterThan(parseFloat(calm.blur));
    expect(parseFloat(vivid.blur)).toBeLessThanOrEqual(30);
    expect(Number(vivid.saturate)).toBeGreaterThan(Number(calm.saturate));
    expect(vivid.pointer).not.toBe(calm.pointer);
    expect(vivid.sheen).not.toBe(calm.sheen);
    // 内缘那圈亮边写进 shadow 的 inset 段（depth 一族），浓郁档必须更亮。
    expect(vivid.shadow).not.toBe(calm.shadow);
    expect(vivid.shadow).toMatch(/inset 0 0 0 1px rgb\(255 255 255 \/ 0\.5/);
  });

  it("浓郁档只许「湿」不许「实」：不透明度抬幅有上限，且不越过 0.94", () => {
    for (const skin of appearanceSkins) {
      for (const scheme of ["light", "dark"] as const) {
        const tone = skin[scheme];
        const calmAlpha = parseFill(
          liquidGlassMaterial({
            setting: "on",
            glass: skin.glass,
            accent: tone.accent,
            background: tone.background,
            foreground: tone.foreground
          }).fill
        ).alpha;
        const vividAlpha = parseFill(
          liquidGlassMaterial({
            setting: "on",
            glass: skin.glass,
            intensity: "vivid",
            accent: tone.accent,
            background: tone.background,
            foreground: tone.foreground
          }).fill
        ).alpha;
        expect(
          vividAlpha - calmAlpha,
          `${skin.id}/${scheme} 浓郁档不透明度抬幅超了`
        ).toBeLessThanOrEqual(0.05);
        expect(vividAlpha, `${skin.id}/${scheme} 玻璃变磨砂板了`).toBeLessThan(0.95);
      }
    }
  });

  it("浓郁档的文字对比度同样要过 4.5:1（十六套皮肤 × 两个色调）", () => {
    const failures: string[] = [];
    for (const skin of appearanceSkins) {
      for (const scheme of ["light", "dark"] as const) {
        const tone = skin[scheme];
        const material = liquidGlassMaterial({
          setting: "on",
          glass: skin.glass,
          intensity: "vivid",
          accent: tone.accent,
          background: tone.background,
          foreground: tone.foreground
        });
        const fill = parseFill(material.fill);
        const worstBackdrop = mixHex(tone.background, tone.foreground, 0.5);
        const effective = compositeOver(fill, worstBackdrop);
        const ratio = contrastRatio(tone.foreground, effective);
        if (ratio < 4.5) failures.push(`${skin.id}/${scheme} 只有 ${ratio.toFixed(2)}:1`);
      }
    }
    expect(failures, `浓郁档深色玻璃掉到可读阈值以下：\n${failures.join("\n")}`).toEqual([]);
  });
});

describe("液态玻璃 · 指针高光（2026-11-10）", () => {
  /** 取出某个选择器名下的规则体（本文件的形状：一条规则一个选择器组）。 */
  function blockOf(selector: string): string {
    const index = stripped.indexOf(selector);
    expect(index, `样式表里找不到 ${selector}`).toBeGreaterThan(-1);
    const open = stripped.indexOf("{", index);
    const close = stripped.indexOf("}", open);
    return stripped.slice(open + 1, close);
  }

  it("光斑挂的是伪元素，不往已经管着 sheen 的 background-image 上再叠一层", () => {
    // 叠在同一属性上的话，hover 时得同时写两组位置：改一处漏一处。
    expect(stripped).toContain(".composer-input-surface::after");
    const block = blockOf(".composer-input-surface::after");
    expect(block).toContain("radial-gradient(");
    expect(block).toContain("var(--lg-pointer)");
    expect(block).toContain("pointer-events: none");
  });

  it("光斑压在文字之下（层级表 --z-under），且不吃点击", () => {
    // 光扫过正文时把字洗淡是「质感」类改动最容易付的代价；`pointer-events: none`
    // 少一条，整张输入卡就点不进 textarea。
    const block = blockOf(".composer-input-surface::after");
    expect(block).toMatch(/z-index:\s*var\(--z-under\)/);
    expect(block).toContain("pointer-events: none");
  });

  it("静置时不可见：常态 opacity 0，hover / 聚焦才淡入", () => {
    expect(blockOf(".composer-input-surface::after")).toMatch(/opacity:\s*0/);
    expect(stripped).toContain(".composer-input-surface:hover::after");
  });

  it("两个圆心变量由运行时给默认值（`var()` 落空会让整条 background 失效）", () => {
    for (const token of ["--lg-pointer", "--lg-pointer-x", "--lg-pointer-y"]) {
      expect(runtimeSource, `运行时没写 ${token}`).toContain(`setProperty("${token}"`);
    }
    // 圆心必须在消费处求值：写进根上的 token 会被烤成静置值（真机撞过）。
    expect(blockOf(".composer-input-surface::after")).toContain("at var(--lg-pointer-x)");
    const material = liquidGlassMaterial({
      setting: "on",
      glass: "standard",
      accent: "#8a6a3a",
      background: "#f6eed4",
      foreground: "#2c2415"
    });
    expect(material.pointer).not.toContain("var(");
    // 色标以「零透明度」收尾（浅色档是冷调白，深色档是纯白）：不写 `transparent` 关键字，
    // 因为中间两档带着色相，收尾那一档必须与它同色系才不会在边缘收出一圈灰。
    expect(material.pointer).toMatch(/\/ 0\) \d+%$/);
  });

  it("按下收一档阴影，但不用 transform（卡里正在打字的那一行不能跟着跳）", () => {
    const block = blockOf(".composer-input-surface:active");
    expect(block).toContain("box-shadow: var(--lg-shadow-press)");
    expect(block).not.toContain("transform");
  });
});
