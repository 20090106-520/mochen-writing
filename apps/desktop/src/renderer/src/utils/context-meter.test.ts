import { describe, expect, it } from "vitest";
import { contextKindLabel, type ContextPreview, type ContextPreviewItem } from "@mochen/contracts";
import {
  contextMeterQuery,
  contextMeterQueryKey,
  contextMeterRows,
  contextMeterSummary,
  formatApproxTokens
} from "./context-meter";

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

  it("有条目 ⇒ 显形：条数与 token 估算都摆出来", () => {
    const s = contextMeterSummary(
      preview({
        items: [item(), item({ kind: "character", relPath: "characters/雾.md" })],
        approxTokens: 4321
      })
    );
    expect(s.visible).toBe(true);
    expect(s.text).toBe("2 条 · ≈4.3k tokens");
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
