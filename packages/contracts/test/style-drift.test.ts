import { describe, expect, it } from "vitest";
import { styleProfileOf, type StyleProfile } from "../src/style-profile.js";
import { styleDriftOf } from "../src/style-drift.js";

/**
 * 腔调偏离（2026-11-10）：闸只跟通用阈值比，这里补「跟这本书自己比」。
 *
 * 两套用例分开：
 * - 用手写的 `PROFILE` 精确对照阈值档位（数都写死，口径被改就红）；
 * - 用 `styleProfileOf` 现量一份档案，证明「同一段文本对自己零偏离」——
 *   这条是防两份测量各算一套的唯一机器判据。
 */

/** 手写档案：句长 14 字、波动 0.4、破折号 1.2/千字、分号 0.2（低于地板线，不该参与判定）、
 *  省略号 0.6、对白 30%。 */
const PROFILE: StyleProfile = {
  charCount: 600,
  rhythm: { mean: 14, spread: 0.4 },
  punctuation: { dash: 1.2, semicolon: 0.2, ellipsis: 0.6 },
  dialogueRatio: 0.3,
  endsOnQuote: { count: 5, total: 20 }
};

/** 30 字一句、连 10 句：均值恰好 30、波动 0、无对白、无破折号。共 300 字（刚好过样本线）。 */
const FLAT_LONG = Array.from({ length: 10 }, () => `${"字".repeat(29)}。`).join("\n");

describe("styleDriftOf 样本门槛", () => {
  it("没有常态档案时不测量，并说清原因", () => {
    const report = styleDriftOf(null, FLAT_LONG);
    expect(report.checked).toBe(false);
    expect(report.items).toHaveLength(0);
    expect(report.note).toContain("500 字");
  });

  it("稿子太短不测量——短样本上的距离几乎全是噪声", () => {
    const short = `${"字".repeat(99)}。`;
    const report = styleDriftOf(PROFILE, short);
    expect(report.checked).toBe(false);
    expect(report.note).toContain("短样本");
    expect(report.worst).toBeNull();
  });

  it("同一段文本对自己零偏离", () => {
    const text = `${FLAT_LONG}\n${FLAT_LONG}`;
    const report = styleDriftOf(styleProfileOf([text]), text);
    expect(report.checked).toBe(true);
    expect(report.items).toHaveLength(0);
    expect(report.note).toContain("一致");
  });
});

describe("styleDriftOf 四维判定", () => {
  it("句长拉长一倍以上判 off，并给出拆句的改法", () => {
    const report = styleDriftOf(PROFILE, FLAT_LONG);
    const mean = report.items.find((item) => item.key === "rhythm-mean");
    expect(mean?.severity).toBe("off");
    expect(mean?.base).toBe("14 字");
    expect(mean?.draft).toBe("30 字");
    expect(mean?.advice).toContain("拉长");
    expect(report.note).toContain("不太像这本书");
  });

  it("句长全齐（波动归零）单独立一条", () => {
    const report = styleDriftOf(PROFILE, FLAT_LONG);
    const spread = report.items.find((item) => item.key === "rhythm-spread");
    expect(spread?.severity).toBe("off");
    expect(spread?.advice).toContain("短句");
  });

  it("对白占比掉了 30 个点判 off，措辞指向「让人物开口」", () => {
    const report = styleDriftOf(PROFILE, FLAT_LONG);
    const dialogue = report.items.find((item) => item.key === "dialogue");
    expect(dialogue?.severity).toBe("off");
    expect(dialogue?.base).toBe("30%");
    expect(dialogue?.draft).toBe("0%");
    expect(dialogue?.advice).toContain("开口");
  });

  it("标点密度低于基准地板线的那一枚（分号 0.2）不参与判定", () => {
    const report = styleDriftOf(PROFILE, FLAT_LONG);
    expect(report.items.some((item) => item.label === "分号密度")).toBe(false);
    expect(report.items.some((item) => item.label === "破折号密度")).toBe(true);
  });

  it("一处标点都没有时偏离是有限值，不许算成无穷", () => {
    const report = styleDriftOf(PROFILE, FLAT_LONG);
    expect(report.items.every((item) => Number.isFinite(item.delta))).toBe(true);
  });

  it("worst 取「off 优先、同类取偏离最大」的那一条", () => {
    const report = styleDriftOf(PROFILE, FLAT_LONG);
    expect(report.worst?.key).toBe("rhythm-mean");
    expect(report.items[0]).toBe(report.worst);
  });
});
