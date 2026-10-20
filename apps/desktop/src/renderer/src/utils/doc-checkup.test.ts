import { describe, expect, it } from "vitest";
import { degenerationOf, vitalityOf } from "@mochen/contracts";
import {
  DUPLICATE_SENTENCE_LIMIT,
  PUNCTUATION_ISSUE_LIMIT,
  TERM_SUSPECT_LIMIT,
  chapterDialogueRows,
  chapterReadoutRows,
  findDuplicateSentences,
  findPunctuationIssues,
  findTermVariants,
  findVoiceDrift,
  topPhrases,
  trackCharacterAppearances
} from "./doc-checkup";

/** 书稿体检的判定口径（2026-10-10）：启发式、报「疑似」、判断交给人。 */

describe("findTermVariants：一字之差词对", () => {
  it("同名两写法（林潮生/林潮升）被报为疑似，带出现次数与样例行定位", () => {
    const suspects = findTermVariants([
      "第一行。\n林潮生把刀放下。\n林潮生看着海面。\n",
      "林潮升把刀放下。\n林潮升看着海面。\n"
    ]);
    expect(suspects).toHaveLength(1);
    expect(suspects[0]).toMatchObject({ a: "林潮生", b: "林潮升", countA: 2, countB: 2 });
    expect(suspects[0]!.sample).toContain("林潮");
    // 样例行定位（点条目直达原文用）：第 0 篇第 2 行。
    expect(suspects[0]!.sampleDocIndex).toBe(0);
    expect(suspects[0]!.sampleLine).toBe(2);
  });

  it("只出现一次的写法不报（孤例不是混用）", () => {
    const suspects = findTermVariants([
      "林潮生把刀放下。\n林潮生看着海面。\n林潮生走了。\n",
      "林潮升只出现这一次。\n"
    ]);
    expect(suspects).toHaveLength(0);
  });

  it("虚字词对被滤掉：他们/它人、的时候 这类不进疑似", () => {
    const suspects = findTermVariants([
      "他们都走了。\n他们没说话。\n它人如何。\n它人怎样。\n的时候到了。\n的时候来了。\n"
    ]);
    expect(suspects).toHaveLength(0);
  });

  it("两处以上差异（林海升/林潮生）不报", () => {
    const suspects = findTermVariants(["林潮生来了。\n林潮生走了。\n林海升来了。\n林海升走了。\n"]);
    expect(suspects).toHaveLength(0);
  });

  it("按较少见写法的出现次数排序，最可疑的排前面；清单封顶", () => {
    const many = "林潮生来了。\n".repeat(9) + "林潮升来了。\n".repeat(2);
    const few = "苏映月来了。\n".repeat(3) + "苏映玥来了。\n".repeat(3);
    const suspects = findTermVariants([many, few]);
    expect(suspects.length).toBe(2);
    expect(suspects[0]).toMatchObject({ a: "苏映月", b: "苏映玥" });
    expect(suspects[1]).toMatchObject({ a: "林潮生", b: "林潮升" });
    expect(TERM_SUSPECT_LIMIT).toBeGreaterThan(0);
  });
});

describe("findPunctuationIssues：标点硬伤", () => {
  it("连续句读（。。、，，）与汉字间半角标点都报，带篇序与行号", () => {
    const issues = findPunctuationIssues([
      "第一行没问题。\n他愣住了。。\n",
      "这样,对吗？\n好的，，那就这样。\n"
    ]);
    expect(issues).toHaveLength(3);
    expect(issues[0]).toMatchObject({ docIndex: 0, line: 2, kind: "repeated" });
    expect(issues[1]).toMatchObject({ docIndex: 1, line: 1, kind: "halfwidth" });
    expect(issues[2]).toMatchObject({ docIndex: 1, line: 2, kind: "repeated" });
  });

  it("语气合法写法（！！？？……——）与数字/英文场景不报", () => {
    const issues = findPunctuationIssues([
      "「不可能！！」他喊道。\n是真的吗？？\n他说……好吧。\n车速到了3.5，我说OK,好。\n"
    ]);
    expect(issues).toHaveLength(0);
  });

  it("半角连写（答,,只是）也算句读连写，但 `...` 与 `!!` 照旧不报", () => {
    // 2026-10-11 真机量的那条漏报：两条规则都不命中它（句读那条只收全角，
    // 半角那条要求标点两侧都是汉字而这里是两个逗号）。
    const issues = findPunctuationIssues([
      "沈砚没有回答,,只是把斗篷上的雪抖落。\n他等了很久...\n她喊道：别动！！\n"
    ]);
    expect(issues).toEqual([
      { docIndex: 0, line: 1, kind: "repeated", excerpt: "沈砚没有回答,,只是把斗篷上的雪抖落。" }
    ]);
  });

  it("清单封顶后立刻停，不再扫后面的篇", () => {
    const junk = "他愣住了。。\n".repeat(60);
    const issues = findPunctuationIssues([junk, "后面这篇,不扫了。\n"]);
    expect(issues.length).toBe(PUNCTUATION_ISSUE_LIMIT);
    expect(issues.every((issue) => issue.docIndex === 0)).toBe(true);
  });
});

describe("findDuplicateSentences：重复句", () => {
  it("≥12 字的相同句子跨篇出现 ≥2 次被报，带次数与篇序", () => {
    const a = "雾从海面涌上来，像一层灰纱罩住了整座灯塔。\n别的句子。\n";
    const b = "他也看见。雾从海面涌上来，像一层灰纱罩住了整座灯塔。\n";
    const dupes = findDuplicateSentences([a, b]);
    expect(dupes).toHaveLength(1);
    expect(dupes[0]!.count).toBe(2);
    expect(dupes[0]!.docIndexes).toEqual([0, 1]);
  });

  it("短句重复（口头禅）与只出现一次的长句不报", () => {
    const dupes = findDuplicateSentences(["他点了点头，笑了笑。\n他点了点头，笑了笑。\n"]);
    expect(dupes).toHaveLength(0);
  });
});

describe("trackCharacterAppearances：角色出场", () => {
  const chapters = [
    { title: "第一章 出海", content: "林潮生站在船头。林潮生回头。\n" },
    { title: "第二章 守闸", content: "守闸人也姓林。林潮生没有说话。\n" },
    { title: "第三章 空城", content: "城里只有苏映月。\n" }
  ];

  it("统计总次数、出场章数与最近出场章节", () => {
    const rows = trackCharacterAppearances(["林潮生", "苏映月"], chapters);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: "林潮生",
      total: 3,
      chapterCount: 2,
      lastChapterTitle: "第二章 守闸"
    });
    expect(rows[1]).toMatchObject({
      name: "苏映月",
      total: 1,
      chapterCount: 1,
      lastChapterTitle: "第三章 空城"
    });
  });

  it("全书未出场的角色如实标 null；空名跳过；按总次数排序", () => {
    const rows = trackCharacterAppearances(["", "老闸工", "苏映月"], chapters);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.name).toBe("苏映月");
    expect(rows[1]).toMatchObject({ name: "老闸工", total: 0, lastChapterTitle: null });
    expect(DUPLICATE_SENTENCE_LIMIT).toBeGreaterThan(0);
  });
});

describe("chapterDialogueRows：每章对话占比（第六类）", () => {
  /** 一章正文：叙述 + 指定次数的「引号对话」。 */
  function chapter(narration: string, dialogues: string[]): string {
    return [narration, ...dialogues].join("\n");
  }

  it("话太密的章排最前，判读 dense；占比按引号内字数计", () => {
    // 密章：对话远超 65%（样本要过 500 字，否则只判「样本不足」）。
    const dense = chapter(
      "夜里起了风。",
      Array.from(
        { length: 20 },
        () => "「今天不去了，你替我把话带到，剩下的都依你安排，别再来寻我。」"
      )
    );
    // 闷章：几乎没有对话。
    const silent = chapter(
      Array.from({ length: 30 }, (_, i) => `他沿着河堤走了很远，第${i}次停下来看水。`).join("\n"),
      []
    );
    const rows = chapterDialogueRows([
      { docIndex: 1, content: silent },
      { docIndex: 0, content: dense }
    ]);
    expect(rows[0]).toMatchObject({ docIndex: 0, verdict: "dense" });
    expect(rows[0]!.percent).toBeGreaterThan(65);
    expect(rows).toContainEqual(expect.objectContaining({ docIndex: 1, verdict: "silent" }));
  });

  it("常态章判 normal；不足 500 字判 thin-sample（不算病）", () => {
    const normal = chapter(
      Array.from({ length: 40 }, () => "他把屋里的灯芯挑亮，又把窗关了一半，听院子里的动静。").join(
        "\n"
      ),
      Array.from({ length: 6 }, () => "「先吃饭，吃完再说这事。」")
    );
    const thin = chapter("夜深了。", ["「睡吧。」"]);
    const rows = chapterDialogueRows([
      { docIndex: 0, content: normal },
      { docIndex: 1, content: thin }
    ]);
    expect(rows.find((row) => row.docIndex === 0)?.verdict).toBe("normal");
    expect(rows.find((row) => row.docIndex === 1)?.verdict).toBe("thin-sample");
  });
});

describe("findVoiceDrift：角色腔调漂移（第七类）", () => {
  const names = ["林潮生", "苏映月"];

  /** 造一章：某角色说 n 句指定长度的引语，叙述里点名。 */
  function lines(name: string, quote: string, times: number): string {
    return Array.from({ length: times }, () => `${name}皱眉：「${quote}」`).join("\n");
  }

  it("某章话风突变（短句突变长句）→ 报疑似，带该章均值与基线均值", () => {
    // 第 0~2 章：林潮生一律说 8 字短句，苏映月一律说 20 字长句。
    const steady = [0, 1, 2].map((docIndex) => ({
      docIndex,
      content:
        lines("林潮生", "把刀放下再说", 4) +
        "\n" +
        lines("苏映月", "这件事你要从头到尾给我说清楚", 3)
    }));
    // 第 3 章：林潮生突然说起 24 字长句——漂移。
    const drifted = [
      ...steady,
      { docIndex: 3, content: lines("林潮生", "你要是不肯把当年渡口那一夜的事情原原本本讲出来", 5) }
    ];
    const suspects = findVoiceDrift(names, drifted);
    expect(suspects).toHaveLength(1);
    expect(suspects[0]).toMatchObject({
      name: "林潮生",
      docIndex: 3
    });
    expect(suspects[0]!.chapterMean).toBeGreaterThan(suspects[0]!.baselineMean * 1.5);
  });

  it("样本不足不报：该章引语太少、或该角色全书引语太少", () => {
    const sparse = [
      { docIndex: 0, content: lines("林潮生", "把刀放下再说", 2) },
      {
        docIndex: 1,
        content:
          lines("林潮生", "把刀放下再说", 30) +
          "\n" +
          lines("林潮生", "这一句突然变得特别特别长长长长长", 3)
      }
    ];
    expect(findVoiceDrift(names, sparse)).toHaveLength(0);
  });

  it("归属口径：引语内部的名字不算说话人；一行两个名字不猜", () => {
    // 「林潮生」只出现在引语内部 → 不归属给任何人，成不了样本。
    const inside = [
      {
        docIndex: 0,
        content:
          "苏映月怒道：「林潮生你给我站住。」".repeat(0) +
          "\n" +
          Array.from({ length: 12 }, () => "苏映月怒道：「林潮生你给我站住。」").join("\n")
      }
    ];
    expect(findVoiceDrift(names, inside)).toHaveLength(0);
    // 一行两个名字 → 不猜归属。
    const ambiguous = [
      {
        docIndex: 0,
        content:
          Array.from(
            { length: 12 },
            () => "林潮生看着苏映月：「这件事从头到尾你要给我说个清楚明白。」"
          ).join("\n") +
          "\n" +
          Array.from({ length: 6 }, () => "林潮生皱眉：「你走。」").join("\n")
      }
    ];
    expect(findVoiceDrift(names, ambiguous)).toHaveLength(0);
  });

  it("没有人物卡（空名单）直接返回空表", () => {
    expect(
      findVoiceDrift([], [{ docIndex: 0, content: lines("林潮生", "把刀放下再说", 10) }])
    ).toHaveLength(0);
  });
});

describe("topPhrases：高频词口头禅榜（第八类）", () => {
  it("按次数排序取 TOP，附每千字频次；「瞬间」这类内容词照得出来", () => {
    const chapter = "他瞬间明白过来。".repeat(10) + "她当即应了一声。".repeat(6);
    const rows = topPhrases([chapter]);
    const instant = rows.find((row) => row.phrase === "瞬间");
    expect(instant).toMatchObject({ phrase: "瞬间", count: 10 });
    expect(instant!.perThousand).toBeGreaterThan(0);
    const atOnce = rows.find((row) => row.phrase === "当即");
    expect(atOnce).toBeDefined();
    expect(atOnce!.count).toBe(6);
    // 按次数降序：10 次的排在 6 次的前面。
    expect(rows.findIndex((r) => r.phrase === "瞬间")).toBeLessThan(
      rows.findIndex((r) => r.phrase === "当即")
    );
  });

  it("语法停用词不进榜（「的话」「一个」是汉语高频，不是你的口头禅）", () => {
    const chapter = "他的话没有一个准头。".repeat(5);
    const rows = topPhrases([chapter]);
    expect(rows.find((row) => row.phrase === "的话")).toBeUndefined();
    expect(rows.find((row) => row.phrase === "一个")).toBeUndefined();
  });

  it("标点与空白切断双字组合，不拼出跨标点的假词；frontmatter 不计入", () => {
    const chapter = "林潮生收刀。林潮生抬头。\n林潮生走了。";
    const rows = topPhrases([chapter]);
    expect(rows.find((row) => row.phrase === "林潮")).toBeDefined();
    // 「刀林」「头林」这类跨标点拼合不许出现。
    expect(rows.find((row) => row.phrase === "刀林")).toBeUndefined();
    expect(rows.find((row) => row.phrase === "头林")).toBeUndefined();
    // frontmatter（title: 瞬间瞬间）不算正文用词。
    const withMeta = "---\ntitle: 瞬间瞬间瞬间\n---\n正文只有一句话。";
    const metaRows = topPhrases([withMeta]);
    expect(metaRows.find((row) => row.phrase === "瞬间")).toBeUndefined();
  });

  it("空书返回空榜", () => {
    expect(topPhrases([])).toHaveLength(0);
    expect(topPhrases([""])).toHaveLength(0);
  });
});

describe("chapterReadoutRows：逐章活性／退化读数（第九节）", () => {
  /** ≥10 句（句级读数才出数）、长短交错（突发度非平凡）。 */
  const mixed = Array.from({ length: 12 }, (_, i) =>
    i % 3 === 0 ? "他走。" : "他慢慢地走过来了，又停了一下。"
  ).join("\n");
  /** 3 句——不足 `SENTENCE_SPREAD_MIN_SENTENCES`，三枚句级读数应当算不出。 */
  const tooShort = "他走。\n她笑。\n天黑了。";

  it("行序＝章序（不排序）；四枚读数逐位等于真身读数，字数＝正文长度", () => {
    // 故意把「短句占比更高」的那章放在后面：若按读数排序，行序会翻——本用例就红。
    const rows = chapterReadoutRows([
      { docIndex: 0, content: mixed },
      { docIndex: 1, content: tooShort }
    ]);
    expect(rows.map((row) => row.docIndex)).toEqual([0, 1]);
    for (const [idx, row] of rows.entries()) {
      const content = idx === 0 ? mixed : tooShort;
      expect(row.charCount).toBe(content.length);
      expect(row.burstiness).toBe(vitalityOf(content).burstiness);
      expect(row.particlePerThousand).toBe(degenerationOf(content).particlePerThousand);
      expect(row.shortSentenceRatio).toBe(degenerationOf(content).shortSentenceRatio);
      expect(row.meanSentenceLength).toBe(degenerationOf(content).meanSentenceLength);
    }
  });

  it("刻意排除随长度偏高的熵与字多样性——行里不许有这两个读数", () => {
    const row = chapterReadoutRows([{ docIndex: 0, content: mixed }])[0]!;
    expect(row).not.toHaveProperty("ngramEntropy");
    expect(row).not.toHaveProperty("diversity");
    expect(Object.keys(row).sort()).toEqual([
      "burstiness",
      "charCount",
      "docIndex",
      "meanSentenceLength",
      "particlePerThousand",
      "shortSentenceRatio"
    ]);
  });

  it("不足 10 句的短章：三枚句级读数为 null、虚词密度照出；空文本全 null；空入参空表", () => {
    const [shortRow] = chapterReadoutRows([{ docIndex: 0, content: tooShort }]);
    expect(shortRow).toMatchObject({
      burstiness: null,
      shortSentenceRatio: null,
      meanSentenceLength: null
    });
    expect(shortRow!.particlePerThousand).toBe(degenerationOf(tooShort).particlePerThousand);

    const [emptyRow] = chapterReadoutRows([{ docIndex: 0, content: "" }]);
    expect(emptyRow).toMatchObject({ charCount: 0, particlePerThousand: null });

    expect(chapterReadoutRows([])).toHaveLength(0);
  });
});
