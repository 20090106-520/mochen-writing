import { describe, expect, it } from "vitest";
import {
  DRAFT_SAMPLE_COUNT_REJECT,
  DRAFT_SET_FAIL_MESSAGES,
  discardDraftsInputSchema,
  pickDraftInputSchema,
  startTurnInputSchema
} from "../src/index.js";

/**
 * 每轮采样字段与候选集的跨进程契约（P0-②）。
 *
 * 这里钉的是「渲染层递过来的那串字面量」与「主进程回会的那几句中文」：
 * 字段名逐字同名、三档失败理由各配一句自己的话。两件事都只该有一处真身（铁律 6）。
 */
const base = {
  threadKey: "chapters/01-开局.md",
  docRelPath: "chapters/01-开局.md",
  stageId: "draft",
  userText: "把开头那句收紧",
  thinkingLevel: "off",
  webSearchEnabled: false,
  skillPaths: [] as string[],
  // 每轮四个字段一律必填、无默认值：base 里带上，下面「缺某一个必被拒」的用例
  // 才测的是它自己点名的那一个。
  sampleCount: 1
};

describe("startTurnInputSchema 的采样档字段", () => {
  it("带 sampleCount 的完整入参能过，且值原样保留（2 / 3 都收）", () => {
    for (const count of [1, 2, 3] as const) {
      const parsed = startTurnInputSchema.parse({ ...base, sampleCount: count });
      expect(parsed.sampleCount).toBe(count);
    }
  });

  it("缺 sampleCount 被拒，理由指向该字段，且就是那份中文常量", () => {
    const missing: Record<string, unknown> = { ...base };
    delete missing.sampleCount;
    const result = startTurnInputSchema.safeParse(missing);
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some(
        (issue) => issue.path[0] === "sampleCount" && issue.message === DRAFT_SAMPLE_COUNT_REJECT
      )
    ).toBe(true);
  });

  it("0 / 4 / 字符串都被拒（超上限与比「关」更小都不行）", () => {
    for (const bad of [0, 4, "2"]) {
      const result = startTurnInputSchema.safeParse({ ...base, sampleCount: bad });
      expect(result.success).toBe(false);
      expect(result.error?.issues.some((issue) => issue.path[0] === "sampleCount")).toBe(true);
    }
  });
});

describe("pickDraftInputSchema", () => {
  it("句柄 + 稿序号能过，值原样保留", () => {
    expect(pickDraftInputSchema.parse({ draftSetId: "s1", index: 0 })).toEqual({
      draftSetId: "s1",
      index: 0
    });
    expect(pickDraftInputSchema.parse({ draftSetId: "s1", index: 2 }).index).toBe(2);
  });

  it("空句柄 / 缺句柄都拒，理由是「候选集标识不能为空」", () => {
    for (const bad of ["", undefined, null]) {
      const result = pickDraftInputSchema.safeParse({ draftSetId: bad, index: 0 });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe("候选集标识不能为空");
    }
  });

  it("稿序号必须是 0 起的整数：负数 / 小数 / 字符串各给自己的拒绝句", () => {
    const negative = pickDraftInputSchema.safeParse({ draftSetId: "s1", index: -1 });
    expect(negative.success).toBe(false);
    expect(negative.error?.issues[0]?.message).toBe("稿序号不能是负数");

    for (const bad of [1.5, "1", null, undefined]) {
      const result = pickDraftInputSchema.safeParse({ draftSetId: "s1", index: bad });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe("稿序号必须是整数");
    }
  });

  it("缺整对入参也拒（跨 IPC 来的形状一律当不可信）", () => {
    expect(pickDraftInputSchema.safeParse({}).success).toBe(false);
    expect(pickDraftInputSchema.safeParse({ draftSetId: "s1" }).success).toBe(false);
  });
});

describe("discardDraftsInputSchema", () => {
  it("只收一个句柄", () => {
    expect(discardDraftsInputSchema.parse({ draftSetId: "s1" })).toEqual({ draftSetId: "s1" });
  });

  it("空 / 缺句柄都拒，且不认多余的字段（丢弃不递稿序号）", () => {
    expect(discardDraftsInputSchema.safeParse({ draftSetId: "" }).success).toBe(false);
    expect(discardDraftsInputSchema.safeParse({}).success).toBe(false);
    expect(discardDraftsInputSchema.safeParse({ draftSetId: "s1", index: 1 }).success).toBe(true);
  });
});

describe("DRAFT_SET_FAIL_MESSAGES · 三档理由各说自己的话", () => {
  it("恰好三档，句句是中文、句句不重样", () => {
    const keys = Object.keys(DRAFT_SET_FAIL_MESSAGES) as Array<
      keyof typeof DRAFT_SET_FAIL_MESSAGES
    >;
    expect([...keys].sort()).toEqual(["busy", "gone", "no-book"]);
    const messages = keys.map((key) => DRAFT_SET_FAIL_MESSAGES[key]);
    for (const message of messages) {
      expect(message).toMatch(/[\u4e00-\u9fa5]/);
      expect(message.length).toBeGreaterThan(6);
    }
    expect(new Set(messages).size).toBe(3);
  });

  it("gone / no-book / busy 三句话分别说清「重发一轮 / 去开书 / 等这一轮」", () => {
    expect(DRAFT_SET_FAIL_MESSAGES.gone).toContain("重新发一轮");
    expect(DRAFT_SET_FAIL_MESSAGES["no-book"]).toContain("作品目录");
    expect(DRAFT_SET_FAIL_MESSAGES.busy).toContain("一轮在跑");
  });
});
