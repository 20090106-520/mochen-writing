import { describe, expect, it } from "vitest";
import {
  AGENT_EVENT_TYPES,
  AGENT_TOOL_NAMES,
  NETWORK_TOOL_NAMES,
  isNetworkTool,
  agentEventSchema,
  decideInputSchema,
  editProposalSchema,
  isWriteTool,
  maskApiKey,
  PROPOSAL_STATUSES,
  PROPOSAL_STATUS_LABELS,
  connectionDraftSchema,
  sessionListItemSchema,
  sessionLoadResultSchema,
  sessionMetaSchema,
  WRITE_TOOLS,
  type WriteToolName
} from "../src/index.js";

const proposal = {
  id: "p1",
  threadKey: "chapters/01-开局.md",
  turnId: "t1",
  docRelPath: "chapters/01-开局.md",
  mode: "anchor-replace",
  anchor: "雾从海面涌上来。",
  replace: "雾从海面涌上来，把闸门的铁锈都舔黑了。",
  why: "补一句环境，承接上一章的闸门意象",
  tool: "propose_patch",
  source: "tool-call",
  expectedFingerprint: "a".repeat(64),
  createdAt: "2026-10-01T08:00:00.000Z"
};

describe("editProposalSchema", () => {
  it("接受带线程/工具/指纹的提案", () => {
    expect(editProposalSchema.parse(proposal)).toEqual(proposal);
  });

  it("缺 expectedFingerprint 时拒绝——没有指纹就没有冲突检测", () => {
    const rest: Record<string, unknown> = { ...proposal };
    delete rest.expectedFingerprint;
    expect(editProposalSchema.safeParse(rest).success).toBe(false);
  });

  it("工具名不在五个之内时拒绝", () => {
    expect(editProposalSchema.safeParse({ ...proposal, tool: "delete_book" }).success).toBe(false);
  });
});

describe("agentEventSchema", () => {
  it("十类事件各自能解析，未知 type 拒绝", () => {
    const base = { id: "e1", ts: "2026-10-01T08:00:00.000Z", turnId: "t1" };
    const cases: Record<string, unknown>[] = [
      { ...base, type: "user-message", text: "把这段改紧一点" },
      { ...base, type: "reasoning", text: "先看闸门那段", interrupted: false },
      { ...base, type: "plan", items: [{ text: "读当前章", done: true }] },
      { ...base, type: "message", text: "已生成一条提案", interrupted: false },
      {
        ...base,
        type: "tool-call",
        callId: "c1",
        tool: "read_doc",
        args: "{}",
        ok: true,
        resultText: "正文…"
      },
      { ...base, type: "proposal", proposal },
      {
        ...base,
        type: "decision",
        proposalId: "p1",
        decision: "accept-once",
        guidance: "",
        auto: false
      },
      {
        ...base,
        type: "written",
        proposalId: "p1",
        docRelPath: proposal.docRelPath,
        fingerprint: "b".repeat(64),
        backupRelPath: null
      },
      { ...base, type: "interrupted", pendingProposals: 2 },
      { ...base, type: "error", message: "无法连接模型服务端" }
    ];
    for (const item of cases) {
      expect(agentEventSchema.safeParse(item).success).toBe(true);
    }
    expect(agentEventSchema.safeParse({ ...base, type: "ghost" }).success).toBe(false);
  });

  it("written 事件必须带 fingerprint（渲染层要据此更新已存指纹）", () => {
    const base = { id: "e1", ts: "2026-10-01T08:00:00.000Z", turnId: "t1" };
    expect(
      agentEventSchema.safeParse({ ...base, type: "written", proposalId: "p1", docRelPath: "x" })
        .success
    ).toBe(false);
  });

  // 计划正文的变异实验要求删掉 decision 分支的 auto 必须转红；zod 会剥掉未声明的键，
  // 只断言 safeParse().success 拦不住这种删字段，所以这里断言解析结果真的留住了 auto。
  it("decision 事件必须留住 auto 字段（自动批准与手点裁决的唯一区分）", () => {
    const base = { id: "e1", ts: "2026-10-01T08:00:00.000Z", turnId: "t1" };
    const parsed = agentEventSchema.parse({
      ...base,
      type: "decision",
      proposalId: "p1",
      decision: "accept-session",
      guidance: "",
      auto: true
    });
    if (parsed.type !== "decision") throw new Error("decision 事件未被解析为 decision");
    expect(parsed.auto).toBe(true);
  });
});

describe("sessionMetaSchema", () => {
  it("首行元数据带线程绑定的文稿与模型", () => {
    const meta = {
      type: "session-meta",
      sessionId: "s1",
      docRelPath: "chapters/01-开局.md",
      stageId: "draft",
      model: "qwen3:14b",
      startedAt: "2026-10-01T08:00:00.000Z"
    };
    expect(sessionMetaSchema.parse(meta)).toEqual(meta);
  });
});

describe("decideInputSchema", () => {
  it("拒绝并说明时必须给出说明（对应 Codex 的 differently）", () => {
    expect(
      decideInputSchema.safeParse({
        proposalId: "p1",
        decision: "deny-with-guidance",
        guidance: "  "
      }).success
    ).toBe(false);
    expect(
      decideInputSchema.safeParse({
        proposalId: "p1",
        decision: "deny-with-guidance",
        guidance: "别动第一段"
      }).success
    ).toBe(true);
  });
});

describe("provider 与掩码", () => {
  it("baseURL 必须是 http(s) 绝对地址，密钥不进 URL", () => {
    // 2026-10-06 批次 5-⑤：草稿拆成两条——连接草稿（地址 + 密钥 + 头形态）与
    // 档案草稿（模型名挂哪条连接）。地址这一段的判据搬到了 connectionDraftSchema。
    expect(
      connectionDraftSchema.safeParse({
        providerId: "custom",
        baseURL: "127.0.0.1:8787/v1",
        authHeader: "bearer",
        thinkingWire: "standard",
        apiKey: null
      }).success
    ).toBe(false);
    expect(
      connectionDraftSchema.safeParse({
        providerId: "custom",
        baseURL: "http://127.0.0.1:8787/v1",
        authHeader: "bearer",
        thinkingWire: "standard",
        apiKey: "sk-abcdef"
      }).success
    ).toBe(true);
    // 2026-10-14 审计项 4：保存口只收 https 或本机回环的 http——
    // 明文 http 发到公网地址等于把密钥和全文裸送出去；本机回环不出网卡，不算外送。
    expect(
      connectionDraftSchema.safeParse({
        providerId: "custom",
        baseURL: "https://api.deepseek.com/v1",
        authHeader: "bearer",
        thinkingWire: "standard",
        apiKey: "sk-abcdef"
      }).success
    ).toBe(true);
    expect(
      connectionDraftSchema.safeParse({
        providerId: "custom",
        baseURL: "http://api.example.com/v1",
        authHeader: "bearer",
        thinkingWire: "standard",
        apiKey: "sk-abcdef"
      }).success
    ).toBe(false);
    // 2026-10-09 批次 5-㊻：草稿里这一项是**必填**（与 authHeader 同一档），
    // 而盘上的旧连接是靠 schema 的 default 补出来的。两者不是一回事：
    // 草稿漏了就是「界面上根本没这一格」，应当当场拒。
    expect(
      connectionDraftSchema.safeParse({
        providerId: "custom",
        baseURL: "http://127.0.0.1:8787/v1",
        authHeader: "bearer",
        apiKey: null
      }).success
    ).toBe(false);
  });

  it("掩码只露末 4 位且长度不足时全遮", () => {
    // 计划正文此处的期望值写成 "••••cdefg"（末 5 位），与用例名「只露末 4 位」、
    // provider.ts 的 slice(-4) 实现以及 Task 9 的 keyMask 断言 "••••defg" 三处都矛盾，按 4 位修正。
    expect(maskApiKey("sk-abcdefg")).toBe("••••defg");
    expect(maskApiKey("ab")).toBe("••••");
  });

  it("八个工具名固定，多一个少一个都算违约", () => {
    expect([...AGENT_TOOL_NAMES].sort()).toEqual([
      "list_docs",
      "propose_patch",
      "read_doc",
      "search_docs",
      "use_skill",
      "web_read",
      "web_search",
      "write_doc"
    ]);
  });

  it("八个工具名的排列顺序同样是契约（上一条先排序再比对，钉不住原序）", () => {
    // 注册表顺序决定提示词与工具卡的展示顺序；被重排必须转红。
    // 2026-10-04 追加 web_search（免费联网搜索，主进程出网）排在末尾；
    // 2026-10-11 追加 web_read（网页正文抓取）紧随其后——先搜后读，读的序跟着搜的序走；
    // 2026-10-23 追加 use_skill（技能自选，只读）。
    expect([...AGENT_TOOL_NAMES]).toEqual([
      "read_doc",
      "list_docs",
      "search_docs",
      "propose_patch",
      "write_doc",
      "web_search",
      "web_read",
      "use_skill"
    ]);
  });

  it("NETWORK_TOOL_NAMES 恰好是会出网的两枚（联网开关闸的是这一类）", () => {
    expect([...NETWORK_TOOL_NAMES]).toEqual(["web_search", "web_read"]);
    expect(isNetworkTool("web_search")).toBe(true);
    expect(isNetworkTool("web_read")).toBe(true);
    expect(isNetworkTool("read_doc")).toBe(false);
  });

  it("WRITE_TOOLS 只有两个成员，WriteToolName 被真正收窄", () => {
    expect([...WRITE_TOOLS]).toEqual(["propose_patch", "write_doc"]);
    const writable: WriteToolName = "propose_patch";
    expect(isWriteTool(writable)).toBe(true);
    expect(isWriteTool("read_doc")).toBe(false);
    // 若 WRITE_TOOLS 的声明退回 readonly AgentToolName[]，WriteToolName 就退化成整个联合，
    // 下面这行不再报错，@ts-expect-error 会变成「未使用的指令」⇒ tsc 转红。
    // @ts-expect-error read_doc 是只读工具，不属于 WriteToolName
    const notWritable: WriteToolName = "read_doc";
    expect(notWritable).toBe("read_doc");
  });
});

const meta = {
  type: "session-meta",
  sessionId: "s1",
  docRelPath: "chapters/01-开局.md",
  stageId: "draft",
  model: "mochen-mock",
  startedAt: "2026-10-01T08:00:00.000Z"
};

describe("sessionLoadResultSchema", () => {
  it("found:true 带 meta / events / droppedLines，逐条能解析", () => {
    const ok = {
      found: true,
      relPath: ".mochen/sessions/2026-10-01/rollout-x.jsonl",
      meta,
      events: [
        {
          id: "e1",
          ts: "2026-10-01T08:00:00.000Z",
          turnId: "t1",
          type: "user-message",
          text: "改紧"
        }
      ],
      droppedLines: [3, 7]
    };
    expect(sessionLoadResultSchema.parse(ok)).toEqual(ok);
  });

  it("found:false 的两种 reason 各自带中文 message", () => {
    for (const reason of ["no-book", "no-session"] as const) {
      const miss = { found: false, reason, message: "这本书里没有这条线程的历史。" };
      expect(sessionLoadResultSchema.parse(miss)).toEqual(miss);
    }
  });

  it("未知 reason 一律拒绝——回放失败态只有两种，第三种是编的", () => {
    expect(
      sessionLoadResultSchema.safeParse({ found: false, reason: "corrupt", message: "坏了" })
        .success
    ).toBe(false);
  });

  it("found:true 却不带 events 或 droppedLines 形状不符时拒绝（跨 IPC 兜底）", () => {
    expect(
      sessionLoadResultSchema.safeParse({
        found: true,
        relPath: "x",
        meta,
        events: "坏",
        droppedLines: []
      }).success
    ).toBe(false);
  });
});

describe("expired 提案状态（回放派生，D1）", () => {
  it("PROPOSAL_STATUSES 恰含七个成员，expired 排在末尾", () => {
    expect([...PROPOSAL_STATUSES]).toEqual([
      "pending",
      "written",
      "rejected",
      "cancelled",
      "stale",
      "failed",
      "expired"
    ]);
  });

  it("expired 的中文标签定稿整句钉死（Record 穷尽键，加成员不写说明就编译不过）", () => {
    expect(PROPOSAL_STATUS_LABELS.expired).toBe("上次会话未处理");
  });
});

describe("error 事件的可选 proposalId（缺陷③）", () => {
  const base = { id: "e1", ts: "2026-10-01T08:00:00.000Z", turnId: "t1" };

  it("error 带 proposalId 能解析，且解析结果留住该字段", () => {
    const parsed = agentEventSchema.parse({
      ...base,
      type: "error",
      message: "原稿已被改动，没有覆盖。",
      proposalId: "p1"
    });
    if (parsed.type !== "error") throw new Error("error 事件未被解析为 error");
    expect(parsed.proposalId).toBe("p1");
  });

  it("error 不带 proposalId 也能解析（老盘上的历史 error 事件）", () => {
    const parsed = agentEventSchema.parse({
      ...base,
      type: "error",
      message: "模型服务端返回 503：繁忙"
    });
    if (parsed.type !== "error") throw new Error("error 事件未被解析为 error");
    expect(parsed.proposalId).toBeUndefined();
  });
});

describe("sessionListItemSchema（#113e 历史对话面板的一行）", () => {
  const item = {
    sessionId: "s1",
    docRelPath: "chapters/01-开局.md",
    model: "mochen-mock",
    startedAt: "2026-10-01T08:00:00.000Z",
    title: "先把开头收紧"
  };

  it("五样齐了才收；title 允许空串（这条会话确实没有用户输入）", () => {
    expect(sessionListItemSchema.parse(item)).toEqual(item);
    expect(sessionListItemSchema.parse({ ...item, title: "" }).title).toBe("");
  });

  it("半成品一律拒：空 docRelPath / 缺 model / 缺 title 都进不了面板", () => {
    expect(sessionListItemSchema.safeParse({ ...item, docRelPath: "" }).success).toBe(false);
    const noModel: Record<string, unknown> = { ...item };
    delete noModel.model;
    expect(sessionListItemSchema.safeParse(noModel).success).toBe(false);
    const noTitle: Record<string, unknown> = { ...item };
    delete noTitle.title;
    expect(sessionListItemSchema.safeParse(noTitle).success).toBe(false);
  });
});

/**
 * 事件的**两份名单**必须同源（2026-10-12 扫描台账第二十五节）。
 *
 * 这条不是假想防御，病灶有实据：`agentEventSchema` 的判别式里曾有第 11 种 `history-truncated`，
 * 而 IPC 入向闸用的 `AGENT_EVENT_TYPES`（渲染层 `utils/agent-thread.ts:160` 拿它拦陌生类型）
 * 只有 10 种、**从来不含它**。两份名单分家的下场不是「多一个没人用的类型」这么温和——
 * 那条事件一旦真发出去，渲染层当场报的是「无法识别的智能体事件类型」，
 * 而不是本该上屏的那句「更早的 N 条没有发给模型」。
 * 所以这里钉的是**结构**，不是那枚已经删掉的枚举。
 */
describe("事件类型：zod 判别式与 IPC 白名单同源", () => {
  const fromSchema = agentEventSchema.options.map(
    (option) => (option.shape.type as { value: string }).value
  );

  it("两份名单一条不多一条不少（加一种事件要同时改两处）", () => {
    expect([...fromSchema].sort()).toEqual([...AGENT_EVENT_TYPES].sort());
  });

  it("轮级事实的唯一通路 error 在两处都在", () => {
    expect(fromSchema).toContain("error");
    expect(AGENT_EVENT_TYPES).toContain("error");
    // 反向对照：退役掉的那枚不许在**任一处**复活——只在一处复活就是这次分家的重演。
    expect(fromSchema).not.toContain("history-truncated");
    expect(AGENT_EVENT_TYPES).not.toContain("history-truncated");
  });
});
