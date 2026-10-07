import { describe, expect, it } from "vitest";
import {
  MARKET_CATEGORIES,
  MARKET_DIR_NAME_RE,
  catalogView,
  marketSkillSchema,
  marketTargetDir
} from "../src/market.js";

const SKILL = marketSkillSchema.parse({
  dirName: "chapter-intent",
  displayName: "落笔前先问清楚",
  summary: "动笔前把这一章要发生什么问清楚。",
  category: "构思",
  origin: "改编自 linhut/dsh-skills 的 brainstorming（MIT）",
  license: "MIT",
  skillMd: "---\nname: 落笔前先问清楚\n---\n\n正文\n"
});

function skill(over: Partial<typeof SKILL> = {}): typeof SKILL {
  return { ...SKILL, ...over };
}

describe("marketSkillSchema", () => {
  it("出处与许可是必填：说不清来源的技能不该进清单", () => {
    // 两条都是「空串」而不是「缺字段」——空串同样答不上「谁写的」，所以也要拒。
    expect(marketSkillSchema.safeParse(skill({ origin: "" })).success).toBe(false);
    expect(marketSkillSchema.safeParse(skill({ license: "" })).success).toBe(false);
    expect(
      marketSkillSchema.safeParse(skill({ origin: "本仓原创", license: "本仓自有" })).success
    ).toBe(true);
  });

  it("分类只认 MARKET_CATEGORIES 里那几个值", () => {
    for (const category of MARKET_CATEGORIES) {
      expect(marketSkillSchema.safeParse(skill({ category })).success).toBe(true);
    }
    expect(marketSkillSchema.safeParse(skill({ category: "别的" as never })).success).toBe(false);
  });

  it("目录名要过形状守卫（它会被拿去拼绝对路径）", () => {
    for (const bad of ["", ".", "..", "a/b", "a\\b", "-lead", "有中文"]) {
      expect(marketSkillSchema.safeParse(skill({ dirName: bad })).success).toBe(false);
    }
    expect(marketSkillSchema.safeParse(skill({ dirName: "ok-name_1.2" })).success).toBe(true);
  });
});

describe("marketTargetDir", () => {
  it("拼出来的绝对路径确实是根 + 单层目录名", () => {
    expect(marketTargetDir("/appdata/skills", "chapter-intent")).toBe(
      "/appdata/skills/chapter-intent"
    );
  });

  it("末尾多个分隔符不会拼出空目录段", () => {
    expect(marketTargetDir("/appdata/skills///", "a")).toBe("/appdata/skills/a");
    expect(marketTargetDir("C:\\appdata\\skills\\\\", "a")).toBe("C:\\appdata\\skills/a");
  });

  it("目录名不合法一律返回 null：调用方必须拒，不许拿「大概安全」的路径去写", () => {
    for (const bad of ["", ".", "..", "../evil", "a/b", "a\\b", "/abs"]) {
      expect(marketTargetDir("/appdata/skills", bad)).toBeNull();
    }
  });

  it("守卫与正则常量同源，不许两处各写一份形状", () => {
    for (const name of ["a", "a-b", "a.b_c", "A1"])
      expect(MARKET_DIR_NAME_RE.test(name)).toBe(true);
    for (const name of ["-a", "_a", "a/b", ".."]) expect(MARKET_DIR_NAME_RE.test(name)).toBe(false);
  });
});

describe("catalogView", () => {
  it("排序按分类的声明序，不是字母序——改 MARKET_CATEGORIES 的顺序就是改页面上谁在前", () => {
    const entries = catalogView(
      [
        skill({ dirName: "zzz-first", category: "构思" }),
        skill({ dirName: "aaa-last", category: "结构" })
      ],
      new Set(),
      new Set()
    );
    expect(entries.map((e) => e.dirName)).toEqual(["zzz-first", "aaa-last"]);
  });

  it("同一分类内按目录名排（localeCompare en），跨分类的那条不参与", () => {
    const entries = catalogView(
      [
        skill({ dirName: "b-two", category: "校对" }),
        skill({ dirName: "a-one", category: "校对" }),
        skill({ dirName: "z-other", category: "文风" })
      ],
      new Set(),
      new Set()
    );
    expect(entries.map((e) => e.dirName)).toEqual(["z-other", "a-one", "b-two"]);
  });

  it("installed 与 shadowedByBook 是两个独立判定，能同时为真", () => {
    // 同时为真是真会发生的：全局装了，书里又自己写了一份。
    const [entry] = catalogView(
      [skill()],
      new Set(["chapter-intent"]),
      new Set(["chapter-intent"])
    );
    expect(entry).toMatchObject({ installed: true, shadowedByBook: true });
  });

  it("书内那份**不算**市场装出来的（installed 只看全局）", () => {
    const [entry] = catalogView([skill()], new Set(), new Set(["chapter-intent"]));
    expect(entry).toMatchObject({ installed: false, shadowedByBook: true });
  });

  it("原样带出正文与出处：UI 上那句「看看装上去的就是这份」摆的就是它", () => {
    const [entry] = catalogView([skill()], new Set(), new Set());
    expect(entry?.skillMd).toBe(SKILL.skillMd);
    expect(entry?.origin).toContain("dsh-skills");
    expect(entry?.license).toBe("MIT");
  });

  it("空清单 ⇒ 空表（不是「有一条装不上的」），且不排序崩", () => {
    expect(catalogView([], new Set(["x"]), new Set(["y"]))).toEqual([]);
  });
});
