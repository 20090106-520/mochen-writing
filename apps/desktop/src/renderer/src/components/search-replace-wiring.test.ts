/**
 * 全书替换的接线守卫（2026-10-15）。全是读源码钉的（`.vue` 不进 tsc，也没有运行时覆盖）：
 *
 * ① 组件只走 `runBookReplace` 那一枚入口 ⇒ 递参、异常兜底、把回执翻成人话都留在 utils/book-replace
 *    一处，组件里不许直连 `window.mochen`、更不许自己拼那句通知话。
 * ② 组件里不许出现 writeDoc / replaceAllInBook 的字样 ⇒ 「换哪几篇」是主进程按自己的快照定的，
 *    渲染层连一篇的路径都递不出去（这是这一刀的安全面）。
 * ③ 容错命中那一轮不给替换入口 ⇒ 「一字之差」是相似不是相同，照着它改盘上正文会把用户
 *    没找的那几个字一起换掉；这条读源码才钉得住（canReplace 里那句 mode === "exact"）。
 * ④ 两步确认真的存在 ⇒ 一次误点不该把上千篇翻一遍。
 */
import { describe, expect, it } from "vitest";
import { scriptSource, templateSource } from "../utils/vue-source-reader";

const PANEL = "components/SearchPanel.vue";

describe("SearchPanel · 全书替换的接线", () => {
  it("只走 runBookReplace 一枚入口，不直连 window.mochen、不自己拼通知话", () => {
    const script = scriptSource(PANEL);
    expect(script).toContain("await runBookReplace({");
    // 递参、异常兜底与文案真身都在 utils/book-replace；组件绕开它直连 IPC 就是第二份判据。
    expect(script).not.toContain("window.mochen.replaceAllInBook");
    expect(script).toContain("bookReplaceNotice(result, query, localReplacement.value)");
  });

  it("反向钉：组件里不写盘、也不递任何一篇的路径", () => {
    const script = scriptSource(PANEL);
    expect(script).not.toContain("writeDoc");
    expect(script).not.toContain("replaceAllInBook");
  });

  it("容错命中那一轮不给替换入口：相似不是相同", () => {
    const script = scriptSource(PANEL);
    expect(script).toContain('lastResult.value.mode === "exact"');
  });

  it("两步确认：第一下只是举起「确认替换全书 N 篇？」，第二下才真动手", () => {
    const tpl = templateSource(PANEL);
    expect(tpl).toContain("确认替换全书 ${book.docs.length} 篇？");
    expect(tpl).toContain("全书替换");
    expect(scriptSource(PANEL)).toContain("replaceArmed.value = true");
  });
});
