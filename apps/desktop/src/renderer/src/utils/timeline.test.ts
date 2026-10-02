import { describe, expect, it } from "vitest";
import type { AgentEvent, ProposalStatus } from "@mochen/contracts";
import {
  buildTimeline,
  cardTurnLabel,
  replayProposalStatuses,
  splitProposalCards,
  turnAnchors,
  TOOL_LABELS
} from "./timeline";

function event(type: AgentEvent["type"], rest: Record<string, unknown> = {}): AgentEvent {
  return {
    id: `e-${type}`,
    ts: "2026-10-01T00:00:00.000Z",
    turnId: "t1",
    type,
    ...rest
  } as AgentEvent;
}

/** 同上，但显式指定轮次：F-1 的轮次锚点要跨轮排布。 */
function turnEvent(
  type: AgentEvent["type"],
  turnId: string,
  rest: Record<string, unknown> = {}
): AgentEvent {
  return event(type, { turnId, ...rest });
}

/** splitProposalCards 只用到这三个字段，测试用最小形状而不是整份 EditProposal。 */
function cardOf(id: string, turnId: string, createdAt: string, status: ProposalStatus) {
  return { proposal: { id, turnId, createdAt }, status };
}

const NO_TAIL = { reasoning: "", message: "" };

describe("buildTimeline", () => {
  it("用户消息单独一层，排在最前", () => {
    const blocks = buildTimeline([event("user-message", { text: "把这段改得有雾气" })], NO_TAIL);
    expect(blocks).toEqual([{ kind: "user", id: "e-user-message", text: "把这段改得有雾气" }]);
  });

  it("思考与正文按到达顺序成层，打断标记保留", () => {
    const blocks = buildTimeline(
      [
        event("reasoning", { text: "先读前后文", interrupted: false }),
        event("message", { text: "海雾涌上来。", interrupted: true })
      ],
      NO_TAIL
    );
    expect(blocks.map((block) => block.kind)).toEqual(["thinking", "message"]);
    expect(blocks[1]).toMatchObject({ text: "海雾涌上来。", interrupted: true, streaming: false });
  });

  it("提案/裁决/写入不进时间线——它们只活在提案卡上", () => {
    const blocks = buildTimeline(
      [
        event("proposal", { proposal: {} }),
        event("decision", { proposalId: "p1", decision: "accept-once", guidance: "", auto: false }),
        event("written", {
          proposalId: "p1",
          docRelPath: "a.md",
          fingerprint: "fp",
          backupRelPath: null
        })
      ],
      NO_TAIL
    );
    expect(blocks).toEqual([]);
  });

  it("连续 plan 事件合并成一块，以最后一份清单为准", () => {
    const blocks = buildTimeline(
      [
        event("plan", { items: [{ text: "读上下文", done: true }] }),
        event("plan", {
          items: [
            { text: "读上下文", done: true },
            { text: "改第三段", done: false }
          ]
        })
      ],
      NO_TAIL
    );
    expect(blocks.length).toBe(1);
    expect(blocks[0]).toMatchObject({
      kind: "plan",
      items: [
        { text: "读上下文", done: true },
        { text: "改第三段", done: false }
      ]
    });
  });

  it("plan 被正文隔开后不再合并，两份清单各自成块", () => {
    const blocks = buildTimeline(
      [
        event("plan", { items: [{ text: "甲", done: false }] }),
        event("message", { text: "先说一句", interrupted: false }),
        event("plan", { items: [{ text: "乙", done: false }] })
      ],
      NO_TAIL
    );
    expect(blocks.map((block) => block.kind)).toEqual(["plan", "message", "plan"]);
  });

  it("工具调用成卡：中文名、入参、失败也保留结果文本", () => {
    const blocks = buildTimeline(
      [
        event("tool-call", {
          callId: "c1",
          tool: "search_docs",
          args: '{"query":"雾"}',
          ok: false,
          resultText: "锚点不唯一"
        })
      ],
      NO_TAIL
    );
    expect(blocks[0]).toEqual({
      kind: "tool",
      id: "e-tool-call",
      label: TOOL_LABELS.search_docs,
      args: '{"query":"雾"}',
      ok: false,
      resultText: "锚点不唯一"
    });
    expect(TOOL_LABELS.search_docs).toBe("全书检索");
  });

  it("未知工具名退回原始名：IPC 闸门不校验 tool，标签不许是 undefined", () => {
    const blocks = buildTimeline(
      [
        event("tool-call", {
          callId: "c9",
          tool: "delete_everything",
          args: "{}",
          ok: true,
          resultText: ""
        })
      ],
      NO_TAIL
    );
    expect(blocks[0]).toMatchObject({ kind: "tool", label: "delete_everything" });
  });

  it("错误与打断各自成块，打断块带待审计数", () => {
    const blocks = buildTimeline(
      [
        event("error", { message: "模型服务端返回 503：繁忙" }),
        event("interrupted", { pendingProposals: 2 })
      ],
      NO_TAIL
    );
    expect(blocks[0]).toEqual({ kind: "error", id: "e-error", text: "模型服务端返回 503：繁忙" });
    expect(blocks[1]).toEqual({ kind: "interrupted", id: "e-interrupted", pending: 2 });
  });

  it("流式残字只在非空时出现，且永远排在末尾", () => {
    const blocks = buildTimeline([event("message", { text: "定稿", interrupted: false })], {
      reasoning: "   ",
      message: "正在写"
    });
    expect(blocks.map((block) => block.kind)).toEqual(["message", "message"]);
    expect(blocks[1]).toMatchObject({ streaming: true, text: "正在写" });
    expect(buildTimeline([], { reasoning: "在想", message: "" })).toEqual([
      { kind: "thinking", id: "tail-thinking", text: "在想", streaming: true, interrupted: false }
    ]);
    // 纯空白的正文残字也不成块：上面那条只钉住了 reasoning 侧的空串判定，message 侧要单独钉。
    expect(buildTimeline([], { reasoning: "", message: "  " })).toEqual([]);
  });

  it("块 id 不重复：v-for 的 key 撞车就是渲染错位", () => {
    const blocks = buildTimeline(
      [
        event("user-message", { text: "甲" }),
        event("reasoning", { text: "乙", interrupted: false }),
        event("tool-call", { callId: "c1", tool: "read_doc", args: "{}", ok: true, resultText: "" })
      ],
      { reasoning: "丙", message: "丁" }
    );
    expect(new Set(blocks.map((block) => block.id)).size).toBe(blocks.length);
  });
});

describe("turnAnchors（F-1：卡要认得自己属于哪一轮）", () => {
  it("按轮次出现顺序编号；userText 取该轮第一条 user-message；该轮没有 user-message 即无锚点", () => {
    const anchors = turnAnchors([
      turnEvent("user-message", "tA", { text: "收紧比喻" }),
      turnEvent("proposal", "tA", { proposal: {} }),
      turnEvent("tool-call", "tB", {
        callId: "c1",
        tool: "read_doc",
        args: "{}",
        ok: true,
        resultText: ""
      }),
      turnEvent("user-message", "tC", { text: "再来一次" }),
      turnEvent("user-message", "tC", { text: "同一轮的第二条不算" })
    ]);
    expect(anchors["tA"]).toEqual({ index: 1, userText: "收紧比喻" });
    // tB 只有工具卡、没有 user-message（历史重建时会这样）⇒ 刻意不立锚点，让卡退回「本轮」。
    expect(anchors["tB"]).toBeUndefined();
    // 编号数的是**线程内的第几轮**（中间没锚点的轮次照样占号），不是「第几条提问」。
    expect(anchors["tC"]).toEqual({ index: 3, userText: "再来一次" });
  });

  it("空事件表得到空锚点表，不抛异常", () => {
    expect(turnAnchors([])).toEqual({});
  });
});

describe("cardTurnLabel（F-1：卡上必须有可读标签，绝不空串）", () => {
  it("三种取值：有提问原文 / 原文为空 / 锚点表里查不到", () => {
    const anchors = {
      t1: { index: 1, userText: "收紧比喻" },
      t2: { index: 2, userText: "" }
    };
    expect(cardTurnLabel(anchors, "t1")).toBe("第 1 轮 · 收紧比喻");
    expect(cardTurnLabel(anchors, "t2")).toBe("第 2 轮");
    expect(cardTurnLabel(anchors, "t9")).toBe("本轮");
  });

  it("提问原文里的换行压成空格，不撑破卡头", () => {
    const label = cardTurnLabel({ t3: { index: 3, userText: "把这段\n改得有雾气" } }, "t3");
    expect(label).toBe("第 3 轮 · 把这段 改得有雾气");
  });

  it("提问原文超过 24 字：截到 24 字并加省略号，截掉的字节一个不漏回来", () => {
    // 40 个互不相同的汉字：这样 toBe 同时钉住了「截断长度」与「省略号位置」，
    // 写成 toContain 就守不住（把 24 改成 30 也照样绿）。
    const hanzi = Array.from({ length: 40 }, (_u, index) => String.fromCharCode(0x4e00 + index));
    const label = cardTurnLabel({ t1: { index: 1, userText: hanzi.join("") } }, "t1");
    expect(label).toBe(`第 1 轮 · ${hanzi.slice(0, 24).join("")}…`);
    for (const ch of hanzi.slice(24)) expect(label).not.toContain(ch);
  });

  it("提问原文含 emoji（代理对）：按码点截断，绝不把代理对劈成孤立高代理", () => {
    // 23 个 BMP 汉字占满前 23 个 UTF-16 码元，第 24 个码元起是一个 emoji（占两个码元）。
    // 按码元 slice(0,24) 会只留 emoji 的高代理项孤零零挂在串尾（渲染成豆腐块 + 省略号前坏字符）。
    const before = Array.from({ length: 23 }, (_u, index) =>
      String.fromCharCode(0x4e00 + index)
    ).join("");
    const pair = String.fromCodePoint(0x1f600); // 😀：UTF-16 需 \uD83D\uDE00 两个码元
    const userText = `${before}${pair}尾巴`;
    const label = cardTurnLabel({ t1: { index: 1, userText } }, "t1");
    // 串尾不许出现没有配对低代理的孤立高代理项。
    expect(label).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    // 期望串按码点数：前 24 个码点 = 23 个 BMP 汉字 + 整个 emoji。
    const points = Array.from(userText);
    expect(label).toBe(`第 1 轮 · ${points.slice(0, 24).join("")}…`);
  });

  it("纯空白的提问原文按空处理，返回「第 N 轮」而不是「第 N 轮 · 」", () => {
    expect(cardTurnLabel({ t4: { index: 4, userText: "  \n  " } }, "t4")).toBe("第 4 轮");
  });

  it("串起来：标签直接吃 turnAnchors 的输出，两半对得上接口（卡头不许出现空标签）", () => {
    const anchors = turnAnchors([
      turnEvent("user-message", "tA", { text: "收紧比喻" }),
      turnEvent("tool-call", "tB", {
        callId: "c1",
        tool: "read_doc",
        args: "{}",
        ok: true,
        resultText: ""
      })
    ]);
    expect(cardTurnLabel(anchors, "tA")).toBe("第 1 轮 · 收紧比喻");
    expect(cardTurnLabel(anchors, "tB")).toBe("本轮");
    // 同一张锚点表也要能直接喂给分组排序：轮次乱的输入按轮次排好。
    const split = splitProposalCards(
      [
        cardOf("pB", "tB", "2026-10-01T00:01:00.000Z", "pending"),
        cardOf("pA", "tA", "2026-10-01T00:02:00.000Z", "pending")
      ],
      anchors
    );
    expect(split.open.map((item) => item.proposal.id)).toEqual(["pA", "pB"]);
  });

  it("原型键不是锚点：turnAnchors 空表查 toString 退回「本轮」而不是撞 Object.prototype", () => {
    // 查询键落在 Object.prototype 上（toString/valueOf/constructor），若 anchors 用普通 {}，
    // anchors["toString"] 会取到函数而非 undefined，cardTurnLabel 对函数取 .userText.replace 当场抛 TypeError。
    expect(cardTurnLabel(turnAnchors([]), "toString")).toBe("本轮");
  });

  it("同形原型键（valueOf）也退回「本轮」：证明这不是单点补丁", () => {
    const anchors = turnAnchors([turnEvent("user-message", "tA", { text: "甲" })]);
    expect(cardTurnLabel(anchors, "valueOf")).toBe("本轮");
    expect(cardTurnLabel(anchors, "constructor")).toBe("本轮");
  });
});

describe("splitProposalCards（F-1：已裁决的卡收进折叠分组）", () => {
  const ANCHORS = {
    tA: { index: 1, userText: "甲" },
    tB: { index: 2, userText: "乙" }
  };

  it("混排五张卡：分组正确，两组都按轮次升序、同轮按 createdAt 升序，无锚点排最后", () => {
    const split = splitProposalCards(
      [
        cardOf("pB2", "tB", "2026-10-01T00:03:00.000Z", "pending"),
        cardOf("pZ1", "tZ", "2026-10-01T00:00:10.000Z", "pending"),
        cardOf("pB1", "tB", "2026-10-01T00:01:00.000Z", "pending"),
        cardOf("pOld", "tZ", "2026-10-01T00:00:30.000Z", "written"),
        cardOf("pA1", "tA", "2026-10-01T00:02:00.000Z", "rejected")
      ],
      ANCHORS
    );
    // 比整数组而不是长度：只断言长度时把排序整段删掉也照样绿。
    expect(split.open.map((item) => item.proposal.id)).toEqual(["pB1", "pB2", "pZ1"]);
    expect(split.settled.map((item) => item.proposal.id)).toEqual(["pA1", "pOld"]);
  });

  it("同轮同 createdAt 的多张卡保持插入序：稳定排序契约不许被并列分支打乱", () => {
    // 三卡同轮同刻：轮次键与 createdAt 键都相等，比较器走 `return 0` 短路，
    // 靠 Array.prototype.sort 的稳定性（ES2019 起强制）保住插入序 = 输入序。
    // 这条把「相等 ⇒ 保持输入序」写成语义断言：并列分支若改成非零（判前后），插入序会被打乱。
    const same = "2026-10-01T00:05:00.000Z";
    const split = splitProposalCards(
      [
        cardOf("pX", "tA", same, "pending"),
        cardOf("pY", "tA", same, "pending"),
        cardOf("pZ", "tA", same, "pending")
      ],
      ANCHORS
    );
    expect(split.open.map((item) => item.proposal.id)).toEqual(["pX", "pY", "pZ"]);
  });

  it("只有 pending 才算待审：stale / cancelled / failed 一律进已裁决组", () => {
    // createdAt 与书写顺序刻意错开：书写序 = 插入序，已裁决组的期望序按时间戳升序写，
    // 这样「删掉同轮内的 createdAt 次级键」（比较器对同轮恒返回 0 ⇒ 退回插入序）会让这条转红。
    const split = splitProposalCards(
      [
        cardOf("s1", "tA", "2026-10-01T00:04:00.000Z", "stale"),
        cardOf("c1", "tA", "2026-10-01T00:01:00.000Z", "cancelled"),
        cardOf("f1", "tA", "2026-10-01T00:03:00.000Z", "failed"),
        cardOf("w1", "tA", "2026-10-01T00:02:00.000Z", "written"),
        cardOf("p1", "tA", "2026-10-01T00:05:00.000Z", "pending")
      ],
      ANCHORS
    );
    expect(split.open.map((item) => item.proposal.id)).toEqual(["p1"]);
    expect(split.settled.map((item) => item.proposal.id)).toEqual(["c1", "w1", "f1", "s1"]);
  });

  it("空输入两组皆空，CenterColumn 的空状态判断要用这两个长度", () => {
    expect(splitProposalCards([], ANCHORS)).toEqual({ open: [], settled: [], expired: [] });
  });

  it("不许就地改传入数组：排序要发生在新数组里，否则 Vue 的 computed 会自我失效", () => {
    const cards = [
      cardOf("pB2", "tB", "2026-10-01T00:03:00.000Z", "pending"),
      cardOf("pA1", "tA", "2026-10-01T00:01:00.000Z", "pending")
    ];
    splitProposalCards(cards, ANCHORS);
    expect(cards.map((item) => item.proposal.id)).toEqual(["pB2", "pA1"]);
  });
});

describe("splitProposalCards 第三组 expired（D1）", () => {
  const ANCHORS = { tA: { index: 1, userText: "甲" } };
  it("expired 不进 open 也不进 settled——把它塞进已裁决组是假话", () => {
    const split = splitProposalCards(
      [
        cardOf("p1", "tA", "2026-10-01T00:01:00.000Z", "pending"),
        cardOf("p2", "tA", "2026-10-01T00:02:00.000Z", "expired"),
        cardOf("p3", "tA", "2026-10-01T00:03:00.000Z", "written")
      ],
      ANCHORS
    );
    expect(split.open.map((c) => c.proposal.id)).toEqual(["p1"]);
    expect(split.expired.map((c) => c.proposal.id)).toEqual(["p2"]);
    expect(split.settled.map((c) => c.proposal.id)).toEqual(["p3"]);
  });
});

describe("replayProposalStatuses（回放派生扫描）", () => {
  it("未配对的 proposal 给 expired；有 decision/written 的给对应已裁决态", () => {
    const events: AgentEvent[] = [
      event("proposal", { proposal: { id: "pOpen" } }),
      event("proposal", { proposal: { id: "pCancel" } }),
      event("decision", { proposalId: "pCancel", decision: "cancel", guidance: "", auto: false }),
      event("proposal", { proposal: { id: "pDeny" } }),
      event("decision", {
        proposalId: "pDeny",
        decision: "deny-with-guidance",
        guidance: "别动",
        auto: false
      }),
      event("proposal", { proposal: { id: "pWrite" } }),
      event("decision", {
        proposalId: "pWrite",
        decision: "accept-once",
        guidance: "",
        auto: false
      }),
      event("written", {
        proposalId: "pWrite",
        docRelPath: "chapters/01.md",
        fingerprint: "b".repeat(64),
        backupRelPath: null
      })
    ];
    expect(replayProposalStatuses(events)).toEqual({
      pOpen: "expired",
      pCancel: "cancelled",
      pDeny: "rejected",
      pWrite: "written"
    });
  });

  it("accept 落了 decision 却没有 written ⇒ 判 failed（写没成， settled 而非 expired）", () => {
    const events: AgentEvent[] = [
      event("proposal", { proposal: { id: "p" } }),
      event("decision", { proposalId: "p", decision: "accept-session", guidance: "", auto: true })
    ];
    expect(replayProposalStatuses(events)).toEqual({ p: "failed" });
  });
});
