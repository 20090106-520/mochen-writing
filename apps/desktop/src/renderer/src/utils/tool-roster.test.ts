import { describe, expect, it } from "vitest";
import { AGENT_TOOL_NAMES, WEB_SEARCH_TOOL_NAME, WRITE_TOOLS } from "@mochen/contracts";
import { toolRoster } from "./tool-roster";

describe("tool-roster · 工具 ▾ 的唯一名单来自 contracts", () => {
  it("行集合的名字与顺序就是 AGENT_TOOL_NAMES，renderer 里没有第二份名单", () => {
    expect(toolRoster(true).map((row) => row.name)).toEqual([...AGENT_TOOL_NAMES]);
  });

  it("读/写只由 isWriteTool 裁决：写的两枚正是 WRITE_TOOLS，其余三枚是读", () => {
    const byKind = Object.fromEntries(
      ["读", "写"].map((kind) => [
        kind,
        toolRoster(true)
          .filter((row) => row.kind === kind)
          .map((row) => row.name)
      ])
    );
    expect(byKind["写"]).toEqual([...WRITE_TOOLS]);
    expect(byKind["读"]).toEqual(
      AGENT_TOOL_NAMES.filter((name) => !(WRITE_TOOLS as readonly string[]).includes(name))
    );
  });

  it("每一枚都有中文名与说明，且说明里不许出现「自动写盘」这类做不到的承诺", () => {
    for (const row of toolRoster(true)) {
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.effect.length).toBeGreaterThan(0);
      expect(row.effect).not.toContain("自动写盘");
    }
  });

  it("清单是只读的：结构里没有任何开关态字段（不许长成一枚能按却没通路的按钮）", () => {
    for (const row of toolRoster(true))
      expect(Object.keys(row).sort()).toEqual(["effect", "kind", "label", "name"]);
  });
});

describe("tool-roster · 联网搜索那条要说清怎么发 query（2026-10-06 批次 5-⑬）", () => {
  /**
   * 工具清单这一列是**用户**看的，说明写错会让用户以为这功能坏了（实际是模型在发整句）。
   * 更要紧的是：源链里已经接了必应，但它只认 query 开头的词，
   * 覆盖率闸门会把整句判成没搜着——所以两处文案都得说清「用关键词」。
   * 顺带钉住源链顺序，免得回执里「是谁答的」那一段跟实际跑的不一样。
   */
  const web = toolRoster(true).find((row) => row.name === "web_search");

  it("有这一枚，且说明要求用 2–4 个关键词", () => {
    expect(web).toBeDefined();
    expect(web?.effect).toContain("2–4 个关键词");
  });

  it("说清代价：整句会被拆成词义查询", () => {
    expect(web?.effect).toContain("拆成词义查询");
  });

  it("源链顺序照实写：必应排在 360 前面（回执要报是谁答的）", () => {
    expect(web?.effect).toContain("必应");
    expect(web?.effect.indexOf("必应")).toBeLessThan(web?.effect.indexOf("360") ?? -1);
  });
});

describe("tool-roster · 联网开关决定 web_search 那一行在不在（2026-10-08）", () => {
  /**
   * 这一格报的是「这一轮真带出去的工具」，不是花名册全集。
   * 反向用例（关掉却还列着）先要能红：删掉 toolRoster 里那个 filter，第一条当场红。
   */
  it("关 ⇒ 清单里没有 web_search，其余各枚一枚不少、顺序不变", () => {
    const rows = toolRoster(false).map((row) => row.name);
    expect(rows).not.toContain(WEB_SEARCH_TOOL_NAME);
    expect(rows).toEqual(AGENT_TOOL_NAMES.filter((name) => name !== WEB_SEARCH_TOOL_NAME));
  });

  it("开 ⇒ 就是 contracts 那份全集", () => {
    expect(toolRoster(true).map((row) => row.name)).toEqual([...AGENT_TOOL_NAMES]);
  });
});
