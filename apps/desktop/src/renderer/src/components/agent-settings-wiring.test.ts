/// <reference types="node" />
/**
 * 源码契约测试（2026-10-05 设置页「智能体」页签）：`.vue` 在本仓既不过 tsc 也没有组件测试环境，
 * 于是「面板挂的是既有真身、设置页接得进这一页」只能钉在源码字符串上
 * （一份真身：utils/vue-source-reader.ts；store 是 .ts，直接读文件原文，同样只钉接线不碰实现）。
 * 钉四件事：
 * ① 权限档三档调 book.setPermissionMode（与输入卡 chip、/permission 同一处落盘真身）；
 * ② 三档按钮**不禁用**——没开书时点了要有中文 notice，禁用会把「为什么改不了」藏起来；
 * ③ 联网默认档调 agent.toggleWebSearch，且 store 那一头真的写了记忆档（下次启动照这一档）；
 * ④ 设置页有这一页的分类与渲染分支，缺一边就是半截接线。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scriptSource, templateSource, vueSource } from "../utils/vue-source-reader";

const script = scriptSource("components/AgentSettingsPanel.vue");
const template = templateSource("components/AgentSettingsPanel.vue");
const page = vueSource("components/SettingsPage.vue");
const agentStore = readFileSync(new URL("../stores/useAgentStore.ts", import.meta.url), "utf8");

describe("AgentSettingsPanel · 权限档三档接到既有真身", () => {
  it("选项来自 utils/permission-settings，点击调 book.setPermissionMode（不另造一份写盘）", () => {
    expect(script).toContain('from "../utils/permission-settings"');
    expect(script).toContain("permissionOptions()");
    expect(script).toMatch(/function chooseMode[\s\S]{0,120}book\.setPermissionMode\(mode\)/);
    expect(template).toContain('@click="chooseMode(option.value)"');
    // 选中态靠 aria-pressed + 现成 check 字形，不新造一套开关样式。
    expect(template).toContain(':aria-pressed="currentMode === option.value"');
  });

  it("反向：三档不许禁用——无书时禁用会把「还没打开作品目录」这句实话藏起来", () => {
    expect(template).not.toContain(":disabled");
    expect(template).not.toContain("disabled=");
  });
});

describe("AgentSettingsPanel · 联网默认档真的被记住", () => {
  it("开关是现成 provider-switch 形态，@change 调 agent.toggleWebSearch", () => {
    expect(template).toContain('class="provider-switch"');
    expect(template).toContain('class="provider-switch-slider"');
    expect(template).toContain('type="checkbox"');
    expect(template).toContain(':checked="agent.webSearchEnabled"');
    expect(template).toContain('@change="toggleWebSearchDefault"');
    expect(script).toMatch(/function toggleWebSearchDefault[\s\S]{0,80}agent\.toggleWebSearch\(\)/);
  });

  it("store 那一头：初始读记忆档、切换时写记忆档（只钉接线，读写本身由 utils 的用例覆盖）", () => {
    expect(agentStore).toContain(
      "webSearchEnabled: loadWebSearchDefault(webSearchPreferenceStorage())"
    );
    expect(agentStore).toMatch(
      /toggleWebSearch\(\)[\s\S]{0,220}saveWebSearchDefault\(storage, this\.webSearchEnabled\)/
    );
    expect(agentStore).toContain('from "../utils/web-search-preference"');
  });
});

describe("AgentSettingsPanel · 记住思考档（2026-10-05 新增）", () => {
  it("开关接 agent.toggleThinkingRemember；档位记忆与开关记忆都在 utils/thinking-preference", () => {
    expect(template).toContain(':checked="agent.thinkingRemembered"');
    expect(template).toContain('@change="toggleThinkingRemembered"');
    expect(script).toMatch(
      /function toggleThinkingRemembered[\s\S]{0,90}agent\.toggleThinkingRemember\(\)/
    );
    expect(agentStore).toContain(
      "thinkingRemembered: loadThinkingRemember(thinkingPreferenceStorage())"
    );
    expect(agentStore).toContain(
      "thinkingLevel: initialThinkingLevel(thinkingPreferenceStorage())"
    );
    expect(agentStore).toMatch(
      /toggleThinkingRemember\(\)[\s\S]{0,260}persistThinkingRemember\(storage, this\.thinkingRemembered/
    );
    expect(agentStore).toMatch(
      /cycleThinking\(\)[\s\S]{0,320}saveThinkingLevel\(storage, this\.thinkingLevel\)/
    );
    expect(agentStore).toContain('from "../utils/thinking-preference"');
  });

  it("版式裁定（2026-10-05）：权限三档是 agent-mode-card 网格，button 不许再套 settings-item", () => {
    expect(template).toContain('class="agent-mode-grid"');
    expect(template).toContain('class="agent-mode-card"');
    // settings-item 是给 div 行设计的；套在 button 上会漏出 UA 灰底/居中/fit-content（用户截图实锤）。
    expect(template).not.toMatch(/<button[^>]*class="settings-item"/);
    const css = readFileSync(new URL("../styles/settings-page.css", import.meta.url), "utf8");
    // 面有了样式才算修完：卡片自己的面/边/左对齐（UA 按钮灰底与居中不许再漏出来）。
    expect(css).toContain(".agent-mode-card {");
    expect(css).toMatch(/\.agent-mode-card \{[^}]*text-align: left/);
    expect(css).toMatch(/\.agent-mode-grid \{[^}]*display: grid/);
  });
});

describe("AgentSettingsPanel · 发送键（2026-10-05 新增）", () => {
  it("两档来自 utils/send-key-preference，点卡写偏好档；初始档读同一份存储", () => {
    expect(script).toContain('from "../utils/send-key-preference"');
    expect(script).toContain("submitKeyOptions()");
    expect(script).toMatch(/function chooseSubmitKey[\s\S]{0,140}saveSubmitKey\(storage, value\)/);
    expect(script).toContain(
      "currentSubmitKey = ref<SubmitKey>(loadSubmitKey(submitKeyPreferenceStorage()))"
    );
    expect(template).toContain('role="group" aria-label="发送键"');
  });

  it("键位消费端真的吃这一档：useHotkeys 每次按键重读偏好（改完下一键即生效，不经 store）", () => {
    const hotkeys = readFileSync(new URL("../composables/useHotkeys.ts", import.meta.url), "utf8");
    expect(hotkeys).toContain("submitKey: loadSubmitKey(submitKeyPreferenceStorage())");
    // 裁决真身在 utils/hotkeys：ctrl-enter 档的两条分支都在判定层（不在组件里手搓一份）。
    const judge = readFileSync(new URL("../utils/hotkeys.ts", import.meta.url), "utf8");
    expect(judge).toContain('focus.submitKey === "ctrl-enter"');
  });

  it("反向：发送键两卡同样不禁用，选中态走 aria-pressed + check 字形", () => {
    expect(template).toContain(':aria-pressed="currentSubmitKey === option.value"');
    expect(template).not.toContain(":disabled");
  });
});

describe("SettingsPage · 「智能体」这一页接进去了", () => {
  it("侧栏有这一项、内容区有这一支渲染分支，两边缺一就是半截", () => {
    expect(page).toContain('id: "agent"');
    expect(page).toContain('label: "智能体"');
    expect(page).toContain("<AgentSettingsPanel v-else-if=\"settingsTab === 'agent'\" />");
    expect(page).toContain('import AgentSettingsPanel from "./AgentSettingsPanel.vue"');
  });
});
