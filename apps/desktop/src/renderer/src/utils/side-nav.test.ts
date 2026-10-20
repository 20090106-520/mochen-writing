import { describe, expect, it } from "vitest";
import {
  AI_CHECK_PROMPTS,
  BRAND_TAGLINE,
  EMPTY_DOCS_HINT,
  FOOTER_TAGLINE,
  NEED_BOOK_HINT,
  PLANNED_HINT,
  SIDE_NAV_GROUPS,
  aiCheckOf,
  sideNavChildState,
  styleCheckPrompt,
  type SideNavChild
} from "./side-nav";
import type { AiFlavorReport } from "@mochen/contracts";

describe("side-nav · 导航表（演示图的唯一真源）", () => {
  it("四个折叠组按图排序：小说大脑/故事规划/写作/审核检查，开合默认值照图（大脑开、其余收）", () => {
    expect(SIDE_NAV_GROUPS.map((group) => group.id)).toEqual([
      "brain",
      "plan",
      "writing",
      "review"
    ]);
    expect(SIDE_NAV_GROUPS.map((group) => group.label)).toEqual([
      "小说大脑",
      "故事规划",
      "写作",
      "审核检查"
    ]);
    expect(SIDE_NAV_GROUPS.map((group) => group.defaultOpen)).toEqual([true, false, false, false]);
  });

  it("组内子项逐字照图：大脑 7 项 / 规划 5 项 / 写作 2 项 / 审核 3 项", () => {
    // 2026-10-05：子项名改取 BOOK_KIND_LABELS 真身（左栏树分组、中栏提示同一套中文名）。
    expect(SIDE_NAV_GROUPS[0]?.children.map((child) => child.label)).toEqual([
      "世界观",
      "人物",
      "势力/组织",
      "地图",
      "时间线",
      "素材库",
      "专有名词"
    ]);
    expect(SIDE_NAV_GROUPS[1]?.children.map((child) => child.label)).toEqual([
      "大纲",
      "分卷",
      "章节管理",
      // 2026-10-05：伏笔台账（一条伏笔一篇文稿，状态在 frontmatter）落在这里。
      // 它走 action 而不是 docs——台账是跨文稿的聚合视图，不是某一类文稿的筛选。
      "伏笔台账",
      // 2026-10-05 批次 5-①：时间线核对（把全书 timeline 按 date 排一遍查矛盾），同款聚合视图。
      "时间线核对"
    ]);
    expect(SIDE_NAV_GROUPS[2]?.children.map((child) => child.label)).toEqual([
      "AI 写作",
      "章节编辑器"
    ]);
    expect(SIDE_NAV_GROUPS[3]?.children.map((child) => child.label)).toEqual([
      "一致性检查",
      "剧情审核",
      "逻辑检查",
      // 2026-10-10 去AI味：第四项检查，审 AI 腔套话与句式。
      "文风检查"
    ]);
  });

  it("真实身映射：大脑/规划 9 项全是文档类型，AI 写作/章节编辑器是既有动作", () => {
    const byLabel = new Map(
      SIDE_NAV_GROUPS.flatMap((group) => group.children).map((child) => [child.label, child])
    );
    expect(byLabel.get("世界观")?.reality).toEqual({ kind: "docs", docKind: "worldview" });
    expect(byLabel.get("人物")?.reality).toEqual({ kind: "docs", docKind: "character" });
    expect(byLabel.get("势力/组织")?.reality).toEqual({ kind: "docs", docKind: "faction" });
    expect(byLabel.get("地图")?.reality).toEqual({ kind: "docs", docKind: "location" });
    expect(byLabel.get("时间线")?.reality).toEqual({ kind: "docs", docKind: "timeline" });
    expect(byLabel.get("素材库")?.reality).toEqual({ kind: "docs", docKind: "material" });
    expect(byLabel.get("专有名词")?.reality).toEqual({ kind: "docs", docKind: "glossary" });
    expect(byLabel.get("大纲")?.reality).toEqual({ kind: "docs", docKind: "outline" });
    expect(byLabel.get("分卷")?.reality).toEqual({ kind: "docs", docKind: "volume" });
    expect(byLabel.get("章节管理")?.reality).toEqual({ kind: "docs", docKind: "chapter" });
    expect(byLabel.get("AI 写作")?.reality).toEqual({ kind: "action", action: "new-thread" });
    expect(byLabel.get("章节编辑器")?.reality).toEqual({
      kind: "action",
      action: "chapter-editor"
    });
  });

  it("审核四项已落地（2026-10-04 深夜裁定 + 2026-10-10 文风检查）：全是 ai-check 动作，口径提示词一一对应", () => {
    const byLabel = new Map(
      SIDE_NAV_GROUPS.flatMap((group) => group.children).map((child) => [child.label, child])
    );
    expect(byLabel.get("一致性检查")?.reality).toEqual({
      kind: "action",
      action: "ai-check-consistency"
    });
    expect(byLabel.get("剧情审核")?.reality).toEqual({ kind: "action", action: "ai-check-plot" });
    expect(byLabel.get("逻辑检查")?.reality).toEqual({ kind: "action", action: "ai-check-logic" });
    expect(byLabel.get("文风检查")?.reality).toEqual({ kind: "action", action: "ai-check-style" });
    // 四句提问都真实可用：说清检查对象与「没有就明说」，不装自动完成。
    for (const prompt of Object.values(AI_CHECK_PROMPTS)) {
      expect(prompt).toContain("当前章节");
      expect(prompt.length).toBeGreaterThan(20);
    }
    // id → 口径的反查（组件分派用）：ai-check 前缀识别 + 非法 id 拒绝。
    expect(aiCheckOf("ai-check-plot")).toBe("plot");
    expect(aiCheckOf("ai-check-style")).toBe("style");
    expect(aiCheckOf("new-thread")).toBeNull();
    expect(aiCheckOf("ai-check-nope")).toBeNull();
  });

  it("文案常量是诚实句子：标语逐字照图，占位说辞承认未落地、引导说辞指向真实入口", () => {
    expect(BRAND_TAGLINE).toBe("AI 智能体 · 小说创作系统");
    expect(FOOTER_TAGLINE).toBe("墨宸 AI · 让每一个故事，都有灵魂");
    expect(PLANNED_HINT).toContain("规划中");
    expect(NEED_BOOK_HINT).toContain("打开作品");
    expect(NEED_BOOK_HINT).toContain("新建");
    expect(EMPTY_DOCS_HINT).toContain("新建一篇");
  });
});

describe("sideNavChildState · 子项响应判定（纯函数：全部可点，四态各有真响应）", () => {
  const child = (reality: SideNavChild["reality"]): SideNavChild => ({ label: "x", reality });

  it("planned 可点但响应是占位说明（mode=planned）——不假装功能在，也不再做死按钮", () => {
    expect(sideNavChildState(child({ kind: "planned" }), [])).toEqual({
      mode: "planned",
      hint: PLANNED_HINT
    });
  });

  it("docs 类三态：没作品→need-book；有作品没这类→need-doc（带 docKind）；有→ready", () => {
    expect(sideNavChildState(child({ kind: "docs", docKind: "character" }), [])).toEqual({
      mode: "need-book",
      hint: NEED_BOOK_HINT
    });
    expect(
      sideNavChildState(child({ kind: "docs", docKind: "character" }), [{ kind: "chapter" }])
    ).toEqual({ mode: "need-doc", hint: EMPTY_DOCS_HINT, docKind: "character" });
    expect(
      sideNavChildState(child({ kind: "docs", docKind: "character" }), [
        { kind: "chapter" },
        { kind: "character" }
      ])
    ).toEqual({ mode: "ready", hint: "" });
  });

  it("action 类打底恒 ready（缺章细分在组件——那里才有 book 上下文）", () => {
    expect(sideNavChildState(child({ kind: "action", action: "new-thread" }), [])).toEqual({
      mode: "ready",
      hint: ""
    });
  });
});

describe("styleCheckPrompt · 文风检查的动态预填（2026-10-10 去AI味二段）", () => {
  const report: AiFlavorReport = {
    entries: [
      {
        term: "嘴角勾起",
        category: "cliche",
        count: 3,
        tier: "advisory",
        first: { docIndex: 0, line: 1, text: "他嘴角勾起。" }
      },
      {
        term: "不禁",
        category: "adverb",
        count: 5,
        tier: "advisory",
        first: { docIndex: 0, line: 2, text: "他不禁一愣。" }
      }
    ],
    totalHits: 8,
    charCount: 1000,
    perThousand: 8,
    meanSentenceLength: 15.2,
    sentenceSpread: 0.6
  };

  it("有命中：静态口径之上追加命中清单（带类型中文名与次数）+ propose_patch 指令", () => {
    const text = styleCheckPrompt(report);
    expect(text).toContain(AI_CHECK_PROMPTS.style);
    expect(text).toContain("嘴角勾起（描写套话）× 3 次");
    expect(text).toContain("不禁（副词滥用）× 5 次");
    expect(text).toContain("read_doc");
    expect(text).toContain("propose_patch");
    expect(text).toContain("我批准后才落盘");
  });

  it("没命中 / null 报告：回落静态口径，不编清单", () => {
    expect(styleCheckPrompt(null)).toBe(AI_CHECK_PROMPTS.style);
    expect(styleCheckPrompt({ ...report, entries: [] })).toBe(AI_CHECK_PROMPTS.style);
  });
});
