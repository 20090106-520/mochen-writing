import { describe, expect, it } from "vitest";
import { plainList } from "./agent-thread";

/**
 * `plainList` 的判据就是**结构化克隆过得去**。
 *
 * 不写 `toBeInstanceOf(Array)` 那种同义反复的断言：Vue 的响应式 Proxy
 * 对 `Array.isArray` 和逐项读取都照常应答，只有结构化克隆会拒它——
 * 而那恰恰是 `contextBridge` 在进 preload 之前对实参做的事。
 * 所以这里直接用 `structuredClone` 当那道闸：它在 Node 里抛的是
 * `DataCloneError`，与真机 `An object could not be cloned.` 同一个机制。
 */
describe("plainList", () => {
  it("吃下响应式 Proxy：出来的这份克隆得过去（原样递的那份过不去）", () => {
    const reactive = new Proxy(["a", "b"], {}) as string[];

    // 先钉住前提本身：不经摊平直接克隆，Proxy 会被拒。
    // 哪天这句话不成立了，说明环境本身换了，本文件下面几条的证明力都要重估。
    expect(() => structuredClone(reactive)).toThrow();

    const out = plainList(reactive);
    expect(out).not.toBe(reactive);
    expect(Array.isArray(out)).toBe(true);
    expect(out).toEqual(["a", "b"]);
    expect(() => structuredClone(out)).not.toThrow();
  });

  it("是拷贝而不是搬运：改原件不动结果，改结果也不动原件", () => {
    const src = ["a"];
    const out = plainList(src);

    out.push("b");
    expect(src).toEqual(["a"]);
    expect(out).toEqual(["a", "b"]);
  });

  it("空名单也摊成普通空数组（空 Proxy 同样没有内部槽）", () => {
    const out = plainList(new Proxy([] as string[], {}));

    expect(Array.isArray(out)).toBe(true);
    expect(out).toEqual([]);
    expect(() => structuredClone(out)).not.toThrow();
  });

  it("只拷一层，不改元素本身：这里只是把数组摊平，不是深拷贝", () => {
    const item = { relPath: "skills/a.md" };
    const out = plainList([item]);

    expect(out[0]).toBe(item);
  });
});
