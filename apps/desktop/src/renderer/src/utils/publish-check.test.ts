/**
 * W-08 发布前检查守卫：判据只吃本地事实，覆盖度不许谎报。
 */
import { describe, expect, it } from "vitest";
import {
  PUBLISH_ISSUE_KINDS,
  PUBLISH_ISSUE_LABELS,
  parseBannedWords,
  passingChapterPaths,
  publishCheck,
  publishCheckSummary,
  type PublishChapter
} from "./publish-check";

function chapter(relPath: string, title: string, chars: number, content?: string): PublishChapter {
  return { relPath, title, chars, ...(content === undefined ? {} : { content }) };
}

const kinds = (issues: { kind: string }[]): string[] => issues.map((issue) => issue.kind);

describe("parseBannedWords：作者填什么就查什么", () => {
  it("逗号 / 顿号 / 换行都算分隔，去重去空，过长单条丢掉", () => {
    expect(parseBannedWords("阿猫,阿狗、阿猫\n  阿鸟  ,, ")).toEqual(["阿猫", "阿狗", "阿鸟"]);
    expect(parseBannedWords("  ")).toEqual([]);
    expect(parseBannedWords("x".repeat(33))).toEqual([]);
  });
});

describe("结构项：零额外读盘，覆盖全书", () => {
  it("空章与坏读数：0 / 负数 / NaN 都报，正常章不报", () => {
    const result = publishCheck(
      [
        chapter("a", "第一章", 0),
        chapter("b", "第二章", -5),
        chapter("c", "第三章", Number.NaN),
        chapter("d", "第四章", 3000)
      ],
      []
    );
    expect(result.checkedChapterCount).toBe(4);
    expect(result.issues.filter((i) => i.kind === "empty")).toHaveLength(3);
    expect(result.issues.every((i) => i.relPath !== "d")).toBe(true);
  });

  it("重复章名：trim 后同名才算，两篇都在清单里，空标题不报", () => {
    const result = publishCheck(
      [chapter("a", "第一章 ", 1000), chapter("b", "第一章", 1000), chapter("c", "", 1000)],
      []
    );
    const dup = result.issues.filter((i) => i.kind === "duplicate-title");
    expect(dup.map((i) => i.relPath)).toEqual(["a", "b"]);
    expect(dup[0]?.detail).toContain("2 篇");
  });

  it("字数异常：跟这本书自己的中位数比，少于三章不乱报，空章不重复报", () => {
    const few = publishCheck([chapter("a", "甲", 100), chapter("b", "乙", 9000)], []);
    expect(kinds(few.issues)).not.toContain("word-count-outlier");
    const result = publishCheck(
      [
        chapter("a", "甲", 3000),
        chapter("b", "乙", 3000),
        chapter("c", "丙", 3000),
        chapter("d", "丁", 500),
        chapter("e", "戊", 12000),
        chapter("f", "己", 0)
      ],
      []
    );
    const outliers = result.issues.filter((i) => i.kind === "word-count-outlier");
    expect(outliers.map((i) => i.relPath)).toEqual(["d", "e"]);
    expect(outliers[0]?.detail).toContain("中位数 3,000 字");
    expect(result.issues.filter((i) => i.relPath === "f").map((i) => i.kind)).toEqual(["empty"]);
  });

  it("章节断号：只认「第N章」，认不出不猜；断号是书级问题，不指向任何一章", () => {
    const result = publishCheck(
      [
        chapter("a", "第 1 章 起", 1000),
        chapter("b", "第 3 章 转", 1000),
        chapter("c", "番外·雨", 1000)
      ],
      []
    );
    const gaps = result.issues.filter((i) => i.kind === "numbering-gap");
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.relPath).toBe("");
    expect(gaps[0]?.detail).toContain("缺 第 2 章");
    expect(
      publishCheck([chapter("a", "第一章", 100), chapter("b", "第三章", 100)], []).issues.some(
        (i) => i.kind === "numbering-gap"
      )
    ).toBe(false);
    expect(
      publishCheck([chapter("a", "第 1 章", 100), chapter("b", "楔子", 100)], []).issues.some(
        (i) => i.kind === "numbering-gap"
      )
    ).toBe(false);
  });
});

describe("自定义禁词：只查读出正文的章，覆盖度如实回报", () => {
  const chapters = [
    chapter("a", "甲", 1000, "阿猫来了，阿猫又走了。Cat 也在。"),
    chapter("b", "乙", 1000, "干干净净。"),
    chapter("c", "丙", 1000) // 正文没读出来
  ];

  it("大小写不敏感、逐词计数、没读正文的章不参与也不计入覆盖", () => {
    const result = publishCheck(chapters, ["阿猫", "cat"]);
    expect(result.checkedContentCount).toBe(2);
    const hit = result.issues.filter((i) => i.kind === "banned-word");
    expect(hit).toHaveLength(1);
    expect(hit[0]?.relPath).toBe("a");
    expect(hit[0]?.detail).toContain("「阿猫」2 次");
    expect(hit[0]?.detail).toContain("「cat」1 次");
  });

  it("空词表就一个字都不查，不许拿「没查出」冒充「全书没有」", () => {
    const result = publishCheck(chapters, []);
    expect(result.checkedContentCount).toBe(0);
    expect(kinds(result.issues)).not.toContain("banned-word");
  });
});

describe("汇总与「只勾检查通过的章」", () => {
  it("汇总按检查顺序排，没问题给一句人话", () => {
    const clean = publishCheck([chapter("a", "第 1 章", 3000), chapter("b", "第 2 章", 3000)], []);
    expect(publishCheckSummary(clean)).toBe("没发现问题");
    const dirty = publishCheck(
      [chapter("a", "第 1 章", 0), chapter("b", "第 1 章", 0), chapter("c", "第 3 章", 3000)],
      []
    );
    expect(publishCheckSummary(dirty)).toBe("空章 2 · 重复章名 2 · 章节断号 1");
    expect(Object.keys(PUBLISH_ISSUE_LABELS)).toEqual([...PUBLISH_ISSUE_KINDS]);
  });

  it("章级问题排除该章，书级断号不排除任何一章，顺序照原样", () => {
    const chapters = [
      chapter("a", "第 1 章", 0),
      chapter("b", "第 2 章", 3000),
      chapter("c", "第 4 章", 3000)
    ];
    const result = publishCheck(chapters, []);
    expect(result.issues.some((i) => i.kind === "numbering-gap")).toBe(true);
    expect(passingChapterPaths(chapters, result.issues)).toEqual(["b", "c"]);
  });
});
