import { describe, expect, it } from "vitest";
import {
  countNeedle,
  ruleBlock,
  scriptSource,
  styleSource,
  templateSource,
  typeScriptSource,
  vueSource
} from "../utils/vue-source-reader";

/**
 * 上下文占用条的**接线契约**。`.vue` 与 .css 都不进类型程序，只能靠源码断言钉住
 * （本仓零 jsdom / @vue/test-utils，见 utils/vue-source-reader.ts 开头）。
 * 读法全部走 vue-source-reader：模板段剥 HTML 注释、script 段剥 JS 注释——
 * 否则「这里没有 X」这句话本身写着 X，断言会假绿。
 */
const meter = scriptSource("components/ContextMeter.vue");
const meterTpl = templateSource("components/ContextMeter.vue");
const panel = scriptSource("components/ContextMeterPanel.vue");
const panelTpl = templateSource("components/ContextMeterPanel.vue");
const bar = scriptSource("components/ComposerContextBar.vue");
const barTpl = templateSource("components/ComposerContextBar.vue");
const meterUtil = typeScriptSource("utils/context-meter.ts");
const agentStore = typeScriptSource("stores/useAgentStore.ts");
const css = styleSource("context-meter.css");

describe("折叠态那枚钮", () => {
  it("真身是 agent:context-preview：store 里那一条通路确实存在且会落到窗口的 mochen 上", () => {
    // 【2026-10-07 改钉新形状】原来逐字钉 `contextPreview(query)`。
    // 出网前那份 pinned 必须摊平（响应式 Proxy 过不了 contextBridge 那道门），
    // 于是实参变成了 `{ ...query, pinned: plainList(query.pinned ?? []) }`。
    // 这次钉的**不是新写法**，是原来那条判定的全部内容，且更严：
    // ① 仍落到 window.mochen 上（没改成别的通道）；
    // ② 结果仍落回 this.contextPreview（没改成只发不管）；
    // ③ 新增：query 是**展开递进去**的，不是一个字段一个字段重抄——
    //    重抄那份迟早会漏掉新加的字段，而契约是加字段的。
    expect(agentStore).toContain("window.mochen.contextPreview({");
    expect(agentStore).toContain("this.contextPreview = await window.mochen.contextPreview({");
    expect(agentStore).toContain("...query");
    expect(agentStore).toContain("pinned: plainList(query.pinned ?? [])");
  });

  it("组件只调 utils 的四个纯函数，不自己数条目、不自己取整（判定下沉）", () => {
    expect(meter).toContain("contextMeterSummary(agent.contextPreview)");
    expect(meter).toContain("contextMeterRows(agent.contextPreview)");
    expect(meter).toContain("contextMeterQuery(source.value)");
    expect(meter).toContain("contextMeterQueryKey(source.value)");
  });

  it("模板里不许出现第二份显示口径：没有内联的 items.length / toFixed / slice", () => {
    expect(meterTpl).not.toContain("items.length");
    expect(meterTpl).not.toContain("toFixed");
    expect(meterTpl).not.toContain(".slice(");
  });

  it("总账合并只许住在 util：组件一个 token 数都不碰，util 确实读了 preview.history", () => {
    // 清单第 1 项的守护：把「装配 + 历史」的加法写进 .vue 就等于第二套口径（铁律 6），
    // 而 util 若不读 preview.history，chip 上就还是那个不含历史的假总账。
    expect(meter).not.toContain("approxTokens");
    expect(meterTpl).not.toContain("approxTokens");
    expect(meterUtil).toContain("preview.history");
  });

  it("装配不出东西时整条不显形（v-if 落在 summary.visible 上），不是显示成 0 条", () => {
    expect(meterTpl).toContain('v-if="summary.visible"');
    expect(meterUtil).toContain("preview.empty");
  });

  it("有真实动作可点：aria-haspopup + 展开面板，不是一枚纯装饰的标签", () => {
    expect(meterTpl).toContain('aria-haspopup="dialog"');
    expect(meterTpl).toContain("<ContextMeterPanel");
    expect(meter).toContain("function toggle(");
  });
});

describe("展开面板", () => {
  it("定位与收起走共用的 popover 实现，不另造一套", () => {
    expect(panel).toContain("useComposerContextPopover");
    expect(panel).toContain("popoverOwnsKey");
    expect(panelTpl).toContain('<Teleport to="body">');
  });

  it("列表逐条渲染，键用 row.key（relPath 会重复，键撞了就串行）", () => {
    expect(panelTpl).toContain('v-for="row in rows"');
    expect(panelTpl).toContain(':key="row.key"');
  });

  it("写清是按哪枚档案装配的——用户得能对上 ProfileChip 那枚看到的名字", () => {
    expect(panelTpl).toContain("{{ profileName }}");
    expect(meterTpl).toContain("agent.contextPreview?.profileName");
  });

  it("面板不许自己 import agent-runtime（渲染层边界）", () => {
    expect(vueSource("components/ContextMeterPanel.vue")).not.toContain("@mochen/agent-runtime");
  });
});

describe("挂载点", () => {
  it("挂在 ComposerContextBar 上，排在 ProfileChip 之后、阶段之前", () => {
    expect(bar).toContain('import ContextMeter from "./ContextMeter.vue"');
    expect(barTpl).toContain("<ContextMeter />");
    const atChip = barTpl.indexOf("<ProfileChip");
    const atMeter = barTpl.indexOf("<ContextMeter />");
    const atStage = barTpl.indexOf('class="composer-context-item composer-stage-context"');
    expect(atChip).toBeGreaterThanOrEqual(0);
    expect(atChip).toBeLessThan(atMeter);
    expect(atMeter).toBeLessThan(atStage);
  });

  it("绑定条只挂一枚：多挂一枚就等于把同一个读数报两遍", () => {
    expect(countNeedle("<ContextMeter", barTpl)).toBe(1);
  });
});

describe("样式", () => {
  it('两段规则都非空壳（ruleBlock 已 trim，空壳读出 ""）', () => {
    expect(ruleBlock(css, ".context-meter")).not.toBe("");
    expect(ruleBlock(css, ".context-meter-panel")).not.toBe("");
  });

  it("浮层语言与阶段弹层同源：同样的描边、圆角、投影", () => {
    const panelRule = ruleBlock(css, ".context-meter-panel");
    expect(panelRule).toContain("var(--theme-line)");
    expect(panelRule).toContain("border-radius: 18px");
    expect(panelRule).toContain("backdrop-filter: blur(18px)");
  });

  it("深色覆写跟着来（漏了就是深色下浮层没有层次）", () => {
    expect(css).toContain('html[data-theme="dark"] .context-meter-panel');
  });

  it("组件里不许写 <style>：本仓样式全在 styles/ 下", () => {
    expect(vueSource("components/ContextMeter.vue")).not.toContain("<style");
    expect(vueSource("components/ContextMeterPanel.vue")).not.toContain("<style");
  });
});
