import { describe, expect, it } from "vitest";
import {
  ruleBlock,
  scriptSource,
  styleSource,
  templateSource,
  typeScriptSource
} from "../utils/vue-source-reader";

/**
 * P1-3「历史切片在界面上看得见」的接线契约（与 context-meter-wiring.test.ts 同一读法：
 * 本仓零 jsdom，.vue 不进类型程序，只能源码断言钉住）。
 * 核心判据：**一个判据只许一处**——「更早的 N 条」那句话只许住在 utils/history-window.ts，
 * ContextMeter 与 ContextMeterPanel 只挂线，谁都不许自己算 droppedCount。
 */
const meter = scriptSource("components/ContextMeter.vue");
const meterTpl = templateSource("components/ContextMeter.vue");
const panel = scriptSource("components/ContextMeterPanel.vue");
const panelTpl = templateSource("components/ContextMeterPanel.vue");
const util = typeScriptSource("utils/history-window.ts");
const css = styleSource("context-meter.css");

describe("判定住在 util", () => {
  it("「更早的 N 条没有发给模型」那句人话只此一处（util 里）", () => {
    expect(util).toContain("更早的");
    expect(util).toContain("没有发给模型");
    expect(meter).not.toContain("更早的");
    expect(panel).not.toContain("更早的");
    expect(meterTpl).not.toContain("更早的");
    expect(panelTpl).not.toContain("更早的");
  });

  it("面板与折叠态都不许自己碰 droppedCount（数字只有主进程 preview.history 那一份）", () => {
    expect(meter).not.toContain("droppedCount");
    expect(panel).not.toContain("droppedCount");
  });
});

describe("ContextMeter 挂线", () => {
  it("行列表走 appendHistoryRow 包装：历史格的加法只有一个落点", () => {
    expect(meter).toContain(
      "appendHistoryRow(contextMeterRows(agent.contextPreview), agent.contextPreview)"
    );
  });

  it("notice 文案走 historyNoticeText：模板里不现编句子", () => {
    expect(meter).toContain("historyNoticeText(agent.contextPreview)");
    expect(meterTpl).toContain(':history-notice="historyNotice"');
  });
});

describe("ContextMeterPanel 挂线", () => {
  it("props 里有可选的 historyNotice（旧调用不传也合法——契约只加可选件）", () => {
    expect(panel).toContain("historyNotice");
  });

  it("模板把 notice 渲染出来，且空串时不显形（v-if 挂在值上，不另设判据）", () => {
    expect(panelTpl).toContain('v-if="historyNotice"');
    expect(panelTpl).toContain("{{ historyNotice }}");
  });

  it("notice 有真样式（本仓 .vue 不写 style 段，规则必须落在 context-meter.css）", () => {
    expect(ruleBlock(css, ".context-meter-history-notice")).not.toBe("");
  });
});
