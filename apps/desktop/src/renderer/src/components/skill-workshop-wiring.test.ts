import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * 技能工坊三页签的守卫（2026-11-10）。
 *
 * 「网页转技能」是第三条添加通路，与「网上装 / 自己写」并列。这一份只钉**接线形状**：
 * 档位表里三档齐全、page 档提交打的是 webpage.convert（不是误接到 fetch 或 author 的动作）。
 * 数值与判定在 store 与主进程的用例里，这里不重复。
 */

const SFC = readFileSync(path.join(__dirname, "SkillWorkshop.vue"), "utf8");
const STORE = readFileSync(path.join(__dirname, "..", "stores", "useSkillWebpageStore.ts"), "utf8");

describe("技能工坊 · 网页转技能页签", () => {
  /** page 档自己的模板区段：从它的标记到下一档的标记之间。 */
  const PAGE_SECTION = SFC.slice(
    SFC.indexOf("tab === 'page'"),
    SFC.indexOf("<!-- ── 自己写 ── -->")
  );

  it("三档齐全：网页转技能与网上装、自己写并列在档位表里", () => {
    expect(SFC).toContain('TAB_KEYS = ["web", "page", "write"] as const');
    expect(SFC).toContain("网页转技能");
  });

  it("page 档的表单提交打的是 webpage.convert，不是 fetch/author 的动作", () => {
    expect(PAGE_SECTION).toContain("void webpage.convert()");
    // 不许顺手接到别的 store 动作上：三个 store 三个动作，接错就是「点了没反应」。
    // 只查 page 区段——web 档自己的表单接 fetchStore.loadTyped 是合法的。
    expect(PAGE_SECTION).not.toMatch(/@submit\.prevent="void (fetchStore|author)\./);
  });

  it("store 的判定仍只在主进程：convert 只递 trim 后的 URL，成功才刷技能库", () => {
    expect(STORE).toContain("window.mochen.convertWebpageSkill(typed)");
    expect(STORE).toContain("refreshSkills()");
  });
});
