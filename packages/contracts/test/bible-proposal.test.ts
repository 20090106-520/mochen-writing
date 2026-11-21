import { describe, expect, it } from "vitest";
import {
  AGENT_EVENT_TYPES,
  AGENT_PROFILES,
  AGENT_TOOL_NAMES,
  BIBLE_PROPOSAL_TYPES,
  BIBLE_PROPOSAL_TYPE_LABELS,
  agentEventSchema,
  bibleProposalSchema,
  isWriteTool
} from "../src/index.js";

const proposal = {
  id: "p1",
  threadKey: "chapters/01.md",
  turnId: "t1",
  type: "character" as const,
  title: "阿雾",
  content: "雾里的摆渡人。",
  why: "第七章要用她。",
  createdAt: "2026-11-20T08:00:00.000Z"
};

describe("设定提案（2026-11-20 propose_bible）", () => {
  it("三类各有中文标签，类型名与设定库同一份", () => {
    expect([...BIBLE_PROPOSAL_TYPES]).toEqual(["character", "location", "timeline"]);
    for (const type of BIBLE_PROPOSAL_TYPES) {
      expect(BIBLE_PROPOSAL_TYPE_LABELS[type]).not.toBe("");
    }
  });

  it("propose_bible 已在工具名册里，但不算「写」工具（它走另一条审批通路）", () => {
    expect((AGENT_TOOL_NAMES as readonly string[]).includes("propose_bible")).toBe(true);
    expect(isWriteTool("propose_bible")).toBe(false);
  });

  it("六档案都能提设定（只读的审稿档案也要能），没有哪一枚被漏掉", () => {
    for (const profile of AGENT_PROFILES) {
      expect(profile.tools.includes("propose_bible")).toBe(true);
    }
  });

  it("bible-proposal / bible-written 是白名单里的事件，形状过得了 schema", () => {
    expect((AGENT_EVENT_TYPES as readonly string[]).includes("bible-proposal")).toBe(true);
    expect((AGENT_EVENT_TYPES as readonly string[]).includes("bible-written")).toBe(true);
    expect(bibleProposalSchema.safeParse(proposal).success).toBe(true);
    expect(
      agentEventSchema.safeParse({
        id: "e1",
        ts: "2026-11-20T08:00:00.000Z",
        turnId: "t1",
        type: "bible-proposal",
        proposal
      }).success
    ).toBe(true);
    expect(
      agentEventSchema.safeParse({
        id: "e2",
        ts: "2026-11-20T08:00:00.000Z",
        turnId: "t1",
        type: "bible-written",
        proposalId: "p1",
        entryId: "b1",
        title: "阿雾",
        entryType: "character"
      }).success
    ).toBe(true);
  });

  it("类型不在三类里、标题或理由为空都过不了 schema", () => {
    expect(bibleProposalSchema.safeParse({ ...proposal, type: "item" }).success).toBe(false);
    expect(bibleProposalSchema.safeParse({ ...proposal, title: "" }).success).toBe(false);
    expect(bibleProposalSchema.safeParse({ ...proposal, why: "" }).success).toBe(false);
  });
});
