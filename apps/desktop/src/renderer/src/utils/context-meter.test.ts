import { describe, expect, it } from "vitest";
import {
  contextKindLabel,
  type ContextHistoryStat,
  type ContextPreview,
  type ContextPreviewItem
} from "@mochen/contracts";
import {
  contextMeterQuery,
  contextMeterQueryKey,
  contextMeterRows,
  contextMeterSummary,
  contextPressureReading,
  formatApproxTokens
} from "./context-meter";
// 交叉核对用的是历史行的**同一条**拼装通路（chip 的总账必须等于面板逐行之和）。
import { appendHistoryRow } from "./history-window";

function preview(over: Partial<ContextPreview> = {}): ContextPreview {
  return {
    profileId: "lead-writer",
    profileName: "墨宸 · 主笔",
    items: [],
    chars: 0,
    approxTokens: 0,
    empty: false,
    ...over
  };
}

function item(over: Partial<ContextPreviewItem> = {}): ContextPreviewItem {
  return {
    kind: "chapter",
    relPath: "chapters/01-开局.md",
    title: "开局",
    chars: 1200,
    active: false,
    ...over
  };
}

describe("formatApproxTokens", () => {
  it("不到 1000 照原样，过千才取一位小数（不换 k 缩写，与别的面板写法一致）", () => {
    expect(formatApproxTokens(0)).toBe("0");
    expect(formatApproxTokens(999)).toBe("999");
    expect(formatApproxTokens(1000)).toBe("1.0k");
    expect(formatApproxTokens(12_345)).toBe("12.3k");
  });
});

function stat(over: Partial<ContextHistoryStat> = {}): ContextHistoryStat {
  return {
    entries: 28,
    chars: 5902,
    approxTokens: 5592,
    droppedCount: 2,
    droppedChars: 2648,
    ...over
  };
}

describe("contextMeterSummary", () => {
  it("还没问过主进程（null）⇒ 不显形：null 是「未知」，不是「0 条」", () => {
    expect(contextMeterSummary(null).visible).toBe(false);
  });

  it("主进程说 empty ⇒ 不显形，且不留半个字在屏上", () => {
    const s = contextMeterSummary(preview({ empty: true }));
    expect(s.visible).toBe(false);
    expect(s.text).toBe("");
    expect(s.title).toBe("");
  });

  it("有条目 ⇒ 显形：token 估算摆出来（条数留在 tooltip 与展开面板）", () => {
    const s = contextMeterSummary(
      preview({
        items: [item(), item({ kind: "character", relPath: "characters/雾.md" })],
        approxTokens: 4321
      })
    );
    expect(s.visible).toBe(true);
    expect(s.text).toBe("≈4.3k tokens");
  });

  it("title 说清这一轮真会发出去什么，并报出档案名与总字数", () => {
    const s = contextMeterSummary(preview({ items: [item()], chars: 4210, approxTokens: 4300 }));
    expect(s.title).toContain("墨宸 · 主笔");
    expect(s.title).toContain("4210 字");
    expect(s.title).toContain("4.3k");
  });

  it("empty 为假但 items 为空（主进程与渲染层不许互相猜）⇒ 同样不显形", () => {
    expect(contextMeterSummary(preview({ empty: false, items: [] })).visible).toBe(false);
  });
});

/**
 * 清单第 1 项（第二十二节登记的那条口径分裂）：折叠 chip 报的数必须与展开面板的总账同源。
 *
 * 夹具**照第二十二节屏 2 的真机读数摆**（装配 2 条 / 33 字 / 29 tokens；历史 28 条 /
 * 5902 字 / 5592 tokens，另丢 2 条 2648 字），不是随手挑的整数——当时 chip 上写的是
 * 「2 条 · ≈29 tokens」，只报装配那一路，正是缺陷本体，所以这一组数一有改动就必然撞红。
 *
 * 2026-10-23 起 chip 那行字只留 `≈N tokens`（条数并进 tooltip：真机 1000 CSS 下
 * 「23 条 · ≈989 tokens」被 12em 宽度截成「23 条 · ≈989…」）。合计口径没变：
 * 下面钉的仍是「装配 + 历史」两路相加，只是条数那半句改在 tooltip 里核。
 */
describe("折叠 chip 的总账 = 装配条目 + 会话历史", () => {
  const assembled = () =>
    preview({
      items: [
        item({ chars: 16, title: "第一章 · 开局" }),
        item({ chars: 17, title: "第二章 · 中段" })
      ],
      chars: 33,
      approxTokens: 29
    });

  it("有历史 ⇒ 折叠那一行的 token 是两路合账，条数在 tooltip 里同样是合账", () => {
    // 2 + 28 = 30 条；29 + 5592 = 5621 tokens ⇒ 5.6k（屏 2 上面板与 store 的合账）
    const s = contextMeterSummary({ ...assembled(), history: stat() });
    expect(s.text).toBe("≈5.6k tokens");
    expect(s.title).toContain("装配 2 条 33 字 + 会话历史 28 条 5902 字");
  });

  it("chip 那一行不许再带条数前缀：12em 装不下，会被截成没有单位的「≈989…」", () => {
    const s = contextMeterSummary({ ...assembled(), history: stat() });
    expect(s.text).not.toContain("条");
    expect(s.text).not.toMatch(/\d+ 条/);
  });

  it("tooltip 逐路拆项并报合计，同时把「历史按上界算」这句说明白", () => {
    const title = contextMeterSummary({ ...assembled(), history: stat() }).title;
    expect(title).toContain("墨宸 · 主笔");
    expect(title).toContain("装配 2 条 33 字");
    expect(title).toContain("会话历史 28 条 5902 字");
    expect(title).toContain("共 5935 字");
    expect(title).toContain("5.6k");
    // 上界口径（第二十一节已查实：预览按 reserve=0 算，真 startTurn 只会切得更狠）
    expect(title).toContain("上界");
    // 那句被证伪的旧话不许复活：「占用条上写的就是真会发出去的」
    expect(title).not.toContain("就是真会发出去的");
  });

  it("被切掉的历史不进合计：条数与字数只算主进程报的 kept", () => {
    const s = contextMeterSummary({
      ...assembled(),
      history: stat({
        entries: 1,
        chars: 100,
        approxTokens: 100,
        droppedCount: 3,
        droppedChars: 900
      })
    });
    // 2 条装配 + 1 条真发出去的历史 = 3 条；那 3 条 900 字**没上轮**，不许算进占用
    expect(s.text).toBe("≈129 tokens");
    expect(s.title).toContain("会话历史 1 条 100 字");
    expect(s.title).toContain("共 133 字");
    expect(s.title).not.toContain("共 1033 字");
  });

  it("取整只在合并之后做一次：两路 600 + 500 ⇒ 合计 1.1k，不是两个 k 缩写各自相加", () => {
    const s = contextMeterSummary({
      ...assembled(),
      items: [item({ chars: 600 })],
      chars: 600,
      approxTokens: 600,
      history: stat({ entries: 1, chars: 500, approxTokens: 500, droppedCount: 0, droppedChars: 0 })
    });
    expect(s.text).toBe("≈1.1k tokens");
  });

  it("历史全零（盘上没这条会话）⇒ 折叠那行一字不变，也不提会话历史", () => {
    const s = contextMeterSummary({
      ...assembled(),
      history: stat({ entries: 0, chars: 0, approxTokens: 0, droppedCount: 0, droppedChars: 0 })
    });
    expect(s.text).toBe("≈29 tokens");
    expect(s.title).not.toContain("会话历史");
  });

  it("旧回包（无 history 字段）⇒ 按「没有历史」显示，绝不编一份占用", () => {
    const s = contextMeterSummary(assembled());
    expect(s.text).toBe("≈29 tokens");
    expect(s.title).not.toContain("会话历史");
  });

  it("显形判据仍归主进程那一边：empty 为真时，带多长的历史都不显形", () => {
    // 夹具刻意给**非空 items**：否则这条会被 `items.length === 0` 那一路先挡掉，
    // 于是「主进程说 empty 就不显形」这句话根本没被检验过（2026-10-12 自己抓到的假绿）。
    const s = contextMeterSummary(
      preview({
        empty: true,
        items: [item()],
        chars: 33,
        approxTokens: 29,
        history: stat()
      })
    );
    expect(s.visible).toBe(false);
    expect(s.text).toBe("");
  });

  it("chip 的总字数 === 展开面板逐行字数之和（同一轮只看得到一份账）", () => {
    const p = { ...assembled(), history: stat() };
    const rowsChars = appendHistoryRow(contextMeterRows(p), p).reduce(
      (sum, row) => sum + row.chars,
      0
    );
    expect(rowsChars).toBe(5935);
    expect(contextMeterSummary(p).title).toContain(`共 ${rowsChars} 字`);
  });
});

describe("contextPressureReading（窗口压力 + 已挂入项数）", () => {
  /** 夹具：24000 只是**测试里的分母样本**，真码里那枚数由主进程从 agent-runtime 递过来。 */
  const WINDOW = 24000;
  const withWindow = (over: Partial<ContextPreview> = {}): ContextPreview =>
    preview({
      windowApproxTokens: WINDOW,
      items: [item()],
      chars: 1200,
      approxTokens: 900,
      ...over
    });

  it("回包没给分母 ⇒ 整行不显形：拿不到窗口就宁可缺一行，也不许编一个百分比", () => {
    const p = preview({ items: [item()], approxTokens: 900 });
    expect(p.windowApproxTokens).toBeUndefined();
    expect(contextPressureReading(p).visible).toBe(false);
  });

  it("分母为 0 / 负数（坏回包）⇒ 同样不显形，绝不当成「占满了」吓用户", () => {
    expect(contextPressureReading(withWindow({ windowApproxTokens: 0 })).visible).toBe(false);
    expect(contextPressureReading(withWindow({ windowApproxTokens: -1 })).visible).toBe(false);
  });

  it("没问过主进程 / 主进程说 empty / 装不出条目 ⇒ 都不显形（与折叠条同一套显形判据）", () => {
    expect(contextPressureReading(null).visible).toBe(false);
    expect(contextPressureReading(withWindow({ empty: true })).visible).toBe(false);
    expect(contextPressureReading(withWindow({ items: [] })).visible).toBe(false);
  });

  it("百分比 = 装配 + 会话历史的合账 ÷ 分母（照第二十二节真机读数：5621 / 24000 ⇒ 23%）", () => {
    const p = withWindow({
      items: [
        item({ chars: 16, title: "第一章 · 开局" }),
        item({ chars: 17, title: "第二章 · 中段" })
      ],
      chars: 33,
      approxTokens: 29,
      history: stat()
    });
    const r = contextPressureReading(p);
    expect(r.visible).toBe(true);
    expect(r.text).toBe("窗口 ≈23% · 5.6k / 24.0k tokens");
  });

  it("分子与折叠条**同一个数**：两路读数里的 tokens 一字不差（不许各加一遍）", () => {
    const p = withWindow({
      items: [item()],
      approxTokens: 600,
      history: stat({ entries: 1, chars: 500, approxTokens: 500, droppedCount: 0, droppedChars: 0 })
    });
    expect(contextPressureReading(p).text).toContain(formatApproxTokens(1100));
    expect(contextMeterSummary(p).text).toContain(formatApproxTokens(1100));
  });

  it("技能库索引单列一格（2026-11-10）：那格是「挂了 20 项」还是「涨了 20 行名字」，不能混", () => {
    const p = withWindow({ skillIndex: { chars: 1600, shown: 20, total: 23 } });
    const r = contextPressureReading(p);
    expect(r.detail).toContain("库索引 20/23 条 1600 字");
    // 主读那一行只有百分比与 tokens：分项再挤进去会折行，还会断在数字中间。
    expect(r.text).toBe("窗口 ≈4% · 900 / 24.0k tokens");
    expect(r.detail).not.toContain("技能 ");
    expect(r.title).toContain("没挂入");
  });

  it("只有库索引、一条正文都不装时也显形：二十行技能名也是真会发出去的字", () => {
    const p = withWindow({
      items: [],
      chars: 1600,
      approxTokens: 1200,
      skillIndex: { chars: 1600, shown: 20, total: 20 }
    });
    expect(contextPressureReading(p).visible).toBe(true);
    expect(contextMeterSummary(p).visible).toBe(true);
  });

  it("折叠条把索引字数与装配字数分开报，两段相加正好等于总字数（同一批字不许报两遍）", () => {
    const p = withWindow({
      items: [item({ chars: 400 })],
      chars: 2000,
      skillIndex: { chars: 1600, shown: 3, total: 3 }
    });
    const s = contextMeterSummary(p);
    expect(s.title).toContain("装配 1 条 400 字");
    expect(s.title).toContain("技能库索引 3/3 条 1600 字");
  });

  it("超过 100% 原样报，不夹顶：夹到 100 等于把「已经超了」这件最要紧的事藏起来", () => {
    const p = withWindow({ approxTokens: 30000 });
    expect(contextPressureReading(p).text).toContain("≈125%");
    expect(contextPressureReading(p).title).toContain("已过保守窗口上界");
  });

  it("带过东西却不足 1% ⇒ 报 ≈1%，不报 ≈0%：0% 在屏上读起来像「什么都没带」", () => {
    const p = withWindow({ approxTokens: 100 });
    expect(contextPressureReading(p).text).toContain("≈1%");
    expect(contextPressureReading(p).text).not.toContain("≈0%");
  });

  it("title 说清分母是**保守假设窗口**而不是模型真实上限（否则 100% 会被读成「模型要拒了」）", () => {
    const title = contextPressureReading(withWindow()).title;
    expect(title).toContain("保守假设窗口");
    expect(title).toContain("不是模型真实上限");
    expect(title).toContain("24.0k");
  });

  it("那句「丢了什么」只由 history-window 说：压力行不许重复那条截断文案", () => {
    const p = withWindow({ history: stat({ entries: 1, chars: 100, approxTokens: 100 }) });
    expect(contextPressureReading(p).text).not.toContain("没有发给模型");
    expect(contextPressureReading(p).title).not.toContain("没有发给模型");
  });

  it("设定单独报一行：世界观文稿与故事圣经条目合账，不与正文/人物卡混在一起", () => {
    const p = withWindow({
      items: [
        item({ kind: "world", chars: 300, title: "林夜" }),
        item({ kind: "world", chars: 200, title: "码头" }),
        item({ kind: "chapter", chars: 500, title: "第三章 · 正文" }),
        item({ kind: "character", chars: 400, title: "李深" })
      ],
      chars: 1400,
      approxTokens: 1000
    });
    const r = contextPressureReading(p);
    expect(r.detail).toContain("设定 2 项 500 字");
    expect(r.title).toContain("「设定」单独计量");
    // 正文与人物卡不并进这一行
    expect(r.detail).not.toContain("设定 3 项");
  });

  it("已挂入与技能分开数：技能在系统提示里只有清单，不混进「已挂入」", () => {
    const withPinned = withWindow({
      items: [
        item(),
        item({ kind: "pinned", relPath: "materials/雾.md" }),
        item({ kind: "skill", relPath: "book:节拍" })
      ]
    });
    expect(contextPressureReading(withPinned).detail).toContain("已挂入 1 项");
    expect(contextPressureReading(withPinned).detail).toContain("技能 1 项");
    expect(contextPressureReading(withPinned).title).toContain("@ 引用 / 加入上下文");
    expect(contextPressureReading(withPinned).title).toContain("正文由 use_skill 按需读取");
    expect(contextPressureReading(withWindow()).detail).not.toContain("已挂入");
    expect(contextPressureReading(withWindow()).detail).not.toContain("技能 ");
  });
});

describe("contextMeterRows", () => {
  it("每行带上类别标签（本章那一条打标）与字数", () => {
    const rows = contextMeterRows(
      preview({
        items: [
          item({ active: true }),
          item({
            kind: "outline",
            relPath: "outline/总纲.md",
            title: "总纲",
            chars: 300,
            active: false
          })
        ]
      })
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.label).toBe("正文（本章）");
    expect(rows[0]?.charsLabel).toBe("1200 字");
    expect(rows[1]?.label).toBe("大纲");
    expect(rows[1]?.charsLabel).toBe("300 字");
  });

  it("长标题截断加省略号，短标题一字不动", () => {
    const long = "一".repeat(40);
    const rows = contextMeterRows(
      preview({ items: [item({ title: long }), item({ relPath: "b.md", title: "短" })] })
    );
    expect(rows[0]?.title).toBe(`${"一".repeat(28)}…`);
    expect(rows[1]?.title).toBe("短");
  });

  it("行键带序号：同一篇既是本章又被显式挂入时，两行不能撞 key", () => {
    const rows = contextMeterRows(
      preview({
        items: [
          item({ relPath: "materials/雾.md", kind: "material" }),
          item({ relPath: "materials/雾.md", kind: "pinned" })
        ]
      })
    );
    expect(rows[0]?.key).not.toBe(rows[1]?.key);
  });

  it("null ⇒ 空数组（模板直接 v-for，不用判空）", () => {
    expect(contextMeterRows(null)).toEqual([]);
  });
});

describe("contextMeterQuery / Key", () => {
  it("query 只带三样事实，**不带任何正文**（正文由主进程自己读盘装配）", () => {
    const q = contextMeterQuery({
      docRelPath: "chapters/01.md",
      profileId: "reviewer",
      pinned: ["materials/雾.md"]
    });
    expect(q).toEqual({
      docRelPath: "chapters/01.md",
      profileId: "reviewer",
      pinned: ["materials/雾.md"]
    });
    expect(Object.keys(q).sort()).toEqual(["docRelPath", "pinned", "profileId"]);
  });

  it("key 对 null 归一成空串，三样事实任一变化都换 key（否则 watch 不触发，占用条不刷新）", () => {
    const base = { docRelPath: null, profileId: null, pinned: [] as string[] };
    expect(contextMeterQueryKey(base)).toBe(contextMeterQueryKey({ ...base }));
    expect(contextMeterQueryKey({ ...base, docRelPath: "a.md" })).not.toBe(
      contextMeterQueryKey(base)
    );
    expect(contextMeterQueryKey({ ...base, profileId: "reviewer" })).not.toBe(
      contextMeterQueryKey(base)
    );
    expect(contextMeterQueryKey({ ...base, pinned: ["a.md"] })).not.toBe(
      contextMeterQueryKey(base)
    );
  });
});

describe("类别标签只有一份实现（铁律 6）", () => {
  it("占用条与给模型的提示词块用的是同一个 contextKindLabel", () => {
    expect(contextKindLabel("chapter", true)).toBe("正文（本章）");
    expect(contextKindLabel("pinned", false)).toBe("挂入");
  });
});
