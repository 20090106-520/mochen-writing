import { describe, expect, it } from "vitest";
import {
  assistantToolMessage,
  chatMessage,
  toolMessage,
  type ChatMessage
} from "../src/chat-message.js";
import {
  HISTORY_TOKEN_BUDGET,
  UPSTREAM_WINDOW_TOKENS,
  buildBlocks,
  fitHistoryToWindow,
  foldOrphanUserMessages
} from "../src/history-window.js";

/**
 * 一条不含工具调用的普通消息。
 * content = `${tag}:${"字".repeat(len)}`，len 只算中文字数——ASCII 前缀按 estimateTokens
 * 的规则折进 1~2 tokens，切预算时按它算，别让"我以为 20 tok 一条"把用例算歪。
 */
function plain(role: "user" | "assistant", tag: string, len = 20): ChatMessage {
  return chatMessage(role, `${tag}:${"字".repeat(len)}`);
}

describe("fitHistoryToWindow · 基本分配", () => {
  it("空历史 ⇒ kept 空、dropped 0/0、keptTokens 0（不发虚警）", () => {
    const r = fitHistoryToWindow({ history: [], systemTokens: 100, userTokens: 50 });
    expect(r.kept).toEqual([]);
    expect(r.droppedCount).toBe(0);
    expect(r.droppedChars).toBe(0);
    expect(r.keptTokens).toBe(0);
  });

  it("预算宽裕时一条不丢：kept 与输入一字不差，droppedCount 为 0", () => {
    const history = [plain("user", "a"), plain("assistant", "b"), plain("user", "c")];
    const r = fitHistoryToWindow({ history, systemTokens: 10, userTokens: 10 });
    expect(r.kept).toEqual(history);
    expect(r.droppedCount).toBe(0);
    expect(r.keptTokens).toBeGreaterThan(0);
  });

  it("预算紧时从后往前留：最后那条一定在，最早那条一定不在", () => {
    const history = [plain("user", "1", 20), plain("assistant", "2", 20), plain("user", "3", 20)];
    // 每条 ~21 tok；预算给 42 tok = 只装得下最后两条。
    const r = fitHistoryToWindow({
      history,
      systemTokens: 0,
      userTokens: 0,
      budgetTokens: 42
    });
    expect(r.kept.length).toBeLessThan(history.length);
    expect(r.kept.at(-1)).toEqual(history[2]);
    expect(r.kept).not.toContainEqual(history[0]);
    expect(r.droppedCount).toBe(history.length - r.kept.length);
  });

  it("窗口扣减：系统 + 本轮用户 + 上下文包先扣，剩下的才是历史的额度；预留吃掉余额就整段丢", () => {
    const history = [plain("user", "a", 500), plain("assistant", "b", 500)];
    const r = fitHistoryToWindow({
      history,
      systemTokens: 20_000,
      userTokens: 20_000,
      contextPackTokens: 1_000,
      windowTokens: UPSTREAM_WINDOW_TOKENS
    });
    expect(r.kept).toEqual([]);
    expect(r.droppedCount).toBe(2);
    // droppedChars 是「大致字数」——不是 token，是字符数，界面写"约多少字"靠它。
    expect(r.droppedChars).toBeGreaterThan(1_000);
  });

  it("没给显式预算/窗口时按 HISTORY_TOKEN_BUDGET 分配（默认走保守档）", () => {
    const history = Array.from({ length: 30 }, (_, i) => plain("user", `x${i}`, 200));
    const r = fitHistoryToWindow({ history, systemTokens: 0, userTokens: 0 });
    // 30 条 x 200 字 ≈ 6030 tokens：默认档 6000 装不下全部，一定至少丢一条。
    expect(r.keptTokens).toBeLessThanOrEqual(HISTORY_TOKEN_BUDGET);
    expect(r.droppedCount).toBeGreaterThan(0);
  });
});

describe("fitHistoryToWindow · 硬条件", () => {
  it("系统消息永远保留：即便预算为 0，非系统消息一律丢；系统一条也不动", () => {
    const history = [
      chatMessage("system", "整本书的世界观".padEnd(10, "字")),
      plain("user", "u1", 200),
      plain("assistant", "a1", 200),
      plain("user", "u2", 200)
    ];
    const r = fitHistoryToWindow({
      history,
      systemTokens: 0,
      userTokens: 0,
      budgetTokens: 0
    });
    expect(r.kept.filter((m) => m.role === "system").length).toBe(1);
    expect(r.kept.filter((m) => m.role !== "system").length).toBe(0);
    expect(r.droppedCount).toBe(3);
  });

  it("系统消息在 kept 里排在最前，相对顺序与原历史一致（回放不许打乱）", () => {
    const s1 = chatMessage("system", "世界观");
    const s2 = chatMessage("system", "档案");
    const history = [
      s1,
      plain("user", "u1", 10),
      s2,
      plain("assistant", "a1", 10),
      plain("user", "u2", 10)
    ];
    const r = fitHistoryToWindow({
      history,
      systemTokens: 0,
      userTokens: 0,
      budgetTokens: 200
    });
    const systems = r.kept.filter((m) => m.role === "system");
    expect(systems.length).toBe(2);
    expect(r.kept.indexOf(s1)).toBe(0);
    // 两条 system 的原文先后不许颠倒
    expect(r.kept.indexOf(s1)).toBeLessThan(r.kept.indexOf(s2));
  });

  it("tool-call 与配对回执同进同出：预算为 0 时一条不留，绝不留半条 tool_call", () => {
    // 一次 assistant 派发两条 calls，两条 tool 回执跟在后面；预算 0 ⇒ 整块丢，
    // 而不是「只留两条 tool 让 assistant 悬空」——那一档上游直接 400。
    const head = assistantToolMessage("", [
      { id: "c1", name: "list_docs", args: "{}" },
      { id: "c2", name: "search_docs", args: '{"q":"雾"}' }
    ]);
    const t1 = toolMessage("c1", "回执一".repeat(20));
    const t2 = toolMessage("c2", "回执二".repeat(20));
    const tail = chatMessage("assistant", "x".repeat(4));
    const r = fitHistoryToWindow({
      history: [plain("user", "u0"), head, t1, t2, tail],
      systemTokens: 0,
      userTokens: 0,
      budgetTokens: 0
    });
    expect(r.kept).toEqual([]);
    expect(r.droppedCount).toBe(5);
  });

  it("tool-call 配对块：预算只够「回执」不够「发起」时整块一起丢，历史里绝不出现悬空 tool 回执", () => {
    const head = assistantToolMessage("给你两条", [
      { id: "c1", name: "list_docs", args: "{}" },
      { id: "c2", name: "search_docs", args: "{}" }
    ]);
    const t1 = toolMessage("c1", "回执一".repeat(30));
    const t2 = toolMessage("c2", "回执二".repeat(30));
    const tail = plain("assistant", "收尾", 20);
    const history = [head, t1, t2, tail];
    // 预算只够 tail 那一条（~23 tok），装不下 head+t1+t2 那一块（~186 tok）。
    const budget = 25;
    const r = fitHistoryToWindow({
      history,
      systemTokens: 0,
      userTokens: 0,
      budgetTokens: budget
    });
    const keptToolOnly = r.kept.filter((m) => m.role === "tool");
    const keptAssistantWithCalls = r.kept.filter(
      (m) => m.role === "assistant" && m.toolCalls.length > 0
    );
    // kept 里绝不允许「有 tool 回执但没有发起它的 assistant」——那是上游 400 的形状。
    if (keptToolOnly.length > 0) {
      expect(keptAssistantWithCalls.length).toBeGreaterThan(0);
    }
    expect(r.kept).toEqual([tail]);
    expect(r.droppedCount).toBe(3);
  });

  it("多轮 tool-call 配对：预算只装得下第二块时，第一块（更早的 assistant+回执）整体丢", () => {
    const head1 = assistantToolMessage("", [{ id: "c1", name: "list_docs", args: "{}" }]);
    const r1 = toolMessage("c1", "回执一".repeat(30));
    const head2 = assistantToolMessage("", [{ id: "c2", name: "search_docs", args: "{}" }]);
    const r2 = toolMessage("c2", "回执二".repeat(30));
    const history = [head1, r1, head2, r2];
    // 每块 ~91 tok；预算 100 只够最后那一条 tool 块。
    const r = fitHistoryToWindow({
      history,
      systemTokens: 0,
      userTokens: 0,
      budgetTokens: 100
    });
    expect(r.kept).toEqual([head2, r2]);
    expect(r.droppedCount).toBe(2);
  });

  it("droppedChars 如实：所有被丢的消息 content 长度之和（不含 kept 那部分）", () => {
    // plain 的 content 是 `${tag}:${20 字}`，两条 tag 各 1 字 ⇒ 每条 22 字。
    const history = [plain("user", "a", 20), plain("assistant", "b", 20), plain("user", "c", 20)];
    const r = fitHistoryToWindow({
      history,
      systemTokens: 0,
      userTokens: 0,
      budgetTokens: 25
    });
    // 最后一条（22 字 ≈ 21 tok）留下，前两条各 22 字丢掉 ⇒ 44 字。
    expect(r.kept.length).toBe(1);
    expect(r.droppedCount).toBe(2);
    expect(r.droppedChars).toBe(44);
  });

  it("孤儿 tool 回执（上面没有配对的 assistant-with-tool_calls）一定整块丢：留在历史里上游直接 400", () => {
    // 直接把这条挂进 buildBlocks 的判据里，而不是靠 fitHistoryToWindow 的贪心——
    // 贪心只保证「塞不下就丢」；孤儿就算预算宽裕也必须丢。
    const orphan = toolMessage("c-orphan", "无主回执".repeat(10));
    const ok = plain("user", "u1", 10);
    const r = fitHistoryToWindow({
      history: [orphan, ok],
      systemTokens: 0,
      userTokens: 0,
      budgetTokens: 5_000
    });
    expect(r.kept).toEqual([ok]);
    expect(r.droppedCount).toBe(1);
  });

  it("buildBlocks 把 assistant-with-toolCalls 与紧随其后的 tool 回执捆成一块", () => {
    const head = assistantToolMessage("", [{ id: "c1", name: "list_docs", args: "{}" }]);
    const t1 = toolMessage("c1", "回执");
    const blocks = buildBlocks([plain("user", "u0"), head, t1, plain("assistant", "a1")]);
    // 块 1 = u0；块 2 = head + t1（同进同出）；块 3 = a1。
    expect(blocks.map((b) => b.messages.length)).toEqual([1, 2, 1]);
  });
});

/**
 * P2-6：失败轮留下的孤儿 user。
 *
 * 缺陷原文是「user 消息在开流之前就落盘了」：那一轮随后失败（网络、超长、被打断之后报错），
 * 会话 JSONL 里就多一条**没有任何回答**的 user。用户把同一句再发一遍，
 * `eventsToMessages` 端出来的是 `user(q), user(q)`，同一句话向模型付两遍钱，
 * 而模型还会以为用户催了它两次。
 *
 * 修法只做一件事：把「紧接着又一条一模一样的 user」折成一条，末尾那条若与本轮正要发的
 * 这句相同也折掉（本轮的 user 由 runTurn 自己追加，见 tool-loop.ts:144/179）。
 * **不改 JSONL、不删磁盘上的一行**——判定只发生在发出去之前的那份内存历史里。
 */
describe("foldOrphanUserMessages · 同一句没答完的不发两遍（P2-6）", () => {
  const q = chatMessage("user", "把第三章的开头改短一点");

  it("末尾孤儿 + 本轮重发同一句 ⇒ 折掉那条孤儿，kept 里同一句只剩本轮那一次的机会", () => {
    const r = foldOrphanUserMessages({ history: [q], userText: q.content });
    expect(r.kept).toEqual([]);
    expect(r.foldedCount).toBe(1);
    expect(r.notice).toContain("上一轮");
  });

  it("连续两条相同的 user（前一轮失败留下的）⇒ 折成一条，顺序不变", () => {
    const r = foldOrphanUserMessages({
      history: [plain("assistant", "a0", 10), q, q, plain("assistant", "a1", 10)],
      userText: "换个问题"
    });
    expect(r.kept).toEqual([plain("assistant", "a0", 10), q, plain("assistant", "a1", 10)]);
    expect(r.foldedCount).toBe(1);
  });

  it("三连同一句 ⇒ 只留最后那一条（前两条都是没答完的重发）", () => {
    const r = foldOrphanUserMessages({ history: [q, q, q], userText: "换个问题" });
    expect(r.kept).toEqual([q]);
    expect(r.foldedCount).toBe(2);
  });

  it("末尾三条同一句、本轮又发同一句 ⇒ 全折：本轮那一次由 runTurn 追加", () => {
    const r = foldOrphanUserMessages({ history: [q, q, q], userText: q.content });
    expect(r.kept).toEqual([]);
    expect(r.foldedCount).toBe(3);
  });

  it("文本不同的相邻 user 一条都不折——（审批结果：…）这类合成 user 正是这一条", () => {
    const written = chatMessage("user", "（审批结果：已写入  chapters/03.md，原稿备份在 .）");
    const guidance = chatMessage("user", "（用户对上一条提案的意见：再短一点）");
    const history = [q, written, guidance];
    const r = foldOrphanUserMessages({ history, userText: "换个问题" });
    expect(r.kept).toEqual(history);
    expect(r.foldedCount).toBe(0);
    expect(r.notice).toBe("");
  });

  it("同一句但中间有回答 ⇒ 那是用户真的又问了一次，一条不许折", () => {
    const answered = [q, chatMessage("assistant", "这版短了。"), q];
    const r = foldOrphanUserMessages({ history: answered, userText: "换个问题" });
    expect(r.kept).toEqual(answered);
    expect(r.foldedCount).toBe(0);
    expect(r.notice).toBe("");
  });

  it("assistant 连续重复不属于本判据：只折 user，别的角色一条不动", () => {
    const a = chatMessage("assistant", "同样的回答");
    const r = foldOrphanUserMessages({ history: [a, a], userText: "换个问题" });
    expect(r.kept).toEqual([a, a]);
    expect(r.foldedCount).toBe(0);
  });

  it("无可折时 kept 与输入逐条相等且 notice 为空串（不发虚警）", () => {
    const history = [plain("user", "u1", 10), plain("assistant", "a1", 10)];
    const r = foldOrphanUserMessages({ history, userText: "u3" });
    expect(r.kept).toEqual(history);
    expect(r.foldedCount).toBe(0);
    expect(r.notice).toBe("");
  });

  it("只读入参：折的是副本，传进来的数组一条不少（会话历史的引用不许被改动）", () => {
    const history = [q, q];
    const r = foldOrphanUserMessages({ history, userText: q.content });
    expect(history.length).toBe(2);
    expect(r.kept).not.toBe(history);
    expect(r.kept).toEqual([]);
  });

  it("空白差异也算同一句（首尾空格是渲染层与落盘的常见落差，判据按 trim 后比）", () => {
    const padded = chatMessage("user", "  把第三章的开头改短一点  ");
    const r = foldOrphanUserMessages({ history: [padded], userText: q.content });
    expect(r.kept).toEqual([]);
    expect(r.foldedCount).toBe(1);
  });
});
