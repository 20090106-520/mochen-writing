/**
 * 中栏订阅的接线契约（源码断言：本仓 verify 无 vue-tsc，`.vue` 零类型检查）。
 *
 * 这一族钉的不是「会不会退订」（那是 `useAgentStore.listening.test.ts` 的活），
 * 而是钉住一条**反方向的判定**：中栏卸载时**不许**摘订阅。
 * 我一开始把 `agent.stopListening()` 接在了 `onBeforeUnmount` 里，读回真机形状才发现那是错的
 * ——设置中心整页化会把中栏卸载（`App.vue:133` 的注释与模板里的 `v-if="centerView === 'chat'"`），
 * 而一轮对话可以在用户去看设置的这几秒里正好收尾。所以这里的守卫写的是「不许出现」，
 * 配套的后果由 store 侧末条用例量出来（摘掉监听 ⇒ 在途轮永远停在 running）。
 */
import { describe, expect, it } from "vitest";
import { listComponentFiles, scriptSource } from "../utils/vue-source-reader";

const COLUMN = "components/CenterColumn.vue";

/** 抓 `onBeforeUnmount(() => { … })` 的函数体：判据只认这一块里真做了什么。 */
function beforeUnmountBody(): string {
  const body = /onBeforeUnmount\(\(\) => \{([\s\S]*?)\}\);/.exec(scriptSource(COLUMN))?.[1];
  if (body === undefined) {
    throw new Error(`${COLUMN} 里没有 onBeforeUnmount(() => {…}) 块——判据失效，不是产品没问题`);
  }
  return body;
}

describe("CenterColumn · 订阅的挂与摘", () => {
  it("挂载时经 store 订阅（订阅入口只此一处真身）", () => {
    expect(scriptSource(COLUMN)).toContain("agent.startListening()");
    const starts: string[] = [];
    for (const file of listComponentFiles()) {
      if (/\.startListening\(/.test(scriptSource(file))) starts.push(file);
    }
    // 第二处挂载点就是第二条监听：同一份推送会被 apply 两遍，中栏每句话出现两次。
    expect(starts).toEqual([COLUMN]);
  });

  it("卸载时不摘订阅：onBeforeUnmount 里不许出现 stopListening", () => {
    // `scriptSource` 已剥注释，所以这一句判的是真动作，不是「注释里说了不许」。
    expect(beforeUnmountBody()).not.toMatch(/stopListening/);
    // 而定时器该摘还得摘——这一格确实有要随组件死掉的东西，别把那条一并删了。
    expect(beforeUnmountBody()).toContain("clearInterval");
  });

  it("全仓 components 里没有任何一处调 stopListening（摘除点不在组件层）", () => {
    const stops: string[] = [];
    for (const file of listComponentFiles()) {
      if (/\.stopListening\(/.test(scriptSource(file))) stops.push(file);
    }
    expect(stops).toEqual([]);
  });

  it("装配处不许绕开 store 自己接 onAgentEvent", () => {
    expect(scriptSource(COLUMN)).not.toMatch(/onAgentEvent/);
  });
});
