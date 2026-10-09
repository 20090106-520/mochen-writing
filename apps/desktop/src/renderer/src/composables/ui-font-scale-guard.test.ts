import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ruleBlock, scopedStyleSource, vueSource } from "../utils/vue-source-reader";

/**
 * 界面字号必须真的随设置缩放（2026-10-09 扫描总单：面板里成片写死 `font-size: Npx`）。
 *
 * 机制是这样的：`styles.css` 的 `:root { font-size: var(--ui-font-size, 14px) }` 是唯一的锚，
 * 外观页把用户的字号档位写进 `--ui-font-size`（`appearanceThemeRuntime.ts` 那句
 * `setProperty("--ui-font-size", `${theme.uiFontSize}px`)`）。所以**只有 rem 会跟着缩放**，
 * 写成 px 的声明等于对着设置说不。
 *
 * 这一族原先散在 25 个文件、251 处，改一处没人会发现别的又漏了——所以守卫做全仓普查：
 * 渲染层任何 `.css` / `.vue` 里出现字面 px 的 `font-size` 声明即为红。
 * 两个例外是锚本身，它们在 `styles.css` 里必须保持 px，第三条用例专门钉住不许"顺手也转成 rem"。
 */

/** 字面 px 的 font-size 声明。前面不许是 `-`：`--ui-font-size: 14px` 是 token 定义，不是声明。 */
const PX_FONT_SIZE = /([^-\w])font-size\s*:\s*[\d.]+px\b/g;

const SRC_ROOT = fileURLToPath(new URL("../", import.meta.url));

/** 渲染层所有样式载体：散装 css、SFC 内联样式，以及 `styles.css` 本体。 */
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

function pxDeclarations(file: string): string[] {
  const src = readFileSync(`${SRC_ROOT}${file}`, "utf8");
  const hits: string[] = [];
  for (const match of src.matchAll(PX_FONT_SIZE)) hits.push(match[0].trim());
  return hits;
}

describe("界面字号：只有 rem 会随 --ui-font-size 缩放", () => {
  it("渲染层的样式里不再有任何字面 px 的 font-size 声明", () => {
    const offenders = styleBearingFiles()
      .map((file) => ({ file, hits: pxDeclarations(file) }))
      .filter((o) => o.hits.length > 0);
    expect(
      offenders.map((o) => `${o.file}: ${o.hits.join(" / ")}`).join("\n"),
      "写死 px 的 font-size 让字号设置对界面不生效"
    ).toBe("");
  });

  it("普查本身有鉴别力：能认出 px 写法，也能把 token 定义留在例外里", () => {
    expect(pxDeclarations("styles.css")).toEqual([]);
    // 同一处写法喂给正则必须命中——否则"零违规"只是因为正则根本不认这种声明。
    expect([...`  font-size: 12px;\n`.matchAll(PX_FONT_SIZE)]).toHaveLength(1);
    expect([...`--code-font-size: 13px;\n`.matchAll(PX_FONT_SIZE)]).toHaveLength(0);
    expect([...`font-size: var(--ui-font-size, 14px);\n`.matchAll(PX_FONT_SIZE)]).toHaveLength(0);
  });

  it("锚不能被转走：--ui-font-size 与 :root 的 font-size 仍是 px", () => {
    const root = vueSource("styles.css");
    expect(root).toContain("--ui-font-size: 14px;");
    expect(root).toContain("font-size: var(--ui-font-size, 14px);");
    // 运行时那句也是同一口径：设置落进去的必须还是 px，否则 rem 没有参照。
    const runtime = readFileSync(`${SRC_ROOT}composables/appearanceThemeRuntime.ts`, "utf8");
    expect(runtime).toContain('setProperty("--ui-font-size"');
  });

  it("换算按 N/14 取六位小数：12px 那一档在故事圣经里就是 0.857143rem", () => {
    const css = vueSource("components/story-bible-panel.css");
    expect(ruleBlock(css, ".type-chip")).toContain("font-size: 0.857143rem");
    // 面板标题那一档（13px→0.928571rem）与最小注脚（11px→0.785714rem）各自对上
    expect(css).toContain("font-size: 0.928571rem");
    expect(css).toContain("font-size: 0.785714rem");
  });

  it("笔记与大纲这两个重灾区里，最小的那几档都换算到了 rem", () => {
    const notes = scopedStyleSource("components/NotesPanel.vue");
    expect(ruleBlock(notes, ".notes-search-input")).toContain("font-size:");
    expect(notes).toContain("rem");
    const outline = vueSource("styles/outline.css");
    expect(outline).toContain("rem");
    expect([...outline.matchAll(PX_FONT_SIZE)]).toHaveLength(0);
    expect([...notes.matchAll(PX_FONT_SIZE)]).toHaveLength(0);
  });
});
