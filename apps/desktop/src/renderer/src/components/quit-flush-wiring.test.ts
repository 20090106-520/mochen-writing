import { describe, expect, it } from "vitest";
import { scriptSource, typeScriptSource } from "../utils/vue-source-reader";

/**
 * 退出握手的装配守卫（2026-10-09 全仓扫描 P0-6）。
 *
 * 这条通路最难守的地方不是判定——判定在 `utils/draft-flush`、`utils/quit-flush-client`、
 * `main/quit-flush.ts` 三处各有用例——而是**有没有人把它接上**。`flushAllForQuit()` 就是前车之鉴：
 * 函数写好了、用例也绿，主进程从来没人调，用户点关闭时照样一个字都不落盘。
 * 所以这里钉的是装配点本身：根组件挂载时接一次，且只接一次。
 */
describe("退出握手的装配", () => {
  it("根组件挂载时接上监听：组件从不直接摸 window.mochen", () => {
    const app = scriptSource("App.vue");
    expect(app).toMatch(/onMounted\(\(\) =>\s*\{[\s\S]*?book\.listenQuitFlush\(\);/);
    expect(app).not.toContain("window.mochen.onQuitFlushRequest");
  });

  it("store 那一侧只接一次：重复装配就直接返回，不再订第二层", () => {
    const store = typeScriptSource("stores/useBookStore.ts");
    expect(store).toMatch(
      /listenQuitFlush\(\): void \{\s*\n\s*if \(this\.quitFlushListening\) return;/
    );
    expect(countListenerInstalls(store)).toBe(1);
  });
});

/** 接线语句在整份 store 里只许出现一次——出现两次就是两条回程、两遍落盘。 */
function countListenerInstalls(source: string): number {
  return (source.match(/installQuitFlushListener\(/g) ?? []).length;
}
