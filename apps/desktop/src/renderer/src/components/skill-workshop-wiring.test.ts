import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ruleBlock, styleSource } from "../utils/vue-source-reader";

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

/* ─────────────────────────────────────────────────────────────────────────
   两条添加通路并排一行（2026-11-12）

   真机量到：`.redeem-block` 原先两块各占 **39px** 竖着摞（合计 78px），
   技能卡网格被推到 y=266。可它们是**平级的两个入口**（找现成的 / 兑一段码），
   不是先后两步——竖排读起来像「先做这个，再做那个」。
   并成一行后整行 39px，网格回到 227（902px 高的窗口里多出一行卡的位置）。

   这里钉「别退回竖排」的四件事，钉的都是会**悄悄**退化的：
   ① 行容器真包住两块（少包一块 = 两块又竖着摞，而单看模板每一块都还在）；
   ② 行容器真是 flex 行且允许折行（窄窗口下两块要能各自独占一行，不是压成两半）；
   ③ 两块仍自带 `position: relative`——两张浮层的锚点就在这条规则里，
      谁为了「让行容器统一定位」把它挪走，两张卡就会一起跑到页首去；
   ④ 箭头 90°：180° 的收尾是「◂」，读起来像返回上一页。
   */
describe("技能库 · 两条添加通路并排一行", () => {
  const PAGE = readFileSync(path.join(__dirname, "ExtensionsPage.vue"), "utf8");
  const CSS = styleSource("skill-redeem.css");
  /** 行容器那一段：从它自己的标记到缩进 4 的收尾（内层都在 6 以上，不会先撞上）。 */
  const ROW =
    /<div v-if="isSkills" class="skill-entry-row">([\s\S]*?)\n {4}<\/div>/m.exec(PAGE)?.[1] ?? "";

  it("行容器同时包住「从网上装 / 自己写」与「兑换 / 自制技能」", () => {
    expect(ROW, "找不到 .skill-entry-row 那一段").not.toBe("");
    expect(ROW).toContain("<SkillWorkshop />");
    expect(ROW).toContain('class="redeem-block"');
  });

  it("行容器是一条会折行的 flex 行", () => {
    const row = ruleBlock(CSS, ".skill-entry-row");
    expect(row).toContain("display: flex");
    expect(row).toContain("flex-wrap: wrap");
    expect(row).toContain("gap: 8px");
  });

  it("两块各自仍是定位上下文（浮层锚点不许被挪到行容器上）", () => {
    expect(ruleBlock(CSS, ".redeem-block")).toContain("position: relative");
  });

  it("展开时箭头转 90°，不是 180°", () => {
    const open = ruleBlock(CSS, ".redeem-trigger.is-open .redeem-trigger-caret");
    expect(open).toContain("rotate(90deg)");
    expect(open, "180° 收尾是「◂」，那是一个返回箭头").not.toContain("rotate(180deg)");
  });

  it("浮层是定宽，不许再用百分比（行容器里 100% 会缩成触发钮那么宽）", () => {
    const sheet = ruleBlock(CSS, ".redeem-sheet");
    expect(sheet).toContain("width: 430px");
    expect(sheet, "`min(430px, 100%)` 在横向 flex 里会算成 139px").not.toContain(
      "width: min(430px, 100%)"
    );
  });
});
