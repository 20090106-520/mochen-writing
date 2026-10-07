import { describe, expect, it } from "vitest";
import {
  CHAPTER_OUTLINE_FIELDS,
  CHAPTER_OUTLINE_LABELS,
  VOLUME_OUTLINE_BLIND_SPOTS,
  buildChapterOutlineMarkdown,
  chapterCompleteness,
  parseVolumeOutline,
  summedWordTarget,
  type ParsedChapter
} from "../src/volume-outline.js";

/** 造一段卷纲：标题行 + 若干字段行。 */
function vol(...lines: string[]): string {
  return ["# 第一卷 潮信", ...lines, ""].join("\n");
}

describe("字段表是穷尽的", () => {
  it("标签表与字段表逐字对齐（加一个字段忘了写标签，这里就红）", () => {
    expect(Object.keys(CHAPTER_OUTLINE_LABELS).sort()).toEqual([...CHAPTER_OUTLINE_FIELDS].sort());
  });

  it("每个标签都有中文名，且不是空串（空标签在面板上就是一个没有字的胶囊）", () => {
    for (const field of CHAPTER_OUTLINE_FIELDS) {
      expect(CHAPTER_OUTLINE_LABELS[field].length, field).toBeGreaterThan(0);
    }
  });

  it("盲区块非空且每条都是中文提示（空数组会让面板那块什么都不显示）", () => {
    expect(VOLUME_OUTLINE_BLIND_SPOTS.length).toBeGreaterThan(0);
    for (const line of VOLUME_OUTLINE_BLIND_SPOTS) expect(line.trim().length).toBeGreaterThan(0);
  });
});

describe("认章：两条规则各走一遍", () => {
  it("`## 标题` 认成一章，并说清是哪条规则认的", () => {
    const out = parseVolumeOutline(vol("## 第一章 潮信", "- 视角：林晚"));
    expect(out.chapters).toHaveLength(1);
    expect(out.chapters[0]?.title).toBe("第一章 潮信");
    expect(out.chapters[0]?.detectedBy).toBe("heading");
  });

  it("`### 三级标题` 也认（一卷里常用的两级分层）", () => {
    const out = parseVolumeOutline(vol("### 1.1 抵港", "- 目标：上岸"));
    expect(out.chapters).toHaveLength(1);
    expect(out.chapters[0]?.title).toBe("1.1 抵港");
  });

  it("独立成行的「第N章」认成一章（中文数字与阿拉伯数字都认）", () => {
    const out = parseVolumeOutline(vol("第 3 章 潮信", "第三章 起风"));
    expect(out.chapters.map((c) => c.title)).toEqual(["潮信", "起风"]);
    for (const c of out.chapters) expect(c.detectedBy).toBe("numbered");
  });

  it("「第N章」后面没标题时用整行原文当标题，不给一个空白的行给你", () => {
    const out = parseVolumeOutline(vol("第三章"));
    expect(out.chapters[0]?.title).toBe("第三章");
  });

  it("一级标题不是章（那是卷纲自己的标题，别把它算成第一章）", () => {
    const out = parseVolumeOutline("# 第一卷\n\n## 第一章 潮信");
    expect(out.chapters).toHaveLength(1);
  });

  it("出场次序就是文档次序，**不**按标题里的数字重排", () => {
    const out = parseVolumeOutline(vol("## 第九章 后话", "## 第一章 起风"));
    expect(out.chapters.map((c) => c.order)).toEqual([1, 2]);
    expect(out.chapters[0]?.title).toBe("第九章 后话");
  });

  it("认不出章时给一句中文说明，不给空数组让用户自己猜", () => {
    const out = parseVolumeOutline("就一段提要，没有分章。");
    expect(out.chapters).toEqual([]);
    expect(out.note).toContain("没认出章节");
    expect(out.note).toContain("## 标题");
  });

  it("认不出章且开头为空时，说明不带「…」这种悬空的省略号", () => {
    const out = parseVolumeOutline("");
    expect(out.chapters).toEqual([]);
    expect(out.note).not.toContain("…");
  });

  it("开头有提要时，把提要的头几个字引出来（用户能对上是不是这篇）", () => {
    const out = parseVolumeOutline("这是一段很长的提要，讲主角怎么到的海边。");
    expect(out.note).toContain("这是一段很长的提要");
  });

  it("第一章之前的内容不进任何一章的 body（总纲不是第一章的提要）", () => {
    const out = parseVolumeOutline(vol("## 第一章 潮信", "- 视角：林晚"));
    expect(out.chapters[0]?.body).toBe("");
  });
});

describe("字段行", () => {
  it("六个字段都认，且值原文照留（一个字都不改写）", () => {
    const out = parseVolumeOutline(
      vol(
        "## 第一章 潮信",
        "- 视角：林晚",
        "- 目标：找到失踪的哥哥",
        "- 冲突：海关不让她下船",
        "- 转折：名单上有哥哥的名字",
        "- 钩子：署名是哥哥的笔迹",
        "- 字数：3200"
      )
    );
    const c = out.chapters[0];
    expect(c?.fields.pov).toBe("林晚");
    expect(c?.fields.goal).toBe("找到失踪的哥哥");
    expect(c?.fields.conflict).toBe("海关不让她下船");
    expect(c?.fields.turn).toBe("名单上有哥哥的名字");
    expect(c?.fields.hook).toBe("署名是哥哥的笔迹");
    expect(c?.fields.wordTarget).toBe("3200");
    expect(c?.missing).toEqual([]);
  });

  it("别名归一到同一字段（阻力=冲突、尾钩=钩子、目标字数=字数）", () => {
    const out = parseVolumeOutline(
      vol("## 第一章", "- 阻力：军队", "- 尾钩：一封信", "- 目标字数：2800")
    );
    const c = out.chapters[0];
    expect(c?.fields.conflict).toBe("军队");
    expect(c?.fields.hook).toBe("一封信");
    expect(c?.fields.wordTarget).toBe("2800");
  });

  it("POV / pov 之类的大小写都认", () => {
    const out = parseVolumeOutline(vol("## 第一章", "- POV: 林晚", "- pov：林晚"));
    expect(out.chapters[0]?.fields.pov).toBe("林晚");
  });

  it("加粗标签与半角冒号都认", () => {
    const out = parseVolumeOutline(vol("## 第一章", "- **目标**: 下船"));
    expect(out.chapters[0]?.fields.goal).toBe("下船");
  });

  it("没有项目符号的裸字段行也认（很多作者就是这么写）", () => {
    const out = parseVolumeOutline(vol("## 第一章", "视角：林晚"));
    expect(out.chapters[0]?.fields.pov).toBe("林晚");
  });

  it("值里带冒号不截断（`- 钩子：他说：别去` 要整句都留着）", () => {
    const out = parseVolumeOutline(vol("## 第一章", "- 钩子：他说：别去"));
    expect(out.chapters[0]?.fields.hook).toBe("他说：别去");
  });

  it("值留空也算「没写」，不当作写了空串", () => {
    const out = parseVolumeOutline(vol("## 第一章", "- 视角："));
    expect(out.chapters[0]?.fields.pov).toBe("");
    expect(out.chapters[0]?.missing).toContain("pov");
  });

  it("认不出的标签整行留在 body 里，不被吃掉（那是作者的正文提要）", () => {
    const out = parseVolumeOutline(vol("## 第一章", "节奏：慢热", "- 视角：林晚"));
    expect(out.chapters[0]?.body).toContain("节奏：慢热");
  });

  it("同一个字段写两遍：后写的盖前面的，且前一句留在 body 里等人来判断", () => {
    const out = parseVolumeOutline(vol("## 第一章", "- 视角：林晚", "- 视角：其实是妹妹"));
    const c = out.chapters[0];
    expect(c?.fields.pov).toBe("其实是妹妹");
    expect(c?.body).toContain("视角：林晚");
  });

  it("缺哪些字段是**派生**的，不另存一份——只读 fields 就能重算出来", () => {
    const out = parseVolumeOutline(vol("## 第一章", "- 视角：林晚"));
    const c = out.chapters[0];
    const recomputed = CHAPTER_OUTLINE_FIELDS.filter((f) => (c?.fields[f] ?? "") === "");
    expect(c?.missing).toEqual(recomputed);
  });
});

describe("字数：读得出才算，读不出不猜", () => {
  it("纯整数读得出", () => {
    expect(parseVolumeOutline(vol("## 第一章", "- 字数：3200")).chapters[0]?.wordTarget).toBe(3200);
  });

  it("带「字」「约」也读得出", () => {
    expect(parseVolumeOutline(vol("## 第一章", "- 字数：约 3200 字")).chapters[0]?.wordTarget).toBe(
      3200
    );
  });

  it("中文数字读不出就是 null，**不猜**（猜错一个数比留空更坏）", () => {
    expect(
      parseVolumeOutline(vol("## 第一章", "- 字数：三千字")).chapters[0]?.wordTarget
    ).toBeNull();
  });

  it("0 与负数不是字数目标", () => {
    expect(parseVolumeOutline(vol("## 第一章", "- 字数：0")).chapters[0]?.wordTarget).toBeNull();
  });

  it("总和把读不出的那几章**单独计数**，不当成 0 混进总数", () => {
    const out = parseVolumeOutline(
      vol("## 第一章", "- 字数：3200", "## 第二章", "- 字数：三千", "## 第三章", "- 字数：2800")
    );
    expect(summedWordTarget(out.chapters)).toEqual({ total: 6000, unreadable: 1 });
  });

  it("**没写字数**的章既不算进总数，也不算「读不出」（真机撞出来的语义错）", () => {
    // 一个字段都没写的那一节，早先被算成「写了数字但没读出来」——
    // 面板会替作者说一句他没说过的话。
    const out = parseVolumeOutline(
      vol("## 第一章", "- 字数：3200", "## 人物线", "三个人的动机。", "## 第二章", "- 视角：林晚")
    );
    expect(summedWordTarget(out.chapters)).toEqual({ total: 3200, unreadable: 0 });
  });

  it("只有真写了读不出的数字才进 unreadable", () => {
    const out = parseVolumeOutline(vol("## 第一章", "- 字数：三千字", "## 第二章", "一段提要。"));
    expect(summedWordTarget(out.chapters)).toEqual({ total: 0, unreadable: 1 });
  });
});

describe("完整度与「这一节可能不是一章」", () => {
  it("字段写全 = 1，全空 = 0", () => {
    const full = parseVolumeOutline(
      vol("## A", "- 视角：a", "- 目标：a", "- 冲突：a", "- 转折：a", "- 钩子：a", "- 字数：100")
    );
    expect(chapterCompleteness(full.chapters[0]!)).toBe(1);

    const empty = parseVolumeOutline(vol("## B", "这里只有一段提要。"));
    expect(chapterCompleteness(empty.chapters[0]!)).toBe(0);
  });

  it("一个字段都没写的节标成 loose（多半是分组标题，但**由作者定**，不由工具定）", () => {
    const out = parseVolumeOutline(
      vol("## 人物线", "三个人的动机。", "## 第一章 潮信", "- 视角：林晚")
    );
    expect(out.chapters[0]?.isLoose).toBe(true);
    expect(out.chapters[1]?.isLoose).toBe(false);
  });
});

describe("frontmatter 不参与判定", () => {
  it("文件头的 frontmatter 不会被当成章节或字段", () => {
    const raw = [
      "---",
      "title: 第一卷 潮信",
      "字数: 3000",
      "---",
      "",
      "## 第一章 潮信",
      "- 视角：林晚"
    ].join("\n");
    const out = parseVolumeOutline(raw);
    expect(out.chapters).toHaveLength(1);
    expect(out.chapters[0]?.fields.wordTarget).toBe("");
  });
});

describe("边界输入不炸也不编", () => {
  it("空串回零章加说明", () => {
    expect(parseVolumeOutline("").chapters).toEqual([]);
  });

  it("undefined 也不炸（读盘失败时上层可能递 undefined 进来）", () => {
    expect(parseVolumeOutline(undefined as unknown as string).chapters).toEqual([]);
  });

  it("CRLF 行尾照样认得出字段（Windows 上写的大概率是 CRLF）", () => {
    const out = parseVolumeOutline("## 第一章 潮信\r\n- 视角：林晚\r\n");
    expect(out.chapters[0]?.fields.pov).toBe("林晚");
  });

  it("BOM 开头的文件照样认得出（BOM 不是正文字符）", () => {
    const out = parseVolumeOutline(`${String.fromCharCode(0xfeff)}## 第一章 潮信\n- 视角：林晚`);
    expect(out.chapters).toHaveLength(1);
    expect(out.chapters[0]?.fields.pov).toBe("林晚");
  });

  it("没有 frontmatter 的文件不受影响", () => {
    expect(parseVolumeOutline("## 第一章\n- 视角：a").chapters).toHaveLength(1);
  });
});

describe("生成章纲：往返一致（读回来就是原来那几个字段）", () => {
  const SRC = vol(
    "## 第一章 潮信",
    "- 视角：林晚",
    "- 目标：找到失踪的哥哥",
    "- 字数：3200",
    "",
    "她站在甲板上，风很大。"
  );
  const chapter = (): ParsedChapter => parseVolumeOutline(SRC).chapters[0]!;

  it("拼出来的章纲再被解析一次，字段原样回来（这条是硬要求）", () => {
    const md = buildChapterOutlineMarkdown(chapter(), "第一卷 潮信");
    const back = parseVolumeOutline(md).chapters[0];
    expect(back?.fields.pov).toBe("林晚");
    expect(back?.fields.goal).toBe("找到失踪的哥哥");
    expect(back?.fields.wordTarget).toBe("3200");
    expect(back?.wordTarget).toBe(3200);
  });

  it("没写的字段**不进文件**（写空值会被下一次解析读成「写了空」，占位符更糟）", () => {
    const md = buildChapterOutlineMarkdown(chapter(), "第一卷 潮信");
    for (const label of ["冲突", "转折", "钩子", "待补"]) {
      expect(md, `不该出现「${label}」`).not.toContain(label);
    }
  });

  it("生成之后再解析，缺的仍然是缺的（不因为生成过就变成填好了）", () => {
    const md = buildChapterOutlineMarkdown(chapter(), "第一卷");
    expect(parseVolumeOutline(md).chapters[0]?.missing).toEqual(["conflict", "turn", "hook"]);
  });

  it("正文提要原样带过去", () => {
    expect(buildChapterOutlineMarkdown(chapter(), "第一卷")).toContain("她站在甲板上");
  });

  it("来路写在正文末尾的引用行里，**不进 frontmatter**（卷纲改名不该牵动已生成的文件）", () => {
    const md = buildChapterOutlineMarkdown(chapter(), "第一卷 潮信");
    expect(md.startsWith("---")).toBe(false);
    expect(md).toContain("> 来自《第一卷 潮信》第 1 章。");
  });

  it("结尾带换行，写进盘上是个完整的文件", () => {
    expect(buildChapterOutlineMarkdown(chapter(), "第一卷").endsWith("\n")).toBe(true);
  });

  it("标题带括号也不破解析（`#` 之后跟标题就好）", () => {
    const md = buildChapterOutlineMarkdown({ ...chapter(), title: "第一章 潮信（下）" }, "第一卷");
    expect(parseVolumeOutline(md).chapters[0]?.title).toBe("第一章 潮信（下）");
  });

  it("一个字段都没写的 loose 节生成出来仍是没有字段的空提要（不替它编）", () => {
    const loose = parseVolumeOutline(vol("## 人物线", "三个人的动机。")).chapters[0]!;
    const md = buildChapterOutlineMarkdown(loose, "第一卷");
    expect(parseVolumeOutline(md).chapters[0]?.missing).toEqual([...CHAPTER_OUTLINE_FIELDS]);
  });
});
