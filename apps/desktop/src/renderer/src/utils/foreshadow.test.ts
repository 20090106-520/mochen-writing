import { describe, expect, it } from "vitest";
import type { DocRef } from "@mochen/contracts";
import {
  brokenPointers,
  foreshadowRows,
  foreshadowStats,
  keywordMisses,
  plantToneLabel,
  readForeshadowRaws,
  readPlantedChapters
} from "./foreshadow";

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

describe("brokenPointers · 跨章回归（2026-10-22）", () => {
  const chapter = (relPath: string, title: string): DocRef => doc(relPath, title, "chapter");

  it("落点章改名/删掉之后报断，并把原文路径原样带出来", () => {
    const docs = [doc("foreshadow/老枪.md", "老枪的伤"), chapter("chapters/05-归港.md", "归港")];
    const rows = foreshadowRows(
      docs,
      new Map([["foreshadow/老枪.md", doc_("status: planted|planted: chapters/03-旧闸.md")]])
    );
    expect(brokenPointers(docs, rows)).toEqual([
      {
        relPath: "foreshadow/老枪.md",
        title: "老枪的伤",
        field: "planted",
        target: "chapters/03-旧闸.md"
      }
    ]);
  });

  it("两格都指空就报两条，各说各的入口", () => {
    const docs = [doc("foreshadow/甲.md", "甲")];
    const rows = foreshadowRows(
      docs,
      new Map([
        ["foreshadow/甲.md", doc_("status: paid|planted: chapters/01.md|paid: chapters/09.md")]
      ])
    );
    expect(brokenPointers(docs, rows).map((one) => one.field)).toEqual(["planted", "paid"]);
  });

  it("落点都在书里就一条都不报；没写落点的也不报（那是「还没登记」不是「断了」）", () => {
    const docs = [
      doc("foreshadow/甲.md", "甲"),
      doc("foreshadow/乙.md", "乙"),
      chapter("chapters/01.md", "一")
    ];
    const rows = foreshadowRows(
      docs,
      new Map([
        ["foreshadow/甲.md", doc_("status: planted|planted: chapters/01.md")],
        ["foreshadow/乙.md", doc_("status: planted")]
      ])
    );
    expect(brokenPointers(docs, rows)).toEqual([]);
  });

  it("读不到原文的那条跳过：它的落点字段没解析出来，不能替它下「断」的结论", () => {
    const docs = [doc("foreshadow/甲.md", "甲")];
    // raws 里没有它 ⇒ tone = unknown
    const rows = foreshadowRows(docs, new Map());
    expect(rows[0]?.tone).toBe("unknown");
    expect(brokenPointers(docs, rows)).toEqual([]);
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

describe("keywordMisses · 关键词回归（2026-10-22，C6）", () => {
  function rowsOf(raw: string, relPath = "chapters/01.md") {
    return foreshadowRows(
      [doc("foreshadow/老枪.md", "老枪的伤")],
      new Map([["foreshadow/老枪.md", doc_(`planted: ${relPath}|${raw}`)]])
    );
  }

  it("关键词在埋设章里找得到就不报", () => {
    const rows = rowsOf("keywords: [老枪, 旧伤]");
    const misses = keywordMisses(
      rows,
      new Map([["chapters/01.md", "他按住那处旧伤，老枪挂在墙上。"]])
    );
    expect(misses).toEqual([]);
  });

  it("找不到只报这一处，指到伏笔、埋设章与那个词", () => {
    const rows = rowsOf("keywords: [老枪, 旧伤]");
    const misses = keywordMisses(rows, new Map([["chapters/01.md", "他按住那处旧伤。"]]));
    expect(misses).toEqual([
      {
        relPath: "foreshadow/老枪.md",
        title: "老枪的伤",
        chapter: "chapters/01.md",
        keyword: "老枪"
      }
    ]);
  });

  it("没写 keywords 的条目不参与：不从标题里替作者猜", () => {
    expect(keywordMisses(rowsOf("status: planted"), new Map([["chapters/01.md", "正文"]]))).toEqual(
      []
    );
  });

  it("一个字的关键词不判：太短的串正文里到处撞", () => {
    const rows = rowsOf("keywords: [枪]");
    expect(keywordMisses(rows, new Map([["chapters/01.md", "正文"]]))).toEqual([]);
  });

  it("埋设章没读到（或压根没写埋设章）就跳过，不拿缺席当没写", () => {
    expect(keywordMisses(rowsOf("keywords: [老枪]"), new Map())).toEqual([]);
    const noPlanted = foreshadowRows(
      [doc("foreshadow/老枪.md", "老枪的伤")],
      new Map([["foreshadow/老枪.md", doc_("keywords: 老枪")]])
    );
    expect(keywordMisses(noPlanted, new Map([["chapters/01.md", "正文"]]))).toEqual([]);
  });

  it("伏笔原文都没读到的条目跳过：它声明了什么都不知道", () => {
    const rows = foreshadowRows([doc("foreshadow/老枪.md", "老枪的伤")], new Map());
    expect(keywordMisses(rows, new Map([["chapters/01.md", "正文"]]))).toEqual([]);
  });
});

describe("readPlantedChapters（2026-10-22，C6 只读埋设章）", () => {
  const docs = [
    doc("foreshadow/老枪.md", "老枪的伤"),
    doc("chapters/01.md", "第一章", "chapter"),
    doc("chapters/02.md", "第二章", "chapter")
  ];
  const rows = foreshadowRows(
    docs,
    new Map([["foreshadow/老枪.md", doc_("planted: chapters/01.md|keywords: 老枪")]])
  );

  it("只读登记过的埋设章，且只留正文（围栏不混进判据）", async () => {
    const asked: string[] = [];
    const texts = await readPlantedChapters(docs, rows, async (relPath) => {
      asked.push(relPath);
      return { content: ["---", "title: 开局", "---", "正文来了。"].join("\n") };
    });
    expect(asked).toEqual(["chapters/01.md"]);
    expect(texts.get("chapters/01.md")).toBe("正文来了。");
    expect(asked).not.toContain("chapters/02.md");
  });

  it("埋设章读不到就不进 map：调用方据此跳过，不误报关键词不在", async () => {
    const texts = await readPlantedChapters(docs, rows, async () => {
      throw new Error("EBUSY");
    });
    expect(texts.size).toBe(0);
  });
});
