/// <reference types="node" />
/**
 * 源码契约测试（F-C）：本仓没有 jsdom / @vue/test-utils，`.vue` 的模板与接线够不着运行时断言，
 * 于是沿用 utils/hotkey-markers.test.ts 的 readFileSync 模式，把「三段主操作各调一个真身」钉成可失败的断言：
 * ① 三段各自的 data-nav-id 与 <kbd> 键标在模板里真实存在；② handler 调的是**真身函数名**
 * （layout.showSettings / agent.clearThreadView / book.pickAndOpen），不是另捏一份打开逻辑（§2.7）；
 * ③ 第三段的 disabled 判定以属性形态出现，不是恒可点；④「同源」不止是说明文字——
 * 中栏头部也必须调同一个 layout.showSettings('general')，且不得退回私有的 `showSettings.value = true` 局部开关。
 * ESM 没有 __dirname，路径一律由 import.meta.url 解出。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("../", import.meta.url));
const source = readFileSync(join(SRC_DIR, "components/LeftSidebar.vue"), "utf8");
const script = /<script setup[^>]*>([\s\S]*?)<\/script>/.exec(source)?.[1] ?? "";
const template = /<template>([\s\S]*)<\/template>/.exec(source)?.[1] ?? "";

describe("LeftSidebar · 三段主操作各调一个真身（F-C，§2.7）", () => {
  it("段①打开作品目录仍在位且 Ctrl O 键标已接通（核对现状：附录 §3 的账）", () => {
    expect(template).toContain('data-nav-id="open-book"');
    expect(template).toContain("<kbd>Ctrl O</kbd>");
    expect(script).toContain("book.pickAndOpen()");
  });

  it('段②模型配置调 layout.showSettings("general")，与中栏头部同源', () => {
    expect(template).toContain('data-nav-id="model-config"');
    expect(script).toContain('showSettings("general")');
  });

  it("段③本章新对话调 agent.clearThreadView(threadKeyFor(...))，只清渲染层", () => {
    expect(template).toContain('data-nav-id="new-thread"');
    expect(script).toContain("clearThreadView(threadKeyFor(book.activeDocTab))");
  });

  it("文案诚实：新对话一段复用 CLEAR_VIEW_SENTENCE 作 title，绝不写「新建会话线程」", () => {
    expect(script).toContain("CLEAR_VIEW_SENTENCE");
    expect(template).toContain('data-nav-id="new-thread"');
    expect(template).not.toContain("新建会话线程");
    // 反向鉴别：无书时第三段 disabled 的判定必须真出现（不是恒可点）。
    expect(template).toMatch(
      /data-nav-id="new-thread"[\s\S]*?:disabled="book\.activeDocTab === null"/
    );
  });

  it("同源断言：中栏头部也只调 layout.showSettings('general')，没有私有浮层（评审 T8-2）", () => {
    const center = readFileSync(join(SRC_DIR, "components/CenterColumn.vue"), "utf8");
    // 正向：头部按钮走同一个真身动作（写的是单引号实参，与左栏的双引号只是格式差异）。
    expect(center).toContain("layout.showSettings('general')");
    // 反向：头部不得再有自己的局部开关——`const showSettings = computed(...)` 是只读视图判定，
    // 钉的是写形式 `showSettings.value = `，只读那一处不该被误伤。
    expect(center).not.toContain("showSettings.value = ");
  });
});
