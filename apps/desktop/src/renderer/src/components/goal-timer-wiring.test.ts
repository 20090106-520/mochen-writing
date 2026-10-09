/// <reference types="node" />
/**
 * 写作时长的**接线契约**（2026-10-09 扫描总单「假控件与死路清单」第 1、2 行）。
 *
 * 行为在 `stores/useWritingGoalStore.timer.test.ts`（真跑出来的秒数），这里只钉第三块：
 * **界面与 store 真的接上了**。`.vue` 没有自动化覆盖，只能读源文件——而这一族恰好是
 * 「store 一切就绪、没人调用」造成的恒 0：`startSession`/`endSession` 零调用，
 * 面板底栏永远显示「0 字/分钟 / 今日 0 秒」。行为测试挡不住「接线被删」，所以单独钉：
 *
 * ① App.vue 里有一个盯 `book.draft` 的 watcher，并且它调的就是 `goalStore.activity(`；
 *    少这一根线，时长立刻退回恒 0，而 store 的用例照样全绿。
 * ② 死档不许复活：`startSession`/`endSession` 从 store 里消失（番茄钟 2026-10-05 已整条下线，
 *    界面上没有能调它们的控件）。
 * ③ 「每日时长目标」必须真的上屏：面板模板里有 `secondsWritten` 与 `targetSeconds` 那两枚读数，
 *    而且带 `role="progressbar"`——只存不显示，就是总单判的「半真（设了等于没设）」。
 *
 * 读法一律走 vue-source-reader（剥注释）：本文件与源文件里的注释大量提到这些名字，
 * 不剥注释的「不许出现 X」断言会被自己的说明文字挡成假绿。
 */
import { describe, expect, it } from "vitest";
import { scriptSource, templateSource, typeScriptSource } from "../utils/vue-source-reader";

const appScript = scriptSource("App.vue");
const panelScript = scriptSource("components/WritingGoalPanel.vue");
const panelTpl = templateSource("components/WritingGoalPanel.vue");
const goalStore = typeScriptSource("stores/useWritingGoalStore.ts");

describe("写作时长的接线（恒 0 那两枚统计的来路）", () => {
  it("App.vue 有盯 book.draft 的 watcher，并且调的是 goalStore.activity(", () => {
    expect(appScript).toContain("() => book.draft");
    expect(appScript).toContain("goalStore.activity(");
    // 传的是「当前在写的那一篇 + 此刻」——少了路径，跨文稿的归属就无从谈起。
    expect(appScript).toMatch(/goalStore\.activity\(\s*book\.activeDocTab,\s*Date\.now\(\)\s*\)/);
  });

  it("死档不复活：store 里再没有 startSession / endSession 这两个没人调的接口", () => {
    expect(goalStore).not.toContain("startSession");
    expect(goalStore).not.toContain("endSession");
    expect(goalStore).toContain("function activity");
    // 空闲窗口是唯一一处判定，界面上不许出现第二份「多久算离席」。
    expect(goalStore.match(/IDLE_GAP_MS/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("每日时长目标上屏：面板读 secondsWritten 与 targetSeconds，并带 progressbar 语义", () => {
    expect(panelTpl).toContain("todayProgress.secondsWritten");
    expect(panelTpl).toContain("todayProgress.targetSeconds");
    expect(panelTpl).toContain('role="progressbar"');
    expect(panelTpl).toContain("todayProgress.timePercentage");
    // 没设目标时不许摆「0 / 0 分钟」那种自欺样式。
    expect(panelTpl).toContain("未设目标");
  });

  it("底栏那两枚读数仍从 store 走（不许组件自己攒一份时长）", () => {
    expect(panelScript).toContain("averageSpeed");
    expect(panelScript).toContain("todayDurationSeconds");
    expect(panelTpl).toContain("formatDuration(todayDurationSeconds)");
    // 本地不另起计时器：出现 setInterval 就是第二份时长真身。
    expect(panelScript).not.toContain("setInterval");
  });
});
