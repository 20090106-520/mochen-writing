import { describe, expect, it } from "vitest";
import {
  AI_CHECK_PROMPTS,
  BRAND_TAGLINE,
  EMPTY_DOCS_HINT,
  FOOTER_TAGLINE,
  NEED_BOOK_HINT,
  PLANNED_HINT,
  SIDE_NAV_GROUPS,
  sideNavChildState,
  styleCheckPrompt,
  type SideNavChild
} from "./side-nav";
import type { AiFlavorReport } from "@mochen/contracts";

describe("side-nav · 导航表（演示图的唯一真源）", () => {
  it("只剩一组「素材与台账」：默认展开（两组空壳已收）", () => {
    // 2026-10-23 三轮收口：
    // ① 删「写作」组——它的两项（AI 写作 / 章节编辑器）分别与中栏「新建对话」
    //    （同一个 clearThreadView）和左栏文稿树点章节行完全重复；
    // ② 删「审核检查」组——四项已改为内置技能（`main/builtin-skills.ts`），
    //    由模型在对话框里经 `use_skill` 自选载入，不再占左栏一行；
    // ③ 「小说大脑」整组 + 「故事规划」里 3 个跳树子项也收掉——它们的真身就是「我的作品」树分组
    //    本身，树本来就在同一屏上。只剩「素材与台账」一组，组内三项都各有真身。
    expect(SIDE_NAV_GROUPS.map((group) => group.id)).toEqual(["plan"]);
    expect(SIDE_NAV_GROUPS.map((group) => group.label)).toEqual(["素材与台账"]);
    expect(SIDE_NAV_GROUPS.map((group) => group.defaultOpen)).toEqual([true]);
  });

  it("组内三项都是真身：素材库（有面板）/ 伏笔台账 / 时间线核对", () => {
    expect(SIDE_NAV_GROUPS[0]?.children.map((child) => child.label)).toEqual([
      // 2026-10-23：素材库改走 action——它有自己的面板（不再是「跳到树里那一组」）。
      "素材库",
      // 2026-10-05：伏笔台账（一条伏笔一篇文稿，状态在 frontmatter）走 action——跨文稿的聚合视图。
      "伏笔台账",
      // 2026-10-05 批次 5-①：时间线核对（把全书 timeline 按 date 排一遍查矛盾），同款聚合视图。
      "时间线核对"
    ]);
  });

  it("三项的现实全是 action（表里已无 docs 实例，侧栏子项机制保留）", () => {
    const byLabel = new Map(
      SIDE_NAV_GROUPS.flatMap((group) => group.children).map((child) => [child.label, child])
    );
    expect(byLabel.get("素材库")?.reality).toEqual({ kind: "action", action: "materials-panel" });
    expect(byLabel.get("伏笔台账")?.reality).toEqual({
      kind: "action",
      action: "foreshadow-ledger"
    });
    expect(byLabel.get("时间线核对")?.reality).toEqual({
      kind: "action",
      action: "timeline-ledger"
    });
  });

  it("审核四项已迁出导航表：改为内置技能由对话框载入，左栏不再有 ai-check 动作", () => {
    const labels = SIDE_NAV_GROUPS.flatMap((group) => group.children).map((child) => child.label);
    for (const gone of ["一致性检查", "剧情审核", "逻辑检查", "文风检查"]) {
      expect(labels).not.toContain(gone);
    }
    // 口径常量仍在（书稿体检的「一键改写」那一支读 `style`）：四句都说清检查对象与
    // 「没有就明说」，不装自动完成。真正的载入通路是主进程 `main/builtin-skills.ts` 落盘的技能。
    for (const prompt of Object.values(AI_CHECK_PROMPTS)) {
      expect(prompt).toContain("当前章节");
      expect(prompt.length).toBeGreaterThan(20);
    }
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
    expect(sideNavChildState(child({ kind: "action", action: "foreshadow-ledger" }), [])).toEqual({
      mode: "ready",
      hint: ""
    });
  });
});

/* 2026-10-23（第二刀）：「定位」签随那 9 个跳树子项一起撤销——表里不再有 docs 子项，
   也就没有「与树分组同名」这回事；`sideNavLocateTag`、左栏那枚签与 styles/left-nav.css 里那条规则
   一并删除，不再留一枚只为死条目服务的真身。 */

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

  // 2026-11-12：旧口径只列六个例子，改完词照样被闸退一轮；现在按三层说，数字与产出端同源。
  it("静态口径分三层（用词 / 句式 / 节奏），句式上限从 contracts 现取", () => {
    for (const layer of ["用词", "句式", "节奏"]) {
      expect(AI_CHECK_PROMPTS.style).toContain(layer);
    }
    expect(AI_CHECK_PROMPTS.style).toContain("一章最多 1 处");
    expect(AI_CHECK_PROMPTS.style).toContain("最多 3 处");
  });

  it("句长过匀时念一句节奏读数（闸也是拿这个数判的）", () => {
    const flat = styleCheckPrompt({ ...report, sentenceSpread: 0.12, meanSentenceLength: 18.4 });
    expect(flat).toContain("句长波动只有 0.12");
    expect(flat).toContain("均长 18.4 字");
    expect(flat).toContain("只换词不改节奏等于没改");
  });

  it("句长正常或没有读数时不加这一句（没毛病就别塞叮嘱）", () => {
    expect(styleCheckPrompt(report)).not.toContain("句长波动只有");
    expect(styleCheckPrompt({ ...report, sentenceSpread: null })).not.toContain("句长波动只有");
  });
});
