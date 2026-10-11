/**
 * 中栏订阅的挂载与退订（台账 `README.md:12` Plan 2 遗留那半条）。
 *
 * 病根不是「少了个 stopListening」这一行代码，而是**判据错位**：`startListening` 用一枚布尔
 * 当闸门，却把 preload 交回的退订函数丢在地上。preload 那一侧（`utils/vue-source-reader` 管不到，
 * 真身在 `preload/renderer-api.ts` 的 `createIpcOn`）注释写得很清楚——包装后的箭头必须用同一个引用
 * 交回 removeListener，否则监听器永久泄漏。布尔只决定「还要不要再注册」，它撤不掉已经注册的那一只。
 *
 * ⇒ 这一族用例的判据全部落在**监听集合本身**（`listeners.size`）与**推送能不能再进 store**，
 * 而不是落在「标志位现在是什么」。只复位布尔的实现在这里必须红：监听还挂着，size 仍是 1，
 * 下一条推送照样进 store。
 */
import { describe, expect, it, vi } from "vitest";
import { CH, api, eventOf, listeners, push, setupAgentFixture, store } from "./agent-store-fixture";

setupAgentFixture();

/** 装一条本轮开轮 + 一条真事件：退订是否生效，看这两条有没有改变 store 的线程态。 */
function pushATurn(): void {
  push({ type: "turn-start", turnId: "t1", threadKey: CH });
  // 必须用 `agentEventSchema` 认得出的类型：`apply` 开头有一道畸形推送守卫（`malformedPush`），
  // 编一个不存在的 type 会被正当拦掉，于是「推送进没进 store」这条判据就量不到了。
  push({
    type: "event",
    turnId: "t1",
    threadKey: CH,
    event: eventOf("message", { text: "夜色沉下去", interrupted: false })
  });
}

describe("useAgentStore 订阅 · 挂载", () => {
  it("重复挂载只注册一只监听（装配处多处调 startListening 不叠加）", () => {
    store().startListening();
    store().startListening();
    store().startListening();
    expect(listeners.size).toBe(1);
  });

  it("注册走 preload 的 onAgentEvent，载荷原样递给 apply", () => {
    // 夹具不 clearMocks，`api.onAgentEvent` 的调用数会跨用例留着——不复位就测不出「本用例注册了几次」。
    api.onAgentEvent.mockClear();
    store().startListening();
    pushATurn();
    expect(api.onAgentEvent).toHaveBeenCalledTimes(1);
    expect(store().threads[CH]?.turnId).toBe("t1");
    expect(store().threads[CH]?.running).toBe(true);
  });
});

describe("useAgentStore 订阅 · 退订", () => {
  it("stopListening 把监听从集合里撤干净，不是只把标志复位", () => {
    store().startListening();
    expect(listeners.size).toBe(1);
    store().stopListening();
    // 这一条是本族的总闸：实现只写 `this.listening = false` 时，listeners 里那只还在，size 仍是 1。
    expect(listeners.size).toBe(0);
  });

  it("退订调用的是 preload 交回的那只函数，而不是自己摘 listener", () => {
    // 一次性实现（`mockImplementationOnce`）：`vi.spyOn` 打在夹具那枚 `vi.fn` 上之后
    // `mockRestore` 还不回原实现，会污染后面每一条用例——本文件实测踩过。
    const disposer = vi.fn();
    api.onAgentEvent.mockImplementationOnce((listener) => {
      listeners.add(listener);
      return disposer;
    });
    store().startListening();
    store().stopListening();
    // 交回来的那只函数被调用一次：store 不认得 listener 本体，摘它只能凭这只函数。
    expect(disposer).toHaveBeenCalledTimes(1);
    // 而这只假 disposer **故意不删** listener ⇒ 集合里仍留着那一只。
    // 这一条钉的是「退订的唯一通路是 preload 交回的函数」：若实现改成自己去摸 listener 摘除，
    // 它摘不到（包装后的箭头不是原始引用），而 size 会仍是 1 —— 与上面那条 disposer 计数各管一半。
    expect(listeners.size).toBe(1);
    listeners.clear();
  });

  it("退订之后的推送一个字都不进 store", () => {
    store().startListening();
    store().stopListening();
    pushATurn();
    expect(store().threads[CH]).toBeUndefined();
  });

  it("退订幂等：没挂载过时调它不抛，之后照样能挂上", () => {
    expect(() => store().stopListening()).not.toThrow();
    expect(() => store().stopListening()).not.toThrow();
    store().startListening();
    expect(listeners.size).toBe(1);
    pushATurn();
    expect(store().threads[CH]?.running).toBe(true);
  });

  it("重挂载（组件卸载后再挂）注册的还是一只，不是累积的第二只", () => {
    // 这一条专门杀「布尔复位但没退订」那种写法：第二次 startListening 因标志已清而再注册一只，
    // 于是同一份推送被 apply 两遍——items 会成双，界面上每句话都出现两次。
    store().startListening();
    store().stopListening();
    store().startListening();
    expect(listeners.size).toBe(1);
    pushATurn();
    expect(store().threads[CH]?.items.length).toBe(1);
  });

  it("退订不影响其它线程的既有状态（只摘监听，不清线程）", () => {
    store().startListening();
    pushATurn();
    store().stopListening();
    expect(store().threads[CH]?.items.length).toBe(1);
    expect(store().threads[CH]?.running).toBe(true);
  });
});

/**
 * 这一组不是「退订能用」，而是**退订的代价**——它存在的理由是给我一开始那个错接法定量：
 * 我原先把 `agent.stopListening()` 接在了 `CenterColumn` 的 `onBeforeUnmount` 上，
 * 而设置中心整页化会把中栏卸载（`App.vue:133`），于是一轮在用户看设置的几秒里收尾时，
 * 那条 `turn-end` 就没有接收方了。后果不是「少刷新一次」，是这一轮**永远停在「进行中」**
 * （`running` 只有 turn-end 会清），而裁定 G3 那段「turn-end 到达即自动发队首下一条」也不再发生。
 * 判据因此反过来写：中栏卸载时不许摘（见 `center-column-listening-wiring.test.ts`）。
 */
describe("useAgentStore 订阅 · 摘监听会丢掉在途轮的收尾", () => {
  it("摘掉之后 turn-end 进不来：running 停在 true，重新挂上才收得掉", () => {
    store().startListening();
    push({ type: "turn-start", turnId: "t1", threadKey: CH });
    expect(store().threads[CH]?.running).toBe(true);

    store().stopListening();
    push({ type: "turn-end", turnId: "t1", threadKey: CH, status: "done", message: "" });
    expect(store().threads[CH]?.running).toBe(true);
    expect(store().threads[CH]?.turnId).toBe("t1");

    // 对照支：同一条推送在有监听时确实把这一轮收掉了——证明上面那个 true 是「没人接」，不是「收了但不清」。
    store().startListening();
    push({ type: "turn-end", turnId: "t1", threadKey: CH, status: "done", message: "" });
    expect(store().threads[CH]?.running).toBe(false);
    expect(store().threads[CH]?.turnId).toBeNull();
  });
});
