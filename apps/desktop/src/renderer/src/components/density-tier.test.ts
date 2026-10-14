/// <reference types="node" />
/**
 * 界面密度档的对表闸（2026-10-15 Wave 3）。
 *
 * 这一刀的全部风险都落在**「不显形」**这一族上：CSS 里写了规则、属性名也对、
 * 但顺序或特异性不对 ⇒ 屏幕上一点变化都没有，而界面也不会报错。
 * 所以这里钉的不是「density.css 存在」，而是四条能各自失败的判据：
 * ① 每一条紧凑规则的**选择器在基样式里真的找得到**，且它改的那条属性基规则里也真写着；
 * ② 每一条的**值和基值不一样**——拦的是「抄了一行等于没抄」的空转规则；
 * ③ `density.css` 排在 `styles.css` 全部 @import 的**最后**（同特异性只由先后裁决）；
 * ④ 属性名与档位名和运行时/契约同源（`data-density` / `compact`），
 *    两边写岔一个字母就是「设置存得下来、界面永远不动」。
 *
 * 另加两条反向闸（明确不许碰的两族）：栅格轨道与阅读栏宽度——
 * 前者会把 macOS 那四行栏头顶成 Windows 的七行（同特异性，见 density.css 抬头第 ③ 条），
 * 后者「写作」页已经有档（`--editor-measure`），再写一遍就是两份真相。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { APPEARANCE_DENSITIES, DEFAULT_APPEARANCE_DENSITY } from "@mochen/contracts";

const SRC = fileURLToPath(new URL("../", import.meta.url));
const STYLES = path.join(SRC, "styles");
const GATE = 'html[data-density="compact"]';

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, " ");

interface Rule {
  selectors: string[];
  declarations: Map<string, string>;
}

/** 粗解析：只认「选择器块 + 分号分隔的声明」，本仓样式表没有嵌套预处理语法。 */
function parseRules(css: string): Rule[] {
  const out: Rule[] = [];
  for (const match of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1]!
      .split(",")
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter((s) => s.length > 0 && !s.startsWith("@"));
    const declarations = new Map<string, string>();
    for (const decl of match[2]!.split(";")) {
      const [prop, ...rest] = decl.split(":");
      const value = rest.join(":").replace(/\s+/g, " ").trim();
      if (prop && value) declarations.set(prop.trim(), value);
    }
    if (selectors.length > 0 && declarations.size > 0) out.push({ selectors, declarations });
  }
  return out;
}

const densityCssPath = path.join(STYLES, "density.css");
const densitySource = fs.readFileSync(densityCssPath, "utf8");
const densityRules = parseRules(densitySource).flatMap((rule) =>
  rule.selectors
    .filter((selector) => selector.startsWith(GATE))
    .map((selector) => ({
      base: selector.slice(GATE.length).trim(),
      declarations: rule.declarations
    }))
);

/** 基样式 = styles/ 下除 density.css 之外的全部（紧凑档不许自己给自己当基线）。 */
const baseRules = fs
  .readdirSync(STYLES)
  .filter((name) => name.endsWith(".css") && name !== "density.css")
  .flatMap((name) => parseRules(fs.readFileSync(path.join(STYLES, name), "utf8")));

function baseValues(selector: string, property: string): string[] {
  const found: string[] = [];
  for (const rule of baseRules) {
    if (!rule.selectors.includes(selector)) continue;
    const value = rule.declarations.get(property);
    if (value !== undefined) found.push(value);
  }
  return [...new Set(found)];
}

describe("密度档 · 每一条都对着基规则", () => {
  it('至少有一条紧凑规则，而且都带着 html[data-density="compact"] 那条总闸', () => {
    expect(densityRules.length).toBeGreaterThan(0);
    // 没有裸选择器：每条规则都得从总闸后面出来，否则标准档会被永久压住。
    const stripped = stripComments(densitySource);
    for (const match of stripped.matchAll(/([^{}]+)\{/g)) {
      for (const selector of match[1]!.split(",")) {
        const text = selector.replace(/\s+/g, " ").trim();
        if (text.length === 0 || text.startsWith("@")) continue;
        expect(text.startsWith(GATE), `这条没挂总闸：${text}`).toBe(true);
      }
    }
  });

  it("选择器与属性都能在基样式里找到（不存在「压在一个压根没有的规则上」）", () => {
    for (const rule of densityRules) {
      for (const property of rule.declarations.keys()) {
        const values = baseValues(rule.base, property);
        expect(values.length, `${rule.base} 的 ${property} 在基样式里根本没有`).toBeGreaterThan(0);
      }
    }
  });

  it("每一条的值都和基值不同（拦「抄了一行等于没抄」），且基值只有一种口径", () => {
    for (const rule of densityRules) {
      for (const [property, compact] of rule.declarations) {
        const values = baseValues(rule.base, property);
        expect(
          values.length,
          `${rule.base} 的 ${property} 基值有分歧：${values.join(" / ")}——两处各写一份时先收口再压档`
        ).toBe(1);
        expect(compact, `${rule.base} 的 ${property} 与基值相同=${compact}`).not.toBe(values[0]);
      }
    }
  });

  it("紧凑一律不比基线松：降档的方向只能是变小", () => {
    // 判据取每条规则第一个长度值；`clamp()` 取它的中间一档。
    const lengthOf = (value: string): number | null => {
      const px = /^(\d+(?:\.\d+)?)px$/.exec(value.trim());
      if (px) return Number(px[1]);
      const clamp = /^clamp\([^,]+,\s*(\d+(?:\.\d+)?)px[^)]*\)$/.exec(value.trim());
      if (clamp) return Number(clamp[1]);
      return null;
    };
    for (const rule of densityRules) {
      for (const [property, compact] of rule.declarations) {
        const base = baseValues(rule.base, property)[0]!;
        const got = lengthOf(compact);
        const was = lengthOf(base);
        if (got === null || was === null) continue;
        expect(
          got,
          `${rule.base} 的 ${property}：基值 ${base} 而紧凑值 ${compact}——这一条是加高不是收紧`
        ).toBeLessThanOrEqual(was);
      }
    }
  });
});

describe("密度档 · 生效通路两头对得上", () => {
  const runtime = fs.readFileSync(path.join(SRC, "composables/appearanceThemeRuntime.ts"), "utf8");
  const stylesCss = fs.readFileSync(path.join(SRC, "styles.css"), "utf8");

  it("契约里除出厂值那一档，就是 CSS 总闸认的那一档", () => {
    const nonDefault = APPEARANCE_DENSITIES.filter((tier) => tier !== DEFAULT_APPEARANCE_DENSITY);
    expect(nonDefault).toEqual(["compact"]);
    expect(densitySource).toContain(`data-density="${nonDefault[0]}"`);
  });

  it("运行时写的是 dataset.density，值来自设置而不是本地常量", () => {
    expect(runtime).toContain("root.dataset.density = input.density;");
    // 漏了这一行 = 设置存进盘、CSS 永远不显形，而屏幕上完全看不出来。
    expect(/dataset\.density/.test(runtime)).toBe(true);
    // 【这一条拦不住的那一类，由 appearance-density-runtime.test.ts 拦】
    // 变异实测（2026-10-15）：把那一行**注释掉**（`// root.dataset.density = ...`）时，
    // 上面两条子串判据照样全绿——子串只认「字在不在」，不认「跑不跑」。
    // 所以同一条通路必须有一份真执行一遍的用例，两道闸各管各的盲区。
  });

  it("装配那一头递的是 settings 里的密度，不是又写死一枚出厂值", () => {
    // 只钉「有这一行」拦不住 `density: "standard"`：设置存得下、界面永远不动，
    // 而全仓三条闸（契约 / CSS / 外观页）照样全绿。所以钉的是**读的是 view.density**。
    const app = fs.readFileSync(path.join(SRC, "App.vue"), "utf8");
    expect(app).toContain("density: view.density");
    expect(app).not.toMatch(/density:\s*"(standard|compact)"/);
  });

  it("density.css 排在 styles.css 全部 @import 的最后一条", () => {
    const imports = [...stylesCss.matchAll(/@import\s+"([^"]+)";/g)].map((m) => m[1]!);
    expect(imports.at(-1)).toBe("./styles/density.css");
    expect(imports.filter((p) => p.endsWith("density.css")).length).toBe(1);
  });

  it("外观页摆的是同一份档位：两档都上屏、走的是 appearance.update", () => {
    const panel = fs.readFileSync(path.join(SRC, "components/AppearancePanel.vue"), "utf8");
    for (const tier of APPEARANCE_DENSITIES) {
      expect(panel, `档位 ${tier} 在界面上没有落点`).toContain(`value: "${tier}"`);
    }
    expect(panel).toContain("appearance.update({ density })");
    expect(panel).toContain('aria-label="界面密度"');
  });
});

describe("密度档 · 两族明确不碰", () => {
  // 判据只看**规则**，不看注释：density.css 的抬头必须能写下「这两族为什么不搬」，
  // 拿字面量禁掉那句话等于逼着把理由删掉。
  const densityRulesOnly = stripComments(densitySource);

  it("不写 grid-template-rows：那会和 data-platform 那几档同特异性打架", () => {
    expect(densityRulesOnly).not.toContain("grid-template-rows");
    expect(densityRulesOnly).not.toContain(".editor-pane");
    expect(densityRulesOnly).not.toContain(".desktop-shell");
  });

  it("不碰正文版式与阅读栏宽度（--editor-* 归写作页，栏宽归列宽档）", () => {
    for (const token of ["--editor-leading", "--editor-font-size", "--editor-measure"]) {
      expect(densityRulesOnly, `密度档里出现了 ${token}`).not.toContain(token);
    }
    // 这几条选择器整族不许出现：它们的宽窄就是版式那几档的地盘。
    for (const selector of [
      ".document-editor",
      ".document-title-input",
      ".composer-wrap",
      ".document-preview"
    ]) {
      expect(densityRulesOnly, `密度档压到了 ${selector}`).not.toContain(selector);
    }
    // `.message-list` 只许动上下留白：那一族的 width 有两条基规则（窄窗 @media 里还有一条），
    // 密度档伸进去就等于和「正文宽度」那三档抢同一个刻度。
    for (const rule of densityRules.filter((r) => r.base === ".message-list")) {
      for (const property of rule.declarations.keys()) {
        expect(property, `.message-list 上多改了 ${property}`).toBe("padding");
      }
    }
  });
});
