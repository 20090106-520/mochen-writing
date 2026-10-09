/**
 * 思考档线格式的**接线契约**（2026-10-09 批次 5-㊻）。
 *
 * 为什么这些只能读源码断言：`.vue` 的 `<script setup>` 不进本仓的类型程序（verify 用裸 tsc），
 * 而这一族出过的两类事故——「芯片报了一套假话」「这一格控件压根没接线」——都不会被 tsc 拦住。
 *
 * 背景见 contracts 的 `ThinkingWire`：Agnes AI Hub 真机回执
 * `Unexpected reasoning effort high. Supported types are xhigh (default), medium, and low.`
 * ——它照收 low/medium，唯独最高那一档叫 xhigh，我们发 high 上去整笔请求 400。
 */
import { describe, expect, it } from "vitest";
import { scriptSource, templateSource, typeScriptSource } from "../utils/vue-source-reader";

const DIALOG = "components/ModelProfileDialog.vue";
const SETTINGS = "components/ProviderSettings.vue";
const CENTER = "components/CenterColumn.vue";
const COMPOSER = "components/ComposerBox.vue";
const CHIPS = "utils/composer-chips.ts";
const STORE = "stores/useProviderStore.ts";

describe("ModelProfileDialog · 这一格真的存在，且存得下去", () => {
  it("下拉两档都在，v-model 绑在它自己身上", () => {
    const tpl = templateSource(DIALOG);
    expect(tpl).toContain('v-model="thinkingWire"');
    expect(tpl).toContain('<option value="standard">');
    expect(tpl).toContain('<option value="xhigh">');
  });

  it("**文案读 contracts 那份常量**，不在模板里手抄两句话", () => {
    const tpl = templateSource(DIALOG);
    expect(tpl).toContain("THINKING_WIRE_LABELS.standard");
    expect(tpl).toContain("THINKING_WIRE_LABELS.xhigh");
  });

  it("保存时把它一起发下去（少这一行 = 界面上选了、盘上没存）", () => {
    expect(scriptSource(DIALOG)).toContain("thinkingWire: thinkingWire.value");
  });

  it("反向钉：不许在这一格旁边出现第二份线格式表（那是同一件事的第二份实现）", () => {
    const script = scriptSource(DIALOG);
    expect(script).not.toContain('"xhigh" :');
    expect(script).not.toContain("xhigh ?");
  });
});

describe("ProviderSettings · 卡片上看得见", () => {
  it("非 standard 时标一枚「深度走 xhigh」，并说清为什么", () => {
    const tpl = templateSource(SETTINGS);
    expect(tpl).toContain("v-if=\"group.connection.thinkingWire === 'xhigh'\"");
    expect(tpl).toContain("深度走 xhigh");
    // 提示里要带上真实回执里的那个字段值，否则用户对不上自己看到的报错。
    expect(tpl).toContain("reasoning_effort=high");
  });
});

describe("CenterColumn · 装配处把连接那一档喂给输入卡", () => {
  it("传给 ComposerBox 的是 store 上那个 computed，不是写死的字面量", () => {
    expect(templateSource(CENTER)).toContain(':thinking-wire="provider.activeThinkingWire"');
  });

  it("store 确实暴露了它，且与 activeConnectionId 同源（读的是同一份事实）", () => {
    const store = typeScriptSource(STORE);
    expect(store).toContain("const activeThinkingWire = computed");
    // 反向钉：它必须由 activeConnectionId 派生，自己不许再 find 一遍启用中的档案。
    expect(store).toContain("connectionOf(activeConnectionId.value)?.thinkingWire");
  });
});

describe("ComposerBox · 只是转发，不自行判定", () => {
  it("原样交给 composerChips，组件里不许出现 xhigh 字面量", () => {
    const script = scriptSource(COMPOSER);
    expect(script).toContain("thinkingWire: props.thinkingWire");
    expect(script).toContain("thinkingWire: ThinkingWire");
    expect(script).not.toContain('"xhigh"');
  });
});

describe("composer-chips · 提示报的是真身，不是档位名", () => {
  it("提示用 thinkingWireValueOf 的结果，不是把档位名直接拼上去", () => {
    const chips = typeScriptSource(CHIPS);
    expect(chips).toContain("const wireValue = thinkingWireValueOf(level, wire)");
    expect(chips).toContain("${THINKING_WIRE_FIELD}=${wireValue}");
  });

  it("反向钉：老写法（把 level 拼进提示）不许回来——xhigh 连接上那会是一句假话", () => {
    const chips = typeScriptSource(CHIPS);
    expect(chips).not.toContain("${THINKING_WIRE_FIELD}=${level}");
  });

  it("判据来自 contracts，不是本文件另写一份", () => {
    const chips = typeScriptSource(CHIPS);
    expect(chips).toContain('from "@mochen/contracts"');
    expect(chips).toContain("thinkingWireValueOf");
    // 本文件不许自己拿 high 去换 xhigh。
    expect(chips).not.toContain('=== "high" ? "xhigh"');
  });
});
