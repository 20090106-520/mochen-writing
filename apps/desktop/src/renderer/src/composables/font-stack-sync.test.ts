import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APPEARANCE_UI_FONT_STACKS } from "@mochen/contracts";

/** 仓库里 UI 字体栈的三处真身。字体精致化（2026-11-10）之后它们必须逐字一致：
 *  漂了的首帧兜底（styles.css :root）会让主题就绪前闪一次字体。 */
const RENDERER_SRC = path.resolve(__dirname, "..");
const stylesCss = readFileSync(path.join(RENDERER_SRC, "styles.css"), "utf8");
const fontsCss = readFileSync(path.join(RENDERER_SRC, "styles/fonts.css"), "utf8");

/** 把一条栈压成可比较的形状：去空白、引号统一成双引号。 */
const normalize = (stack: string): string => stack.replace(/\s+/g, "").replace(/'/g, '"');

describe("UI 字体栈 · 三处真身同步", () => {
  it("contracts 的 system 栈以打包的 Inter 打头——首位不再是没装就死的空条目", () => {
    expect(APPEARANCE_UI_FONT_STACKS.system.startsWith("Inter,")).toBe(true);
    // CJK 优先落 Noto（本机装了 VF，100–900 全真身），没有才落雅黑 UI 版。
    expect(APPEARANCE_UI_FONT_STACKS.system).toContain('"Noto Sans SC"');
    expect(APPEARANCE_UI_FONT_STACKS.system.indexOf('"Noto Sans SC"')).toBeLessThan(
      APPEARANCE_UI_FONT_STACKS.system.indexOf('"Microsoft YaHei UI"')
    );
  });

  it("styles.css 的 --ui-font 首帧兜底与 contracts 逐字一致", () => {
    const declared = stylesCss.match(/--ui-font:\s*([^;]+);/);
    const declaredStack = declared?.[1];
    expect(declaredStack, "styles.css 里必须还有 --ui-font 这一条").toBeTypeOf("string");
    expect(normalize(declaredStack as string)).toBe(normalize(APPEARANCE_UI_FONT_STACKS.system));
  });

  it("styles.css :root 的 font-family 兜底链与 contracts 同步（':root 括号里的那份'）", () => {
    // :root 里 font-family: var(--ui-font, <兜底链>) —— 把兜底链抠出来比。
    const block = stylesCss.match(/:root\s*\{[\s\S]*?\n\}/)![0];
    const fallback = block.match(/font-family:\s*var\(\s*--ui-font,\s*([\s\S]*?)\)/);
    const chainMatch = fallback?.[1];
    expect(chainMatch, ":root 的 font-family 兜底链必须存在").toBeTypeOf("string");
    const chain = (chainMatch as string).replace(/[\r\n]+/g, " ");
    expect(normalize(chain)).toBe(normalize(APPEARANCE_UI_FONT_STACKS.system));
  });

  it("Inter 可变字体已打包且声明覆盖 100–900 全字重", () => {
    expect(fontsCss).toContain("InterVariable.woff2");
    expect(fontsCss).toMatch(/font-weight:\s*100\s+900/);
    // 字体文件本体在资产目录里——声明写了、文件丢了，打包后就是静默回落。
    expect(() =>
      readFileSync(path.join(RENDERER_SRC, "assets/fonts/InterVariable.woff2"))
    ).not.toThrow();
  });
});
