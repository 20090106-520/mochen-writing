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
  endsOnQuote: { count: 5, total: 20 },
  // 腔调偏离只比句长与标点（见 style-drift.ts），段长读数不参与——给 null 即可。
  paragraph: null,
  // 段末标点分布同样不参与式样偏离的比较，但形状要全。
  endMarkShare: { period: 1, question: 0, exclamation: 0, ellipsis: 0, other: 0 }
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

/**
 * 阈值档位钉住（2026-11-11 放宽一档后补）。
 *
 * 上面那组用例的偏离全是极端值（+114%、−30pp），线怎么挪都判 off——钉不住线本身。
 * 这里的夹具卡在**新旧线之间**：旧线（句长 32%、对白 15pp）会把它们判 off，
 * 新线（40%、25pp）判 warn。阈值要是悄悄改回去，这两条立刻红——
 * 跟出处前缀那组守卫同一个道理：判据的字面量写在测试里，不从生产代码 import。
 *
 * 依据是《呐喊》四篇的对照（scratch/out/style-drift-calibration.md）：
 * 社戏的题材差（对白 −22pp、句长 +28%）在旧线下被判 off，而真人章节在自己的书里
 * 不该判 off——该报（warn）不该拦，这条裁定本来就有，线放宽是把它落实。
 */
describe("阈值档位钉住：题材级偏离报 warn 不判 off", () => {
  /** 19 字一句（18 字+句号）、连 16 句共 304 字：对基准 14 字偏 +35.7%，卡在 32% 旧线之外、40% 新线之内。 */
  const LONGER_36 = Array.from({ length: 16 }, () => `${"字".repeat(18)}。`).join("\n");

  it("句长偏 36% 级判 warn（旧 32% 线会判 off）", () => {
    const report = styleDriftOf(PROFILE, LONGER_36);
    const mean = report.items.find((item) => item.key === "rhythm-mean");
    expect(mean?.severity).toBe("warn");
    expect(mean?.draft).toBe("19 字");
  });

  /** 15 句叙述（各 14 字）+ 15 句对白（各引 13 字+句号）：占比 210/420 = 50%，对白偏 +20pp，
   *  卡在 15pp 旧线之外、25pp 新线之内。 */
  const HALF_DIALOGUE = [
    ...Array.from({ length: 15 }, () => `${"字".repeat(13)}。`),
    ...Array.from({ length: 15 }, () => `「${"字".repeat(13)}。」`)
  ].join("\n");

  it("对白偏 20pp 级判 warn（旧 15pp 线会判 off）", () => {
    const report = styleDriftOf(PROFILE, HALF_DIALOGUE);
    const dialogue = report.items.find((item) => item.key === "dialogue");
    expect(dialogue?.severity).toBe("warn");
    expect(dialogue?.draft).toBe("50%");
  });

  it("对白偏 6pp 级不报：真人书里的正常题材差不值得打扰", () => {
    // 故乡 −12pp、阿Q +11pp 顶在旧 8pp warn 线上；新 warn 线 12pp 让这一级安静下来。
    // 夹具按 9 句对白 : 16 句叙述配平，占比 36%，对基准 30% 只偏 +6pp。
    const mild = [
      ...Array.from({ length: 16 }, () => `${"字".repeat(13)}。`),
      ...Array.from({ length: 9 }, () => `「${"字".repeat(13)}。」`)
    ].join("\n");
    const report = styleDriftOf(PROFILE, mild);
    expect(report.items.some((item) => item.key === "dialogue")).toBe(false);
  });
});
