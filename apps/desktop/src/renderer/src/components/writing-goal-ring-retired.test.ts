/**
 * 顶栏那枚「0% 写作目标环」退役（2026-10-07 用户裁定）。
 *
 * 【为什么单开一个文件】这一批同时动了三处（圆环退役 / 工具卡改人话 / 模型切下拉），
 * 三处的守则是各自独立的：这一份只答一个问题——**那枚圆环没了，而写作目标功能没跟着没**。
 *
 * 【钉的是什么，不是删掉什么】
 * 本仓吃过太多次「顺手把一个面板删干净」，然后由 `dead-panel-entry.test.ts` 事后补写导入。
 * 所以这里钉的是**正面的两半**：
 *   ① 圆环确实不在了（含它的 import、它的 openGoal 事件、App 里那条监听——三者同退，
 *      留任何一条都是零写者的死接线，而零写者在本仓的典型症状是「面板从来没打开过」）；
 *   ② 面板本体、可见性开关、以及**唯一的真写者**（Ctrl+Shift+G → panelShortcut("goals")）都还在。
 * 只钉 ① 会把「连面板一起删掉」判成绿；只钉 ② 则挡不住「留一枚用户不想要的 0% 圆环」。
 */
import { describe, expect, it } from "vitest";
import {
  scriptSource,
  templateSource,
  typeScriptSource,
  vueSource
} from "../utils/vue-source-reader";

const CENTER = "components/CenterColumn.vue";
const APP = "App.vue";

describe("圆环退役 · 反着钉的那一半", () => {
  it("中栏不再 import / 渲染它，openGoal 事件与 App 的监听同退", () => {
    // scriptSource / templateSource 都已剥注释：写在注释里的「它已经退役了」喂不饱这两条。
    expect(scriptSource(CENTER)).not.toContain("WritingGoalRing");
    expect(templateSource(CENTER)).not.toContain("WritingGoalRing");
    // 事件名两头一起退：emit 侧没了 openGoal，App 侧就不能还挂着 @open-goal。
    expect(scriptSource(CENTER)).not.toContain("openGoal");
    expect(templateSource(APP)).not.toContain("open-goal");
  });

  it("组件文件本身也删干净了（不是留着没人引用的孤儿）", () => {
    // 留着它不会有编译错，只会让下一个读代码的人以为还有第二处入口。
    expect(() => vueSource("components/WritingGoalRing.vue")).toThrow();
  });
});

describe("圆环退役 · 正着钉的那一半：功能不许跟着没", () => {
  it("面板仍挂在 App 上，可见性开关仍在，且真写者只有一个（快捷键）", () => {
    expect(scriptSource(APP)).toContain(
      'import WritingGoalPanel from "./components/WritingGoalPanel.vue"'
    );
    expect(templateSource(APP)).toContain("<WritingGoalPanel");
    expect(templateSource(APP)).toContain(':visible="goalPanelOpen"');
    expect(scriptSource(APP)).toContain("const goalPanelOpen = ref(false);");
    // 真写者。少了这一格，开关就只剩一个从不被置 true 的本地 ref——本仓的老坑（App.vue:94 那段注释）。
    expect(scriptSource(APP)).toContain('case "goals":');
    expect(scriptSource(APP)).toContain("goalPanelOpen.value = !goalPanelOpen.value;");
    // 键位判定住 utils/hotkeys.ts 的那张表（PANEL_KEYS 未导出，这里读源；Ctrl+Shift+G 是那一行的 g）。
    expect(typeScriptSource("utils/hotkeys.ts")).toContain('g: "goals"');
  });
});
