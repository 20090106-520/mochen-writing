import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@mochen/contracts";
import { composeStatusReport, malformedPush, newThread, plainList } from "./agent-thread";

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

/**
 * `/status` 报告里的用量行（2026-10-15）。
 *
 * 用量那一行由 `sessionUsageText(thread.items)` 组好塞进 parts，**空串即跳过**——
 * 没提问也没回报时不硬凑一句。这里钉「有数才出现、没数不出现」这条边界。
 */
describe("composeStatusReport · 用量行（2026-10-15）", () => {
  const TS = "2026-10-01T08:00:00.000Z";

  function factsWith(items: AgentEvent[]): Parameters<typeof composeStatusReport>[0] {
    return {
      threadKey: "chapters/01.md",
      thread: { ...newThread(), items },
      cards: 0,
      pending: 0,
      hasBook: true,
      permissionMode: "read-only",
      stageName: "初稿"
    };
  }

  it("有提问且有回报 ⇒ 报告里带「用量：N 轮里 M 轮有上游回报」", () => {
    const report = composeStatusReport(
      factsWith([
        { id: "u1", ts: TS, turnId: "t1", type: "user-message", text: "写" },
        {
          id: "s1",
          ts: TS,
          turnId: "t1",
          type: "usage",
          requests: 1,
          reported: 1,
          promptTokens: 120,
          completionTokens: 30,
          totalTokens: 150
        }
      ])
    );
    expect(report).toContain("用量：1 轮里 1 轮有上游回报，输入 120 · 输出 30 · 合计 150 Token");
  });

  it("没有任何事件 ⇒ 报告里不出现「用量」那一行（空串跳过）", () => {
    expect(composeStatusReport(factsWith([]))).not.toContain("用量");
  });

  it("有提问但一次都没报 ⇒ 明说「还没回报过」，不静默吞掉", () => {
    const report = composeStatusReport(
      factsWith([{ id: "u1", ts: TS, turnId: "t1", type: "user-message", text: "写" }])
    );
    expect(report).toContain("用量：还没有上游回报过（本会话 1 轮都没报）。");
  });
});

/**
 * 形状闸门对候选集的判定（P0-②）。preload 的 `onAgentEvent` 只做 `payload as AgentOutbound`，
 * 运行时一字未校验，所以 `candidates` 缺了列表 / 句柄都会在下游被当成一条正常的推送归约掉——
 * 前者会让面板长出一格没有稿的空面板，后者会让「用这一稿」按钮发出一个指不到集的句柄。
 * 这里钉的是：两种畸形各自报出**看得懂的那句中文**，形状齐了才放行。
 */
describe("malformedPush · 候选集形状（P0-②）", () => {
  const base = { type: "candidates", threadKey: "chapters/01-a.md", turnId: "t1" };

  it("缺 draftSetId（或空串）⇒ 报「缺集标识」，挡在归约之外", () => {
    expect(malformedPush({ ...base, drafts: [] })).toBe("候选集缺少集标识");
    expect(malformedPush({ ...base, draftSetId: "", drafts: [] })).toBe("候选集缺少集标识");
  });

  it("drafts 不是数组（或整格缺了）⇒ 报「缺稿件列表」", () => {
    expect(malformedPush({ ...base, draftSetId: "s1", drafts: "不是数组" })).toBe(
      "候选集缺少稿件列表"
    );
    expect(malformedPush({ ...base, draftSetId: "s1" })).toBe("候选集缺少稿件列表");
  });

  it("形状齐了 ⇒ 空串（可安全归约）；空数组也算齐——形状闸门只管形状，不管跑出了几稿", () => {
    expect(malformedPush({ ...base, draftSetId: "s1", drafts: [] })).toBe("");
  });
});
