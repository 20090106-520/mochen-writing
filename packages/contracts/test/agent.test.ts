import { describe, expect, it } from "vitest";
import {
  AGENT_TOOL_NAMES,
  agentEventSchema,
  decideInputSchema,
  editProposalSchema,
  maskApiKey,
  providerDraftSchema,
  sessionMetaSchema
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
    expect(
      providerDraftSchema.safeParse({ baseURL: "127.0.0.1:8787/v1", model: "m", apiKey: null })
        .success
    ).toBe(false);
    expect(
      providerDraftSchema.safeParse({
        baseURL: "http://127.0.0.1:8787/v1",
        model: "m",
        apiKey: "sk-abcdef"
      }).success
    ).toBe(true);
  });

  it("掩码只露末 4 位且长度不足时全遮", () => {
    // 计划正文此处的期望值写成 "••••cdefg"（末 5 位），与用例名「只露末 4 位」、
    // provider.ts 的 slice(-4) 实现以及 Task 9 的 keyMask 断言 "••••defg" 三处都矛盾，按 4 位修正。
    expect(maskApiKey("sk-abcdefg")).toBe("••••defg");
    expect(maskApiKey("ab")).toBe("••••");
  });

  it("五个工具名固定，多一个少一个都算违约", () => {
    expect([...AGENT_TOOL_NAMES].sort()).toEqual([
      "list_docs",
      "propose_patch",
      "read_doc",
      "search_docs",
      "write_doc"
    ]);
  });
});
