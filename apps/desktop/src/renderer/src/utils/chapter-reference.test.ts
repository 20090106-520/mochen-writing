import { describe, expect, it } from "vitest";
import { parseVolumeOutline, type DocRef } from "@mochen/contracts";
import type { ForeshadowRow } from "./foreshadow";
import {
  ambiguousOutlineText,
  briefFields,
  briefForeshadows,
  BRIEF_FIELD_LIMIT,
  BRIEF_FIELD_VALUE_LIMIT,
  BRIEF_FORESHADOW_LIMIT,
  EMPTY_FIELDS_TEXT,
  foreshadowTag,
  lookupChapterOutline,
  matchOutlineChapter,
  mentionedCharacters,
  NO_NAMED_CHARACTERS_TEXT,
  noOutlineText,
  notChapterText,
  outlineCandidates,
  outlineText,
  readOutlineDocs,
  type OutlineDoc
} from "./chapter-reference";

function doc(relPath: string, kind: DocRef["kind"], title: string): DocRef {
  return { relPath, kind, title };
}

function chapterMarkdown(title: string, lines: string[]): string {
  return [`## ${title}`, ...lines].join("\n");
}

function source(raw: string, title = "卷纲", relPath = "volumes/1.md"): OutlineDoc {
  return {
    doc: doc(relPath, "volume", title),
    chapters: parseVolumeOutline(raw).chapters
  };
}

function foreshadowRow(
  relPath: string,
  title: string,
  tone: ForeshadowRow["tone"],
  plantedIn = "",
  paidIn = ""
): ForeshadowRow {
  return {
    relPath,
    title,
    status: "planted",
    statusLabel: "已埋未收",
    plantedIn,
    paidIn,
    rawStatus: "",
    keywords: [],
    tone
  };
}

describe("读章纲文稿：四种没有数据的情形都回空表", () => {
  it("缺文件 / 目录（readDoc 直接拒绝）不抛，跳过那一条", async () => {
    const docs = [doc("outline/a.md", "outline", "甲")];
    await expect(
      readOutlineDocs(docs, async () => {
        throw new Error("ENOENT: 缺文件");
      })
    ).resolves.toEqual([]);
    await expect(
      readOutlineDocs(docs, async () => {
        throw new Error("EISDIR: 是个目录");
      })
    ).resolves.toEqual([]);
    // 同步抛也要被翻成空表：allSettled 本身兜不住 map 阶段抛出的异常。
    await expect(
      readOutlineDocs(docs, () => {
        throw new Error("同步抛");
      })
    ).resolves.toEqual([]);
  });

  it("形状不认（不是 { content: string }）回空表", async () => {
    const docs = [doc("outline/a.md", "outline", "甲")];
    await expect(readOutlineDocs(docs, async () => null)).resolves.toEqual([]);
    await expect(readOutlineDocs(docs, async () => ({}))).resolves.toEqual([]);
    await expect(readOutlineDocs(docs, async () => ({ content: 42 }))).resolves.toEqual([]);
  });

  it("坏 JSON 不是章纲 markdown，解析不出章就回空表", async () => {
    const docs = [doc("outline/a.md", "outline", "甲")];
    await expect(
      readOutlineDocs(docs, async () => ({ content: '{"chapters":[{"title":"潮信"}]}' }))
    ).resolves.toEqual([]);
  });

  it("一条坏不影响另一条：坏的那篇跳过，好的照读", async () => {
    const docs = [doc("outline/bad.md", "outline", "坏"), doc("outline/good.md", "outline", "好")];
    const result = await readOutlineDocs(docs, async (relPath) => {
      if (relPath === "outline/bad.md") throw new Error("EISDIR: 是个目录");
      return { content: chapterMarkdown("潮信", ["目标：找到灯塔"]) };
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.doc.relPath).toBe("outline/good.md");
    expect(result[0]!.chapters[0]!.title).toBe("潮信");
  });
});

describe("按标题逐字找本章", () => {
  it("一处对上就是 ok，并带回来源文稿", () => {
    const lookup = matchOutlineChapter(
      [source(chapterMarkdown("潮信", ["目标：找到灯塔"]))],
      "潮信"
    );
    expect(lookup.kind).toBe("ok");
    if (lookup.kind !== "ok") return;
    expect(lookup.match.chapter.fields.goal).toBe("找到灯塔");
    expect(lookup.match.sourceTitle).toBe("卷纲");
  });

  it("对不上就是 none，不做近似匹配", () => {
    const lookup = matchOutlineChapter([source(chapterMarkdown("潮信", ["目标：找到灯塔"]))], "潮");
    expect(lookup.kind).toBe("none");
  });

  it("两处同名但内容一致：可取第一处（生成章纲与卷纲并存的常见情形）", () => {
    const raw = chapterMarkdown("潮信", ["目标：找到灯塔"]);
    const lookup = matchOutlineChapter(
      [source(raw, "卷纲", "volumes/1.md"), source(raw, "潮信", "outline/潮信.md")],
      "潮信"
    );
    expect(lookup.kind).toBe("ok");
  });

  it("两处同名且内容不一致：ambiguous，不替作者挑", () => {
    const lookup = matchOutlineChapter(
      [
        source(chapterMarkdown("潮信", ["目标：找到灯塔"]), "卷纲", "volumes/1.md"),
        source(chapterMarkdown("潮信", ["目标：另一件事"]), "另一卷", "volumes/2.md")
      ],
      "潮信"
    );
    expect(lookup.kind).toBe("ambiguous");
    if (lookup.kind !== "ambiguous") return;
    expect(lookup.count).toBe(2);
  });

  it("候选先读分卷与同名大纲，其余大纲留到第二遍", () => {
    const docs = [
      doc("volumes/1.md", "volume", "第一卷"),
      doc("outline/潮信.md", "outline", "潮信"),
      doc("outline/总纲.md", "outline", "总纲")
    ];
    expect(outlineCandidates(docs, "潮信").map((one) => one.relPath)).toEqual([
      "volumes/1.md",
      "outline/潮信.md"
    ]);
  });

  it("第一遍没对上才退回读其余大纲（只认正文里的章标题）", async () => {
    const docs = [doc("outline/总纲.md", "outline", "总纲")];
    const reads: string[] = [];
    const lookup = await lookupChapterOutline(docs, "潮信", async (relPath) => {
      reads.push(relPath);
      return { content: chapterMarkdown("潮信", ["目标：找到灯塔"]) };
    });
    expect(reads).toEqual(["outline/总纲.md"]);
    expect(lookup.kind).toBe("ok");
  });

  it("第一遍命中就不再读其余大纲", async () => {
    const docs = [
      doc("volumes/1.md", "volume", "第一卷"),
      doc("outline/潮信.md", "outline", "潮信"),
      doc("outline/别的.md", "outline", "别的")
    ];
    const reads: string[] = [];
    await lookupChapterOutline(docs, "潮信", async (relPath) => {
      reads.push(relPath);
      if (relPath === "volumes/1.md") {
        return { content: chapterMarkdown("潮信", ["目标：找到灯塔"]) };
      }
      return { content: chapterMarkdown("别的", ["目标：另一件事"]) };
    });
    expect(reads).toContain("volumes/1.md");
    expect(reads).not.toContain("outline/别的.md");
  });

  it("章标题为空时不读盘、直接回 none", async () => {
    let called = false;
    const lookup = await lookupChapterOutline(
      [doc("volumes/1.md", "volume", "第一卷")],
      "  ",
      async () => {
        called = true;
        return { content: "" };
      }
    );
    expect(called).toBe(false);
    expect(lookup.kind).toBe("none");
  });
});

describe("章纲摘要：只挑关键项、只截短，不整段复制", () => {
  const all = parseVolumeOutline(
    chapterMarkdown("潮信", [
      "视角：林舟",
      "目标：找到灯塔",
      "冲突：守夜人拦路",
      "转折：潮水提前",
      "钩子：灯灭了",
      "字数：3000"
    ])
  ).chapters[0]!;

  it("按目标/冲突/转折/钩子的次序挑，最多四项", () => {
    const fields = briefFields(all);
    expect(fields).toHaveLength(BRIEF_FIELD_LIMIT);
    expect(fields.map((one) => one.label)).toEqual(["目标", "冲突", "转折", "钩子"]);
    expect(fields[0]!.value).toBe("找到灯塔");
  });

  it("核心四项都没写时，视角与字数也能兜底", () => {
    const chapter = parseVolumeOutline(chapterMarkdown("潮信", ["视角：林舟", "字数：3000"]))
      .chapters[0]!;
    expect(briefFields(chapter).map((one) => one.label)).toEqual(["视角", "字数"]);
  });

  it("六项全空回空表，由调用处说明", () => {
    const chapter = parseVolumeOutline(chapterMarkdown("潮信", [])).chapters[0]!;
    expect(briefFields(chapter)).toEqual([]);
    expect(EMPTY_FIELDS_TEXT).toBe("这一章章纲六项都还没写。");
  });

  it("过长的一项截到上限，原文不搬过来", () => {
    const long = "甲".repeat(BRIEF_FIELD_VALUE_LIMIT + 10);
    const chapter = parseVolumeOutline(chapterMarkdown("潮信", [`目标：${long}`])).chapters[0]!;
    const value = briefFields(chapter)[0]!.value;
    expect(value).toBe(`${"甲".repeat(BRIEF_FIELD_VALUE_LIMIT)}…`);
  });
});

describe("出场人物：只认标题逐字出现在章纲里", () => {
  const chapter = parseVolumeOutline(
    chapterMarkdown("潮信", ["视角：林舟", "目标：找到灯塔", "守夜人周叙在门口"])
  ).chapters[0]!;
  const cards = [
    doc("characters/林舟.md", "character", "林舟"),
    doc("characters/周叙.md", "character", "周叙"),
    doc("characters/沈墨.md", "character", "沈墨")
  ];

  it("命中的才出现，未命中的不凭语义补", () => {
    expect(mentionedCharacters(cards, outlineText(chapter))).toEqual(["林舟", "周叙"]);
  });

  it("章纲一个人名都没提到：回空表，界面说「本章章纲未点名人物」", () => {
    const blank = parseVolumeOutline(chapterMarkdown("潮信", ["目标：找到灯塔"])).chapters[0]!;
    expect(mentionedCharacters(cards, outlineText(blank))).toEqual([]);
    expect(NO_NAMED_CHARACTERS_TEXT).toBe("本章章纲未点名人物");
  });

  it("同名卡只出现一次；空标题的卡跳过", () => {
    const duplicated = [
      doc("characters/1.md", "character", "林舟"),
      doc("characters/2.md", "character", "  ")
    ];
    expect(mentionedCharacters(duplicated, "林舟走进灯塔")).toEqual(["林舟"]);
  });
});

describe("待回收伏笔：只取已埋未收，按台账里写死的路径排序", () => {
  const rows = [
    foreshadowRow("foreshadow/1.md", "A", "pending"),
    foreshadowRow("foreshadow/2.md", "B", "paid"),
    foreshadowRow("foreshadow/3.md", "C", "pending", "chapters/03.md"),
    foreshadowRow("foreshadow/4.md", "D", "pending", "", "chapters/03.md"),
    foreshadowRow("foreshadow/5.md", "E", "broken"),
    foreshadowRow("foreshadow/6.md", "F", "unknown"),
    foreshadowRow("foreshadow/7.md", "G", "pending"),
    foreshadowRow("foreshadow/8.md", "H", "pending")
  ];

  it("paid / broken / unknown 不算待回收，但异常条数如实报出来", () => {
    const brief = briefForeshadows(rows, "chapters/03.md");
    expect(brief.pendingTotal).toBe(5);
    expect(brief.brokenTotal).toBe(1);
    expect(brief.unknownTotal).toBe(1);
    expect(brief.rows.map((one) => one.title)).toEqual(["D", "C", "A", "G", "H"]);
  });

  it("超过上限只列前五条，其余留给台账", () => {
    expect(briefForeshadows(rows, "chapters/03.md").rows).toHaveLength(BRIEF_FORESHADOW_LIMIT);
  });

  it("没有待回收时回空表，界面说「没有待回收的伏笔」", () => {
    const brief = briefForeshadows(
      [foreshadowRow("foreshadow/9.md", "已收", "paid")],
      "chapters/03.md"
    );
    expect(brief.pendingTotal).toBe(0);
    expect(brief.rows).toEqual([]);
  });

  it("关系标签只认路径：登记收于本章 / 本章埋下 / 待回收", () => {
    const active = "chapters/03.md";
    expect(foreshadowTag(foreshadowRow("f.md", "D", "pending", "", active), active)).toBe(
      "本章登记回收"
    );
    expect(foreshadowTag(foreshadowRow("f.md", "C", "pending", active), active)).toBe("本章埋下");
    expect(foreshadowTag(foreshadowRow("f.md", "A", "pending"), active)).toBe("待回收");
    expect(foreshadowTag(foreshadowRow("f.md", "A", "pending"), "")).toBe("待回收");
  });
});

describe("空态文案钉死在文案层", () => {
  it("没打开文稿 / 不是章节 / 对不上章纲都有诚实说法", () => {
    expect(noOutlineText("潮信")).toContain("《潮信》");
    expect(notChapterText("人物卡甲")).toBe(
      "当前打开的是《人物卡甲》，不是章节正文；本章参考只对章节正文成立。"
    );
    expect(ambiguousOutlineText("潮信", 2)).toContain("2 处");
  });
});
