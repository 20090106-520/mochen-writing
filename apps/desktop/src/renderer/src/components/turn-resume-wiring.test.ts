/**
 * 「继续」这一枚钮的**接线契约**（2026-11-20 · 主线第一刀）。
 *
 * `.vue` 与 .css 都不进类型程序，只能靠源码断言钉住（本仓零 jsdom / @vue/test-utils，
 * 见 utils/vue-source-reader.ts 开头）。读法全走 vue-source-reader：模板段剥 HTML 注释、
 * script 段剥 JS 注释——否则「这里没有 X」这句话本身写着 X，断言会假绿。
 *
 * 这一族钉的是**一句承诺有没有兑现**：
 * 状态行原来写「已打断 · 可点「继续」」，而那一行是纯文本 `<span>`，全仓没有一枚按钮。
 * 于是这里钉住三件事：① 它是一枚真 button；② 它的挂点判定只有一份；
 * ③ 重发时不记「还字账」（那句字早就在中栏转录里了，再还一次就是第二份）。
 */
import { describe, expect, it } from "vitest";
import { scriptSource, templateSource, typeScriptSource } from "../utils/vue-source-reader";

const CENTER = "components/CenterColumn.vue";
const centerTpl = templateSource(CENTER);
const centerScript = scriptSource(CENTER);
const store = typeScriptSource("stores/useAgentStore.ts");
const threadUtil = typeScriptSource("utils/agent-thread.ts");

describe("状态栏里的「继续」", () => {
  it("它是一枚真 button，不是一句纯文本", () => {
    expect(centerTpl).toContain('class="status-action status-action-resume"');
    expect(centerTpl).toContain('type="button"');
    expect(centerTpl).toContain('@click="resumeTurn"');
    // 挂不挂由判定说了算，不写死在模板里。
    expect(centerTpl).toContain('v-if="resumeAffordance"');
  });

  it("它读唯一判定，不自己 if 一遍（铁律 6）", () => {
    expect(centerScript).toContain("resumeAffordanceOf(thread.value)");
    // 按钮上的字与悬停说明都从判定结果里来：模板不许自己写第二份文案。
    expect(centerTpl).toContain("resumeAffordance.label");
    expect(centerTpl).toContain("resumeAffordance.title");
  });

  it("点下去走 store 的那一个动作，组件不自己拼请求", () => {
    expect(centerScript).toContain("agent.resumeLastTurn()");
    expect(store).toContain("resumeLastTurn(");
    // 重发的是早就发出去过的那句 ⇒ 失败时不许把它还回输入框（会是第二份）。
    expect(store).toContain("rememberForRestore: false");
  });

  it("屏上不许再出现点不动的承诺：状态行里不许有「可点「继续」」", () => {
    expect(threadUtil).not.toContain("可点「继续」");
  });
});
