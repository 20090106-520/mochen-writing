import { describe, expect, it } from "vitest";
import {
  MISSING_METRICS,
  METRIC_LABELS,
  METRIC_MISSING_NOTE,
  METRIC_MISSING_NOTE as NOTE,
  NEUTRAL_SCORE,
  REVIEW_METRICS,
  clampScoreForTest,
  countDialogueSegments,
  overallSummary,
  paragraphHint,
  reviewReport,
  scoreBandOf,
  scoreBarWidth,
  scoreDialogue,
  scoreParagraph,
  scoreSentence,
  scoreSlop,
  splitSentences
} from "./review-score";

describe("分句", () => {
  it("中英标点都是断点，省略号不算多切一刀", () => {
    const pieces = splitSentences("他走了。她没有回头……真的吗？也许吧！走。");
    // 「……」是两个字符，但合起来是一句的收束
    expect(pieces.map((p) => p.text)).toEqual([
      "他走了。",
      "她没有回头……",
      "真的吗？",
      "也许吧！",
      "走。"
    ]);
  });

  it("空串与纯空白给零句，不给一句空的", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("   \n  ")).toEqual([]);
  });

  it("结尾没有标点也留作一句（作者还没写完）", () => {
    expect(splitSentences("他停在门口")).toEqual([{ text: "他停在门口", chars: 5 }]);
  });

  it("chars 不计空白", () => {
    expect(splitSentences("他 走 了。")[0]?.chars).toBe(3);
  });
});

describe("句长打分", () => {
  it("常规区间给中性基准，不是满分", () => {
    expect(scoreSentence({ average: 18, longest: 30, overLong: 0, total: 10 })).toBe(NEUTRAL_SCORE);
  });

  it("句子过长比过短扣得更狠", () => {
    const long = scoreSentence({ average: 45, longest: 90, overLong: 3, total: 10 });
    const short = scoreSentence({ average: 6, longest: 12, overLong: 0, total: 10 });
    expect(long).toBeLessThan(short);
  });

  it("同样偏离 20 分，均长 40 比均长 8 更低", () => {
    expect(scoreSentence({ average: 40, longest: 45, overLong: 0, total: 10 })).toBeLessThan(
      scoreSentence({ average: 8, longest: 12, overLong: 0, total: 10 })
    );
  });

  it("出现过目不看的长句另扣", () => {
    const withLongest = scoreSentence({ average: 18, longest: 90, overLong: 0, total: 10 });
    const without = scoreSentence({ average: 18, longest: 30, overLong: 0, total: 10 });
    expect(withLongest).toBeLessThan(without);
  });

  it("长句占比过半再加扣", () => {
    const manyLong = scoreSentence({ average: 18, longest: 70, overLong: 8, total: 10 });
    const fewLong = scoreSentence({ average: 18, longest: 70, overLong: 1, total: 10 });
    expect(manyLong).toBeLessThan(fewLong);
  });

  it("没有句子时给中性，不给 0 分（空不是差）", () => {
    expect(scoreSentence({ average: 0, longest: 0, overLong: 0, total: 0 })).toBe(NEUTRAL_SCORE);
  });
});

describe("段落节奏打分", () => {
  it("常规给中性", () => {
    expect(scoreParagraph({ average: 3, longest: 5, count: 4 })).toBe(NEUTRAL_SCORE);
  });

  it("一整屏没切开要扣", () => {
    expect(scoreParagraph({ average: 3, longest: 20, count: 2 })).toBeLessThan(
      scoreParagraph({ average: 3, longest: 5, count: 4 })
    );
  });

  it("段数太少时长段才扣——段落多的时候长段不算毛病", () => {
    expect(scoreParagraph({ average: 3, longest: 20, count: 2 })).toBeLessThan(
      scoreParagraph({ average: 3, longest: 20, count: 10 })
    );
  });

  // 2026-10-05 真机撞出来的：分数与话术各判一次，就会出现
  // 「54 分 / 明显偏出」配一句「段落切得还算清爽」的自相矛盾。
  it("话术跟着分数那一支的判据走，不许唱反调", () => {
    const low = reviewReport("他推开门。\n\n她走了。").scores.find((s) => s.metric === "paragraph");
    expect(scoreBandOf(low?.score ?? 100)).not.toBe("high");
    expect(low?.hint).not.toBe("段落切得还算清爽");
  });

  it("三个偏法各说各的话", () => {
    expect(paragraphHint({ average: 3, longest: 20, count: 2 })).toBe("有一整屏没切开，读起来会累");
    expect(paragraphHint({ average: 1, longest: 1, count: 4 })).toBe(
      "段落切得很碎，每段就一行——读者接不上劲"
    );
    expect(paragraphHint({ average: 9, longest: 10, count: 4 })).toBe("段落偏长，一口气读下去会喘");
    expect(paragraphHint({ average: 3, longest: 5, count: 4 })).toBe("段落切得还算清爽");
  });
});

describe("对白占比打分", () => {
  it("没有对白给中性——独白章不算毛病", () => {
    expect(scoreDialogue({ ratio: 0, count: 0 })).toBe(NEUTRAL_SCORE);
  });

  it("常规区间给中性", () => {
    expect(scoreDialogue({ ratio: 0.4, count: 6 })).toBe(NEUTRAL_SCORE);
  });

  it("全是叙述比全是对白扣得更狠", () => {
    expect(scoreDialogue({ ratio: 0.02, count: 1 })).toBeLessThan(
      scoreDialogue({ ratio: 0.9, count: 30 })
    );
  });
});

describe("套话密度打分", () => {
  it("零命中满分", () => {
    expect(scoreSlop(0, "他把灯关了。")).toBe(100);
  });

  it("命中越多分越低", () => {
    expect(
      scoreSlop(8, "值得注意的是，总而言之，毫无疑问，显而易见，不难看出，令人深思。")
    ).toBeLessThan(scoreSlop(2, "值得注意的是，总而言之。"));
  });

  it("扣分有下限，不出负分", () => {
    const many = Array.from({ length: 40 }, () => "值得注意的是").join("，");
    expect(scoreSlop(40, many)).toBeGreaterThanOrEqual(0);
  });
});

describe("对白片段统计", () => {
  it("数成对的引号，不数落单的", () => {
    expect(countDialogueSegments("他说：「走吧。」然后走了。")).toEqual({ count: 1, chars: 2 });
  });

  it("两种引号都算", () => {
    expect(countDialogueSegments("「甲」『乙』").count).toBe(2);
  });

  it("没闭合的不算一段", () => {
    expect(countDialogueSegments("他说：「走吧").count).toBe(0);
  });
});

describe("整篇打分", () => {
  it("空正文不报四个维度，也不给 0 分", () => {
    const report = reviewReport("   ");
    expect(report.scores).toEqual([]);
    expect(report.overall).toBe(NEUTRAL_SCORE);
    expect(report.summary).toContain("还没有正文");
  });

  it("报满四个维度且顺序跟着 REVIEW_METRICS", () => {
    const report = reviewReport("他推开门。\n\n「谁？」\n\n没人回答。");
    expect(report.scores.map((s) => s.metric)).toEqual([...REVIEW_METRICS]);
  });

  it("每项都带标签、读数与依据，不给裸分", () => {
    for (const s of reviewReport("他推开门。\n\n「谁？」").scores) {
      expect(s.label).toBe(METRIC_LABELS[s.metric]);
      expect(s.hint).not.toBe("");
      expect(s.reading).not.toBe("");
    }
  });

  it("综合分是各维度平均（不是常数）", () => {
    const tidy = reviewReport(
      "他推开门。「谁？」没人回答。她走了。他跟上去。外面在下雨。路很滑。\n\n他站住了。"
    );
    const messy = reviewReport(
      "值得注意的是，他在那一瞬间终于明白了自己一直以来究竟在追寻什么以及为什么，这条漫长的道路从一开始就已经注定，通而言之，不难看出，这一切都将在某个不可预知的时刻迎来它最终的结局，而那一天的到来不过是时间问题。"
    );
    expect(tidy.overall).not.toBe(messy.overall);
    expect(tidy.overall).toBeGreaterThan(messy.overall);
  });

  it("全文套话那一篇的套话项明显更低", () => {
    const slop = reviewReport("值得注意的是，总而言之，毫无疑问，这一切都值得深思。").scores.find(
      (s) => s.metric === "slop"
    );
    const clean = reviewReport("他把灯关了，屋子暗下来。").scores.find((s) => s.metric === "slop");
    expect(slop?.score).toBeLessThan(clean?.score ?? 0);
  });

  it("扫的是传入的这份正文（草稿口径），不读盘", () => {
    const a = reviewReport("他推开门。");
    const b = reviewReport("他推开门，然后又关上了。");
    expect(a.overall).not.toBe(b.overall);
  });
});

describe("分数呈现的辅助判定", () => {
  it("条宽夹在 0-100%，不画到界外", () => {
    expect(scoreBarWidth(88)).toBe("88%");
    expect(scoreBarWidth(-20)).toBe("0%");
    expect(scoreBarWidth(999)).toBe("100%");
    expect(scoreBarWidth(Number.NaN)).toBe("0%");
  });

  it("分档穷尽三档，60 落在「偏出」而不是「常规」", () => {
    expect(scoreBandOf(95)).toBe("high");
    expect(scoreBandOf(60)).toBe("mid");
    expect(scoreBandOf(20)).toBe("low");
    expect(scoreBandOf(Number.NaN)).toBe("mid");
  });
});

describe("诚实边界：算不出的那几项明写", () => {
  it("本地不算剧情与人物——这两项不在维度表里", () => {
    expect(REVIEW_METRICS).not.toContain("plot" as never);
    expect(REVIEW_METRICS).not.toContain("character" as never);
  });

  it("算不出的两项各带一句为什么", () => {
    expect(MISSING_METRICS).toHaveLength(2);
    for (const m of MISSING_METRICS) {
      expect(m.label).not.toBe("");
      expect(m.hint).not.toBe("");
    }
  });

  it("说明文案只有一份（NOTE 是同一个常量，不是第二处字面量）", () => {
    expect(NOTE).toBe(METRIC_MISSING_NOTE);
  });
});

describe("文案纪律", () => {
  // 禁的是**把 60 说成及格**，不是禁提「及格」这两个字——结论里那句
  // 「60 是中性基准，不是及格线」正是最该在的免责说明，它含「及格」二字。
  it("综合结论不把分数说成质量判断", () => {
    const report = reviewReport("他推开门。\n\n「谁？」\n\n她没回答。");
    expect(report.summary).not.toContain("不合格");
    expect(report.summary).not.toContain("通过");
    expect(report.summary).not.toContain("得分不错");
  });

  it("中性基准明写在结论里，60 不是及格线", () => {
    expect(overallSummary(60, reviewReport("他推开门。").scores)).toContain("不是及格线");
  });

  it("最偏的那一项会被点名", () => {
    const scores = reviewReport(
      "值得注意的是，总而言之，毫无疑问，不难看出，这一切都令人深思。"
    ).scores;
    const summary = overallSummary(40, scores);
    const worst = scores.reduce((min, s) => (s.score < min.score ? s : min), scores[0]!);
    expect(summary).toContain(worst.label);
  });
});

describe("内部夹子导出（只给测试用）", () => {
  it("clampScoreForTest 夹住上下界", () => {
    expect(clampScoreForTest(50.4)).toBe(50);
    expect(clampScoreForTest(-1)).toBe(0);
    expect(clampScoreForTest(101)).toBe(100);
    expect(clampScoreForTest(Number.NaN)).toBe(NEUTRAL_SCORE);
  });
});
