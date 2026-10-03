/**
 * 切模型这条链路的接线契约（#104）。
 * 本仓 verify 用裸 tsc（没有 vue-tsc），`vue-shim.d.ts` 把 `*.vue` 声明成 any ⇒ 组件零类型检查，
 * 于是「chip 点得到 store、store 走对通道、弹层不撒谎」只能钉成读源码断言
 * （同律先例：provider-settings-wiring.test.ts、document-pane-wiring.test.ts）。
 * 注释会被 vue-source-reader 剥掉：只在注释里宣称的接线不算数。
 */
import { describe, expect, it } from "vitest";
import { scriptSource, templateSource, vueSource } from "../utils/vue-source-reader";

const POPOVER = "components/ModelSelect.vue";
const CENTER = "components/CenterColumn.vue";
const COMPOSER = "components/ComposerBox.vue";
const SETTINGS = "components/ProviderSettings.vue";

describe("ModelSelect · 弹层本体", () => {
  it("是弹层就得有关闭通路：遮罩点空白关、Esc 关、关闭钮关", () => {
    const markup = templateSource(POPOVER);
    const script = scriptSource(POPOVER);
    expect(markup).toContain(`@click.self="emit('close')"`);
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain('@keydown="onKeydown"');
    expect(script).toContain(`if (event.key !== "Escape") return;`);
    expect(markup).toContain(`@click="emit('close')"`);
  });

  it("当前模型那一行不是按钮：再点一次只是把同一个值存回去，属于摆设", () => {
    const markup = templateSource(POPOVER);
    // 当前项只挂徽章；「改用」按钮必须挂在 v-else 上——它渲染的时机就是「这一行不是当前」。
    // 变异 M-D 实测：只写 `toContain("v-else")` 会被失败分支里那个无关的 `<template v-else>` 蒙过去。
    expect(markup).toContain(`v-if="name === current"`);
    const pickTag = /<button[^>]*class="model-select-pick"[^>]*>/.exec(markup)?.[0] ?? "";
    expect(pickTag).toContain("v-else");
    expect(pickTag).not.toContain("v-if");
    expect(markup).toContain(`@click="emit('select', name)"`);
  });

  it("忙态理由是看得见的文字，不是 disabled 按钮上的 title（Chromium 不给 disabled 弹提示）", () => {
    const markup = templateSource(POPOVER);
    expect(markup).toContain('v-if="switching"');
    expect(markup).toContain("正在写回模型名");
    expect(markup).not.toMatch(/:disabled="switching"[\s\n]+:title/);
  });

  it("失败时把主进程那句中文理由原样摆出来，并提供一次真的重试", () => {
    const markup = templateSource(POPOVER);
    expect(markup).toContain("{{ failReason }}");
    expect(markup).toContain(`@click="emit('retry')"`);
  });

  it("拉取与理由都只读 props：组件自己不碰 window.mochen，也不拼 {baseURL}/models", () => {
    const script = scriptSource(POPOVER);
    expect(script).not.toContain("window.mochen");
    expect(script).not.toContain("/models");
    expect(script).toContain('from "@mochen/contracts"');
  });

  it("title 报出通道名（铁律：报不出通道名的控件不进 UI）", () => {
    expect(templateSource(POPOVER)).toContain("provider:list-models");
  });
});

describe("CenterColumn · chip → 事件 → store → 弹层一条线", () => {
  it("模型 chip 的事件有真 handler，并且打开弹层的同时真的去拉名单", () => {
    const markup = templateSource(CENTER);
    const script = scriptSource(CENTER);
    expect(markup).toContain(`@open-model-select="openModelSelect"`);
    expect(script).toContain("function openModelSelect");
    expect(script).toContain("provider.loadModels()");
    expect(markup).toContain("<ModelSelect");
    expect(markup).toContain('@close="modelsOpen = false"');
  });

  it("选中与重试都走 useProviderStore，组件里不出现第二份 providerSave", () => {
    const script = scriptSource(CENTER);
    const markup = templateSource(CENTER);
    expect(script).toContain('from "../stores/useProviderStore"');
    expect(script).toContain("provider.select(");
    // 重试带 true = 强制重拉：缓存是否有效只由 store 的 models 是否为 null 判定，组件不另判一次。
    expect(markup).toContain("provider.loadModels(true)");
    expect(script).not.toContain("providerSave");
    expect(markup).not.toContain("providerSave");
  });

  it("视图挂载即读一次配置：chip 一亮出来就要能报出当前模型名", () => {
    expect(scriptSource(CENTER)).toContain("void provider.refresh()");
  });
});

describe("ComposerBox · 只是转发，不自行判定", () => {
  it("声明了 open-model-select 事件与 modelLabel/baseUrl 两个入参", () => {
    const script = scriptSource(COMPOSER);
    expect(script).toContain('"open-model-select": []');
    expect(script).toContain("modelLabel: string");
    expect(script).toContain("baseUrl: string");
    expect(script).toContain("modelLabel: props.modelLabel");
    expect(script).toContain("baseURL: props.baseUrl");
  });

  // 真机冒烟抓到的原罪：`:base-url` 被 Vue camelize 成 `baseUrl`，而 prop 当时声明为 `baseURL`
  // ⇒ 组件收到 undefined，chip 的 title 拼出 `undefined/models`。源码契约只看字符串，两边都绿。
  // 这一条把「绑定名 camelize 之后必须等于声明名」钉住：改任何一边都必须同时改另一边。
  it("kebab 绑定 `:base-url` 的 camelize 结果必须就是声明的 prop 名", () => {
    const binding = /<ComposerBox[\s\S]*?\/>/.exec(templateSource(CENTER))?.[0] ?? "";
    const camelize = (s: string) => s.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
    const bound = [...binding.matchAll(/:([a-z][a-z0-9]*(?:-[a-z0-9]+)+)=/g)]
      .map((m) => m[1])
      .filter((k): k is string => k !== undefined && !k.startsWith("v-"));
    expect(bound.length).toBeGreaterThan(0);
    const declared = scriptSource(COMPOSER);
    for (const key of bound) {
      expect(declared).toContain(`${camelize(key)}:`);
    }
  });
});

describe("ProviderSettings · 视图唯一真身是 useProviderStore", () => {
  it("不再自己持有一份 ProviderView：否则浮层保存后 chip 还读旧值（同一个数两份口径）", () => {
    const script = scriptSource(SETTINGS);
    expect(script).toContain('from "../stores/useProviderStore"');
    expect(script).not.toContain("ref<ProviderView | null>");
    expect(script).not.toContain("window.mochen.providerView");
    expect(script).not.toContain("window.mochen.providerSave");
    expect(script).not.toContain("presentableProviderError");
  });

  it("弹层全文不出现硬编码颜色：样式一律走 interaction.css 的 token", () => {
    for (const path of [POPOVER, CENTER, SETTINGS]) {
      expect(vueSource(path)).not.toMatch(/(color|background|border)\s*:\s*#[0-9a-fA-F]/);
    }
  });
});
