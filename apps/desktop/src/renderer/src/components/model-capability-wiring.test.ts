import { describe, expect, it } from "vitest";
import { scriptSource, templateSource, typeScriptSource } from "../utils/vue-source-reader";

const SELECT = "components/ModelSelect.vue";
const MENU = "components/ModelSelectMenu.vue";
const CENTER = "components/CenterColumn.vue";
const WIRING = "composables/useModelCapability.ts";

describe("ModelSelectMenu · 三行设置卡与级联子菜单", () => {
  it("首屏为模型、推理强度、自定义模型三行", () => {
    const tpl = templateSource(MENU);
    expect(tpl).toContain("模型");
    expect(tpl).toContain("推理强度");
    expect(tpl).toContain("自定义模型");
    expect(tpl).toContain("emit('open-models')");
    expect(tpl).toContain("emit('open-levels')");
  });

  it("推理强度是设置卡右侧的独立子面板", () => {
    const tpl = templateSource(MENU);
    expect(tpl).toContain("props.section === 'levels'");
    expect(tpl.split('class="model-select-submenu"').length).toBe(2);
    expect(tpl).toContain("THINKING_LEVEL_COMPACT_LABELS[optionLevel]");
  });

  it("只列当前模型真实支持的档位，不提供上下文窗口子面板", () => {
    const script = scriptSource(MENU);
    const tpl = templateSource(MENU);
    expect(tpl).toContain('v-for="optionLevel in props.levels"');
    expect(script).not.toContain("CONTEXT_WINDOW_PRESETS");
    expect(script).not.toContain("DEFAULT_CONTEXT_WINDOW_TOKENS");
    expect(tpl).not.toContain("上下文窗口");
    expect(tpl).not.toContain("props.section === 'window'");
  });

  it("不支持 reasoning_effort 时禁用档位入口并解释", () => {
    const tpl = templateSource(MENU);
    expect(tpl.replace(/\s+/g, " ")).toContain("不认 reasoning_effort");
    expect(tpl).toContain(':disabled="levelsEmpty"');
  });

  it("子菜单键盘自管：Esc/← 回上级、↕ 换档高亮（stop 掉 panel 的收层判定）", () => {
    // ChatGPT 桌面端同款键盘模型：模型与推理档是一个控件，子菜单分层关闭，
    // Enter 不拦——焦点在高亮那颗选项上，原生 click 就是选中，再拦一份是第二判据（铁律 6）。
    const script = scriptSource(MENU);
    const tpl = templateSource(MENU);
    expect(script).toContain("onSubmenuKeydown");
    expect(script).toContain('event.key === "Escape" || event.key === "ArrowLeft"');
    expect(script).toContain("levelHighlight.move");
    expect(script).toContain('emit("back")');
    expect(tpl).toContain('@keydown="onSubmenuKeydown"');
    // 高亮与「当前档 ✓」是两回事：is-active 是键盘指着的行，✓ 是已保存的值。
    expect(tpl).toContain(`'is-active': activeLevel === optionLevel`);
    expect(tpl).toContain("optionLevel === props.level");
    // 进子菜单那一刻高亮重落当前档（initialIndex 只在实例创建时算一次，档位变了它不跟）。
    expect(script).toContain('if (section === "levels") setActiveLevel(props.level)');
  });
});

describe("ModelSelect · 首屏设置卡，模型列表向左展开", () => {
  it("初始为 menu，模型主面板只在 models 屏渲染", () => {
    const script = scriptSource(SELECT);
    const tpl = templateSource(SELECT);
    expect(script).toContain('ref<ModelMenuSection>("menu")');
    expect(tpl).toContain("v-if=\"menuSection === 'models'\"");
    expect(tpl).toContain('class="model-select-main"');
    expect(tpl).toContain("<ModelSelectMenu");
    expect(tpl).toContain('@open-models="toggleModels"');
  });

  it("弹层宽度随级联屏变化，并以芯片右缘为定位基准", () => {
    const script = scriptSource(SELECT);
    expect(script).toContain("const panelWidth = computed");
    expect(script).toContain("widthPx: () => panelWidth.value");
    expect(script).toContain('align: "end"');
    expect(script).toContain("horizontalOffsetPx: () => horizontalOffset.value");
  });

  it("推理能力读数全部来自 props", () => {
    const tpl = templateSource(SELECT);
    expect(tpl).toContain(':model="props.current"');
    expect(tpl).toContain(':level="props.capabilityLevel"');
    expect(tpl).toContain(':levels="props.capabilityLevels"');
    expect(tpl).toContain(':capability-writing="props.capabilityWriting"');
    expect(tpl).not.toContain("capabilityWindow");
  });

  it("模型浮层没有上下文窗口入口，配置仍留在模型设置页", () => {
    const tpl = templateSource(SELECT);
    expect(tpl).not.toContain('class="model-select-window"');
    expect(tpl).not.toContain("上下文窗口");
    expect(tpl).not.toContain("@pick-window=");
    expect(templateSource(MENU)).not.toContain("上下文窗口");
  });

  it("写模型与写能力的提示各自独立", () => {
    const tpl = templateSource(SELECT);
    expect(tpl).toContain("正在写回模型名");
    expect(tpl).toContain("正在写入模型能力");
    expect(tpl).toContain('v-if="capabilityWriting"');
    expect(tpl).toMatch(/v-if="switching"[^>]*>正在写回模型名/);
  });
});

describe("CenterColumn · 模型能力仍接 provider store", () => {
  it("推理档位与写回标记都来自 store", () => {
    const tpl = templateSource(CENTER);
    expect(tpl).toContain(':capability-levels="provider.activeThinkingLevels"');
    expect(tpl).toContain(':capability-level="provider.activeThinkingLevel"');
    expect(tpl).toContain(':capability-writing="provider.capabilityWriting"');
    expect(tpl).toContain(':thinking-capability="provider.activeCapability"');
    expect(tpl).not.toContain(":capability-window=");
  });

  it("菜单写回统一经过 useModelCapability", () => {
    expect(scriptSource(CENTER)).toContain("useModelCapability()");
    const tpl = templateSource(CENTER);
    expect(tpl).toContain("@set-level=");
    expect(tpl).not.toContain("@set-window=");
  });
});

describe("useModelCapability · 模型级写回", () => {
  it("推理强度落回当前模型档案，浮层不再暴露窗口写回", () => {
    const wiring = typeScriptSource(WIRING);
    expect(wiring).toContain("provider.setModelCapability({ thinkingLevel: level })");
    expect(wiring).not.toContain("setModelWindow");
  });

  it("写回失败的理由在非名单屏也看得见", () => {
    const select = templateSource(SELECT);
    const menu = templateSource(MENU);
    expect(select).toContain(':error="props.switchError"');
    expect(menu).toContain("props.error && props.section !== 'models'");
    expect(menu).toContain("{{ props.error }}");
    expect(menu).toContain('role="alert"');
  });
});
