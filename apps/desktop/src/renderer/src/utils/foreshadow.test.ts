import { describe, expect, it } from "vitest";
import type { DocRef } from "@mochen/contracts";
import { foreshadowRows, foreshadowStats, plantToneLabel, readForeshadowRaws } from "./foreshadow";

/**
 * 伏笔台账的**行组装与统计**（2026-10-05）。
 *
 * 解析与状态机在 contracts/foreshadow.ts（主进程与渲染层共用那一份），这里只管
 * 「把一堆伏笔文稿摆成一张能一眼看懂的表」：排序、语气、脏数据提示、统计。
 *
 * 一条纪律贯穿全文件：**宁可让作者多看一眼，不替他下结论。**
 * 状态字段写错就说写错（broken），只填了回收章也不判死（仍算已埋）。
 */

function doc(relPath: string, title: string, kind: DocRef["kind"] = "foreshadow"): DocRef {
  return { relPath, kind, title };
}

function doc_(raw: string): string {
  return ["---", ...raw.split("|"), "---", "正文"].join("\n");
}

describe("foreshadowRows · 把文稿摆成行", () => {
  it("读出状态、埋在哪、收在哪，并给上屏显说法", () => {
    const rows = foreshadowRows(
      [doc("foreshadow/老枪.md", "老枪的伤")],
      new Map([
        ["foreshadow/老枪.md", doc_("status: paid|planted: chapters/01.md|paid: chapters/05.md")]
      ])
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: "老枪的伤",
      status: "paid",
      statusLabel: "已回收",
      plantedIn: "chapters/01.md",
      paidIn: "chapters/05.md"
    });
  });

  it("非伏笔文稿一律不进台账（传进来也滤掉）", () => {
    const rows = foreshadowRows(
      [doc("chapters/01.md", "开局", "chapter"), doc("foreshadow/a.md", "A")],
      new Map([
        ["chapters/01.md", "第一章"],
        ["foreshadow/a.md", doc_("status: paid")]
      ])
    );
    expect(rows.map((r) => r.title)).toEqual(["A"]);
  });

  it("未回收的排在前面，已回收的沉到后面（台账要能一眼看出还欠着什么）", () => {
    const rows = foreshadowRows(
      [doc("foreshadow/已收.md", "已收"), doc("foreshadow/还欠.md", "还欠")],
      new Map([
        ["foreshadow/已收.md", doc_("status: paid")],
        ["foreshadow/还欠.md", doc_("status: planted")]
      ])
    );
    expect(rows.map((r) => r.title)).toEqual(["还欠", "已收"]);
  });

  it("状态字段写坏了：标成 broken 并把原值带出来，不静默按「已埋」糊弄过去", () => {
    const rows = foreshadowRows(
      [doc("foreshadow/脏.md", "脏")],
      new Map([["foreshadow/脏.md", doc_("status: 已完成")]])
    );
    expect(rows[0]?.tone).toBe("broken");
    expect(rows[0]?.rawStatus).toBe("已完成");
  });

  it("没围栏的普通文稿也进得来（作者手写没加元数据），按已埋算", () => {
    const rows = foreshadowRows(
      [doc("foreshadow/裸.md", "裸")],
      new Map([["foreshadow/裸.md", "他一直没让人碰那处伤。"]])
    );
    expect(rows[0]).toMatchObject({ status: "planted", tone: "pending" });
  });

  it("盘上读不到原文的伏笔也照样列出来（占位行，不是凭空消失）", () => {
    const rows = foreshadowRows([doc("foreshadow/读不到.md", "读不到")], new Map());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tone).toBe("unknown");
  });
});

describe("foreshadowStats", () => {
  it("四类分开数：待回收 / 已回收 / 已弃用 / 状态坏了", () => {
    const rows = foreshadowRows(
      [
        doc("foreshadow/a.md", "a"),
        doc("foreshadow/b.md", "b"),
        doc("foreshadow/c.md", "c"),
        doc("foreshadow/d.md", "d")
      ],
      new Map([
        ["foreshadow/a.md", doc_("status: planted")],
        ["foreshadow/b.md", doc_("status: paid")],
        ["foreshadow/c.md", doc_("status: dropped")],
        ["foreshadow/d.md", doc_("status: 已完成")]
      ])
    );
    expect(foreshadowStats(rows)).toMatchObject({
      total: 4,
      pending: 1,
      paid: 1,
      dropped: 1,
      broken: 1
    });
  });

  it("空台账给全零，不返回 undefined 或 NaN", () => {
    expect(foreshadowStats([])).toEqual({ total: 0, pending: 0, paid: 0, dropped: 0, broken: 0 });
  });
});

describe("plantToneLabel", () => {
  it("每种语气都给一句人话，不留空串", () => {
    for (const tone of ["pending", "paid", "dropped", "broken", "unknown"] as const) {
      expect(plantToneLabel(tone).length).toBeGreaterThan(0);
    }
  });

  it("坏了与读不到不是一回事，说法要能让人知道该干什么", () => {
    expect(plantToneLabel("broken")).toContain("状态");
    expect(plantToneLabel("unknown")).toContain("读");
  });
});

describe("readForeshadowRaws（2026-10-09 从 store 搬进来的并发读）", () => {
  it("只读 foreshadow 那一类，其它文稿一篇都不碰", async () => {
    const asked: string[] = [];
    const raws = await readForeshadowRaws(
      [doc("foreshadow/甲.md", "甲"), doc("chapters/01.md", "第一章", "chapter")],
      async (relPath) => {
        asked.push(relPath);
        return { content: doc_("状态: planted") };
      }
    );
    expect(asked).toEqual(["foreshadow/甲.md"]);
    expect(raws.has("chapters/01.md")).toBe(false);
  });

  it("一篇读失败不许把整张表拖垮：失败的那篇不进 raws，其余照旧齐", async () => {
    const raws = await readForeshadowRaws(
      [doc("foreshadow/甲.md", "甲"), doc("foreshadow/乙.md", "乙")],
      async (relPath) => {
        if (relPath === "foreshadow/甲.md") throw new Error("EBUSY: 这一篇正被占用");
        return { content: doc_("状态: planted") };
      }
    );
    expect([...raws.keys()]).toEqual(["foreshadow/乙.md"]);
    // 缺的那一篇由 foreshadowRows 摆成 unknown 语气——从台账上消失才是最坏的落点。
    expect(
      foreshadowRows([doc("foreshadow/甲.md", "甲"), doc("foreshadow/乙.md", "乙")], raws).map(
        (r) => r.tone
      )
    ).toEqual(["unknown", "pending"]);
  });
});
