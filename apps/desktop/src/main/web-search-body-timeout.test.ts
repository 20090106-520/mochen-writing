/**
 * 「header 到了、body 卡住」这条路此前完全没有测试（2026-10-10）。
 *
 * **为什么单钉**：`web-search.test.ts` 里那个 `never()`（永不 resolve 的 fetch）
 * **只喂给不调用 fetch 的 stub 源**——真源里 `await response.text()` 那一段从没被喂过挂死的输入。
 *
 * 先量过一件与旧结论相反的事（`.mochen-tmp/p537/measure-body-timeout.cjs`，本地服务实测）：
 * `AbortSignal.timeout(6000)` **确实管得到读 body**——发完 header 就把 body 卡住，
 * 它在 6s 处以 AbortError 收场；不带 signal 才是真的永不 settle。
 * 所以根因不是「读 body 没有超时」，是**那次 AbortError 逃出了源自己的 try/catch**：
 * `await response.text()` 写在 `catch` 之外，源于是**抛异常**而不是返回一条失败回执，
 * 而 `runSourceChain` 的 `await source.run(...)` 外面也没有 try/catch
 * ⇒ 一个源抛出去，**后面的源根本没机会试**，冷却簿记也整段跳过。
 *
 * 这份钉的是源那一层的契约：**`run()` 返回 `SourceAttempt`，永不抛**。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  bingSource,
  duckduckgoSource,
  resetWebSearchState,
  so360Source,
  webSearch,
  type SourceAttempt,
  type WebFetchLike,
  type WebSearchSource
} from "./web-search.js";

/**
 * 「header 立刻回来、body 永远发不完」的那条路。
 * 与 `new Response("<html>…")` 的区别：那个 body 是**已备好**的，`text()` 立刻兑现；
 * 这个正对着真机上卡住的那一秒——服务端把 header 发了就不再往下写，连接一直开着。
 */
function stallsAfterHeaders(error: () => Error): WebFetchLike {
  return async () =>
    ({
      ok: true,
      status: 200,
      text: () => Promise.reject(error())
    }) as unknown as Response;
}

function abortError(): Error {
  const e = new Error("The operation was aborted due to timeout");
  e.name = "AbortError";
  return e;
}

function timeoutError(): Error {
  const e = new Error("The operation was aborted due to timeout");
  e.name = "TimeoutError";
  return e;
}

const BUILTINS = [
  { name: "DuckDuckGo", src: duckduckgoSource },
  { name: "360 搜索", src: so360Source },
  { name: "必应", src: bingSource }
];

beforeEach(() => {
  resetWebSearchState();
});

describe("源这一层：读 body 卡住时**返回**失败回执，不抛", () => {
  for (const { name, src } of BUILTINS) {
    it(`${name}：body 读超时 → reason=network、message=连接超时`, async () => {
      const attempt = await src.run("深海", stallsAfterHeaders(abortError));
      expect(attempt, `${name} 抛异常而不是返回回执`).not.toBeUndefined();
      expect(attempt.ok).toBe(false);
      expect(attempt.ok === false && attempt.reason).toBe("network");
      expect(attempt.ok === false && attempt.message).toBe("连接超时");
    });

    it(`${name}：TimeoutError 同样归「连接超时」（网络错误的两副面孔都要认）`, async () => {
      const attempt = await src.run("深海", stallsAfterHeaders(timeoutError));
      expect(attempt.ok).toBe(false);
      expect(attempt.ok === false && attempt.message).toBe("连接超时");
    });
  }
});

describe("源链：一个源抛异常不掐断整条链", () => {
  it("第一个源在读 body 时抛异常，第二个源仍会被试到", async () => {
    const seen: string[] = [];
    const throwing: WebSearchSource = {
      id: "boom",
      label: "boom",
      run: async () => {
        seen.push("boom");
        throw new Error("body 卡住了");
      }
    };
    const backup: WebSearchSource = {
      id: "backup",
      label: "backup",
      run: async () => {
        seen.push("backup");
        return {
          ok: true,
          results: [{ title: "t", url: "https://a/1", snippet: "s" }]
        } satisfies SourceAttempt;
      }
    };
    const outcome = await webSearch("深海", {
      now: () => 0,
      fetchImpl: (() => Promise.reject(new Error("不该被调到"))) as WebFetchLike,
      sources: [throwing, backup]
    });
    expect(seen, "抛异常的源把后面的源掐掉了").toEqual(["boom", "backup"]);
    expect(outcome.sourceId).toBe("backup");
  });

  it("抛异常的源照样进冷却簿记（它确实坏了，不是「什么都没试」）", async () => {
    const now = 0;
    let tries = 0;
    const throwing: WebSearchSource = {
      id: "boom",
      label: "boom",
      run: async () => {
        tries += 1;
        throw new Error("body 卡住了");
      }
    };
    const run = () =>
      webSearch("深海", {
        now: () => now,
        fetchImpl: (() => Promise.reject(new Error("不该被调到"))) as WebFetchLike,
        sources: [throwing]
      });

    await expect(run()).rejects.toThrow();
    expect(tries, "第一轮应当真试一次").toBe(1);
    // 没进冷却的话第二轮还会再试一次——那正是「连着撞墙」的形状。
    await expect(run()).rejects.toThrow();
    expect(tries, "抛异常的源没有被记进冷却，第二轮又撞了一次").toBe(1);
  });

  it("抛出来的错误信息要落进「用不了」那句话里，而不是裸奔出去", async () => {
    const throwing: WebSearchSource = {
      id: "boom",
      label: "boom",
      run: async () => {
        throw new Error("body 卡住了");
      }
    };
    await expect(
      webSearch("深海", {
        now: () => 0,
        fetchImpl: (() => Promise.reject(new Error("不该被调到"))) as WebFetchLike,
        sources: [throwing]
      })
    ).rejects.toThrow(/boom/);
  });
});
