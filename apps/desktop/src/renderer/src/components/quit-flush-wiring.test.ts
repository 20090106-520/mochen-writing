import { describe, expect, it } from "vitest";
import {
  listComponentFiles,
  scriptSource,
  typeScriptSource,
  vueSource
} from "../utils/vue-source-reader";

/**
 * 退出握手的装配守卫（2026-10-09 全仓扫描 P0-6；2026-10-11 收口判据形状）。
 *
 * 这条通路最难守的地方不是判定——判定在 `utils/draft-flush`、`utils/quit-flush-client`、
 * `main/quit-flush.ts` 三处各有用例——而是**有没有人把它接上**。`flushAllForQuit()` 就是前车之鉴：
 * 函数写好了、用例也绿，主进程从来没人调，用户点关闭时照样一个字都不落盘。
 * 所以这里钉的是装配点本身：根组件挂载时接一次，且只接一次。
 *
 * 「只接一次」的判据从布尔换成了 preload 交回的那只退订函数本身（与 `useAgentStore` 的
 * `agentEventOff` 同一形状）。换的理由不是布尔写错了，而是**它只答得出「还要不要再注册」，
 * 答不出「已经注册的那一只怎么摘」**——于是「挂没挂」和「怎么摘」两份判据各说一套。
 * 后面那三条守的是这件事不再回来：布尔不许复活、句柄的真身只许有一处、
 * 以及注释不许指着已经不存在的字段。
 */
describe("退出握手的装配", () => {
  it("根组件挂载时接上监听：组件从不直接摸 window.mochen", () => {
    const app = scriptSource("App.vue");
    expect(app).toMatch(/onMounted\(\(\) =>\s*\{[\s\S]*?book\.listenQuitFlush\(\);/);
    expect(app).not.toContain("window.mochen.onQuitFlushRequest");
  });

  it("store 那一侧的判据是句柄本身：装配先摘旧再订新，绝不叠两层", () => {
    const store = typeScriptSource("stores/useBookStore.ts");
    // 原先这里是 `if (布尔) return;`——「挂没挂」和「怎么摘」是两份东西。
    // 现在摘与挂写在一起：先调用手里那只（没有就跳过），再把新交回的那只存进同一格。
    // 写了 `installQuitFlushListener(...)` 而不赋值，是这段接线唯一的假控件形状：
    // 看上去订上了、行为用例全绿，但没有任何人拿得住它。
    expect(store).toMatch(/this\.quitFlushOff\?\.\(\);/);
    expect(store).toMatch(/this\.quitFlushOff = installQuitFlushListener\(/);
    expect(countListenerInstalls(store)).toBe(1);
  });

  it("布尔判据不许复活：同一件事不留两份判据（铁律 6）", () => {
    expect(typeScriptSource("stores/useBookStore.ts")).not.toContain("quitFlushListening");
  });

  it("句柄的真身只有一处：组件不许自己摸它，也不许自己退订", () => {
    const touched = listComponentFiles().filter((file) => vueSource(file).includes("quitFlushOff"));
    expect(touched).toEqual([]);
  });

  it("client 的注释不许指着已经不存在的布尔（第二份判据的幽灵形状）", () => {
    // 这条要读**原文**：`typeScriptSource` 会剥掉注释，而那句话正是写在注释里的——剥了它就永远绿，
    // 量不到「注释还在教人去找一枚已经删掉的布尔」这件正在发生的事。
    expect(vueSource("utils/quit-flush-client.ts")).not.toContain("quitFlushListening");
  });
});

/** 接线语句在整份 store 里只许出现一次——出现两次就是两条回程、两遍落盘。 */
function countListenerInstalls(source: string): number {
  return (source.match(/installQuitFlushListener\(/g) ?? []).length;
}
