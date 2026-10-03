import { describe, expect, it } from "vitest";
import { AGENT_TOOL_NAMES, WRITE_TOOLS } from "@mochen/contracts";
import { toolRoster } from "./tool-roster";

describe("tool-roster · 工具 ▾ 的唯一名单来自 contracts", () => {
  it("行集合的名字与顺序就是 AGENT_TOOL_NAMES，renderer 里没有第二份名单", () => {
    expect(toolRoster().map((row) => row.name)).toEqual([...AGENT_TOOL_NAMES]);
  });

  it("读/写只由 isWriteTool 裁决：写的两枚正是 WRITE_TOOLS，其余三枚是读", () => {
    const byKind = Object.fromEntries(
      ["读", "写"].map((kind) => [
        kind,
        toolRoster()
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
    for (const row of toolRoster()) {
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.effect.length).toBeGreaterThan(0);
      expect(row.effect).not.toContain("自动写盘");
    }
  });

  it("清单是只读的：结构里没有任何开关态字段（不许长成一枚能按却没通路的按钮）", () => {
    for (const row of toolRoster())
      expect(Object.keys(row).sort()).toEqual(["effect", "kind", "label", "name"]);
  });
});
