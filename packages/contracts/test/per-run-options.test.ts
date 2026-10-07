import { describe, expect, it } from "vitest";
import {
  nextThinkingLevel,
  startTurnInputSchema,
  THINKING_LEVELS,
  thinkingLevelSchema,
  THINKING_LEVEL_LABELS,
  USER_TEXT_MAX_LEN,
  type ThinkingLevel
} from "../src/index.js";

/**
 * 输入区四枚开关的契约根（task #101）。
 * 这里钉的是「渲染层与主进程共用的那一串字面量」：档位集合、档位顺序、上限数字。
 * 三样都只该有一处真身（铁律 6），将来 UI 加一档、或把上限从 20000 改成别的数，
 * 都必须在这里先红一次，而不是让 chip 与守卫各说各话。
 */
const base = {
  threadKey: "chapters/01-开局.md",
  docRelPath: "chapters/01-开局.md",
  stageId: "draft",
  userText: "把开头那句收紧",
  // 每轮三个字段一律必填、无默认值（skillPaths 同理，spec §11）：base 里带上，
  // 下面那些「缺某一个必被拒」的用例才测的是它自己点名的那一个字段。
  thinkingLevel: "off",
  webSearchEnabled: false,
  skillPaths: [] as string[]
};

describe("thinkingLevelSchema", () => {
  it("四档按 off/low/medium/high 的顺序逐字钉死（chip 的循环顺序就是这个数组）", () => {
    expect([...THINKING_LEVELS]).toEqual(["off", "low", "medium", "high"]);
  });

  it("四档各自能过，第五种写法不能过", () => {
    for (const level of THINKING_LEVELS)
      expect(thinkingLevelSchema.safeParse(level).success).toBe(true);
    // 反向用例：deepwrite 目录里出现过的 max/xhigh 不是本仓的档，不许被顺手加进枚举。
    for (const bad of ["none", "min", "max", "xhigh", "OFF", "", "中"])
      expect(thinkingLevelSchema.safeParse(bad).success).toBe(false);
  });

  it("拒绝时给的是中文，不是 zod 的英文默认句", () => {
    const result = thinkingLevelSchema.safeParse("ultra");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("思考档位");
  });
});

describe("startTurnInputSchema 的两个每轮字段", () => {
  it("带 thinkingLevel 与 webSearchEnabled 的完整入参能过，且值原样保留", () => {
    const parsed = startTurnInputSchema.parse({
      ...base,
      thinkingLevel: "medium",
      webSearchEnabled: true
    });
    expect(parsed.thinkingLevel).toBe("medium");
    expect(parsed.webSearchEnabled).toBe(true);
  });

  // 没有默认值是刻意的：缺字段=渲染层忘了传，必须炸在边界上并给出中文，
  // 而不是悄悄按 off 发出去——那样「开关没生效」和「用户没打开」在真机上就分不出来了。
  it("缺 thinkingLevel 或缺 webSearchEnabled 都被拒，且理由是指向该字段的中文", () => {
    const noLevel = { ...base, webSearchEnabled: false } as Record<string, unknown>;
    delete noLevel.thinkingLevel;
    const levelResult = startTurnInputSchema.safeParse(noLevel);
    expect(levelResult.success).toBe(false);
    expect(levelResult.error?.issues.some((i) => i.path[0] === "thinkingLevel")).toBe(true);

    const noSearch = { ...base, thinkingLevel: "off" } as Record<string, unknown>;
    delete noSearch.webSearchEnabled;
    const searchResult = startTurnInputSchema.safeParse(noSearch);
    expect(searchResult.success).toBe(false);
    expect(searchResult.error?.issues.some((i) => i.path[0] === "webSearchEnabled")).toBe(true);
  });

  it("档位写成枚举外的字符串、联网写成字符串都被拒", () => {
    expect(
      startTurnInputSchema.safeParse({ ...base, thinkingLevel: "highest", webSearchEnabled: true })
        .success
    ).toBe(false);
    expect(
      startTurnInputSchema.safeParse({ ...base, thinkingLevel: "off", webSearchEnabled: "yes" })
        .success
    ).toBe(false);
  });

  it("userText 的上限就是 USER_TEXT_MAX_LEN，拒绝句里写的也是同一个数", () => {
    expect(USER_TEXT_MAX_LEN).toBe(20000);
    const result = startTurnInputSchema.safeParse({
      ...base,
      thinkingLevel: "off",
      webSearchEnabled: false,
      userText: "字".repeat(USER_TEXT_MAX_LEN + 1)
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain(String(USER_TEXT_MAX_LEN));
  });

  it("恰好到上限仍然能过（计数条与守卫不许差一）", () => {
    expect(
      startTurnInputSchema.safeParse({
        ...base,
        thinkingLevel: "off",
        webSearchEnabled: false,
        userText: "字".repeat(USER_TEXT_MAX_LEN)
      }).success
    ).toBe(true);
  });
});

describe("nextThinkingLevel 的循环（chip 每点一次走一格）", () => {
  it("off→low→medium→high→off，四步回到起点，不多不少", () => {
    expect(nextThinkingLevel("off")).toBe("low");
    expect(nextThinkingLevel("low")).toBe("medium");
    expect(nextThinkingLevel("medium")).toBe("high");
    expect(nextThinkingLevel("high")).toBe("off");
  });

  // 反向保护：从枚举里删一档而忘了改循环，这里会给出 undefined 而不是悄悄跳格。
  it("循环四步走过的档位正好是四档，一步不许重复、一步不许漏", () => {
    const seen: ThinkingLevel[] = [];
    let level: ThinkingLevel = "off";
    for (let i = 0; i < THINKING_LEVELS.length; i += 1) {
      seen.push(level);
      level = nextThinkingLevel(level);
    }
    expect(seen).toEqual([...THINKING_LEVELS]);
    expect(level).toBe("off");
  });
});

describe("THINKING_LEVEL_LABELS（chip 上的中文，只此一张表）", () => {
  // #112：档名照参考图那三张截图的同一口径（deepwrite builtInThinkingLabels 里 low/medium/high
  // 就是 较低/标准/深度）——chip 上只剩档位名，图标负责说这是思考等级，所以词得单独读得通。
  it("键与 THINKING_LEVELS 完全一致，中文逐字钉死", () => {
    expect(Object.keys(THINKING_LEVEL_LABELS).sort()).toEqual([...THINKING_LEVELS].sort());
    expect(THINKING_LEVEL_LABELS.off).toBe("关闭");
    expect(THINKING_LEVEL_LABELS.low).toBe("较低");
    expect(THINKING_LEVEL_LABELS.medium).toBe("标准");
    expect(THINKING_LEVEL_LABELS.high).toBe("深度");
  });

  it("表能被 THINKING_LEVELS 的每个成员索引到非空串（穷尽性在类型层由 Record 键兜住）", () => {
    for (const level of THINKING_LEVELS as readonly ThinkingLevel[])
      expect(THINKING_LEVEL_LABELS[level].length).toBeGreaterThan(0);
  });
});
