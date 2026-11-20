/**
 * 引导流程的断链（2026-11-20 · 批次①：清剩余死承诺与死链）。
 *
 * 引导是**第一次见面时教人怎么用**的地方，它说错一句，作者就永远找不到那个入口。
 * 这一族钉三件事：
 * ① 品牌名与全局一致（全局叫「墨宸 AI」，引导里写着「深渊写作」＝ 两套产品）；
 * ② 引导指的那枚入口真的存在（第 3 步的「章节」分组、第末步的左栏「?」）；
 * ③ `onboarding.reopen()` 不许是死函数——它必须有一个生产调用方。
 *
 * 读法走 utils/vue-source-reader（模板段剥 HTML 注释、script 段剥 JS 注释）：
 * 否则「这里没有 X」这句话本身写着 X，断言会假绿。
 */
import { describe, expect, it } from "vitest";
import { scriptSource, templateSource, typeScriptSource } from "../utils/vue-source-reader";

const guideScript = scriptSource("components/OnboardingGuide.vue");
const sidebarScript = scriptSource("components/LeftSidebar.vue");
const sidebarTpl = templateSource("components/LeftSidebar.vue");
const helpScript = scriptSource("components/SidebarHelpButton.vue");
const helpTpl = templateSource("components/SidebarHelpButton.vue");
const onboardingStore = typeScriptSource("stores/useOnboardingStore.ts");

describe("引导不许教人去点不存在的东西", () => {
  it("品牌名统一「墨宸 AI」：引导里不许再叫「深渊写作」", () => {
    expect(guideScript).not.toContain("深渊写作");
    expect(guideScript).toContain("墨宸 AI");
  });

  it("第 3 步指向的「章节」分组：开着书时它在树上（判定住 utils，组件不自己写 filter）", () => {
    expect(guideScript).toContain("章节");
    expect(sidebarScript).toContain("manuscriptSections(");
    // 反向：组件里不许留第二份「哪些分组该露」的过滤。
    expect(sidebarScript).not.toContain("BOOK_KIND_ORDER.map(");
  });

  it("末步说的左栏「?」按钮得真的在左栏 footer 里", () => {
    expect(guideScript).toContain("左栏的「?」按钮");
    expect(sidebarTpl).toContain("<SidebarHelpButton />");
    expect(helpTpl).toContain('aria-label="使用引导"');
    expect(helpTpl).toContain("?");
  });

  it("那枚「?」调的是现成的 reopen 真身，不是自己另捏一份引导状态", () => {
    expect(helpScript).toContain("useOnboardingStore");
    expect(helpScript).toContain("onboarding.reopen()");
    expect(onboardingStore).toContain("function reopen(): void");
    // 反向：组件里不许直接改 store 的 state 字段绕开 reopen。
    expect(helpScript).not.toContain("onboarding.state");
  });

  it("reopen 不许是死函数：全仓得有生产调用方（此前只有 store 自己导出，没人调）", () => {
    expect(helpScript).toContain("onboarding.reopen()");
    expect(onboardingStore).toContain("reopen,");
  });
});
