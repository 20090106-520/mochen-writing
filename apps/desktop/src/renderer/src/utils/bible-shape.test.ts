import { describe, expect, it } from "vitest";
import { normalizeBibleEntries } from "./bible-shape";

/**
 * 故事圣经条目的形状校验（2026-10-09 扫描总单 P0-7）。
 *
 * 与 `note-shape` 同一标准：认不得的**形状**判读不懂（返回 null，通路随即停止写盘），
 * 只是缺了后加字段的老条目补默认值放行。判反了的后果都是二次丢数据——
 * 把读不懂的当空库，作者建一条新人物就把整份圣经盖掉了。
 *
 * 刻意保留的宽松只有两处，而且都是"显示用"的字段：`importance` 认不得就整个不带
 * （颜色档没了不影响内容），`color` 之类是自由文本。类型、id、标题、内容这四样认不得就是认不得。
 */

const BASE = {
  id: "b1",
  type: "character",
  title: "沈砚",
  content: "旧书店老板",
  createdAt: 3,
  updatedAt: 9
};

describe("normalizeBibleEntries", () => {
  it("不是数组就不是条目表：判读不懂而不是判空库", () => {
    expect(normalizeBibleEntries({ entries: [] })).toBeNull();
    expect(normalizeBibleEntries(undefined)).toBeNull();
  });

  it("空数组是合法的空库（作者删光就是删光）", () => {
    expect(normalizeBibleEntries([])).toEqual([]);
  });

  it("完整的一条原样认下来，并补上 archived 的默认值", () => {
    const entry = { ...BASE, tags: ["引路人"] };
    expect(normalizeBibleEntries([entry])).toEqual([{ ...entry, archived: false }]);
  });

  it("id / 标题 / 内容 / 类型认不得都判读不懂（悄悄丢一条就是替用户删了一条）", () => {
    expect(normalizeBibleEntries([{ type: "character", title: "没有 id" }])).toBeNull();
    expect(normalizeBibleEntries([{ ...BASE, title: 7 }])).toBeNull();
    expect(normalizeBibleEntries([{ ...BASE, content: null }])).toBeNull();
    expect(normalizeBibleEntries([{ ...BASE, type: "plot" }])).toBeNull();
    expect(normalizeBibleEntries([42])).toBeNull();
  });

  it("老条目缺 tags 与时间戳：补默认值放行，不当坏档", () => {
    const [entry] = normalizeBibleEntries([{ id: "b2", type: "location", title: "旧灯塔" }]) ?? [];
    expect(entry).toMatchObject({ tags: [], createdAt: 0, updatedAt: 0, archived: false });
    // 内容整格没写就是没写：补成空串，让面板照旧显示"（空）"，而不是整份判读不懂。
    expect(entry?.content).toBe("");
  });

  it("三种类型各自的字段留在该留下的那一条上，认不得的形状判读不懂", () => {
    const character = { ...BASE, aliases: ["夜老板"], role: "配角" };
    const location = { ...BASE, id: "b2", type: "location", parentLocation: "东岸" };
    const timeline = { ...BASE, id: "b3", type: "timeline", eventDate: "第三年秋" };
    expect(normalizeBibleEntries([character, location, timeline])?.map((e) => e.id)).toEqual([
      "b1",
      "b2",
      "b3"
    ]);
    expect(normalizeBibleEntries([{ ...BASE, aliases: "夜老板" }])).toBeNull();
    expect(normalizeBibleEntries([{ ...BASE, parentLocation: 12 }])).toBeNull();
  });

  it("别名表里只收非空字符串；tags 同理", () => {
    const [entry] =
      normalizeBibleEntries([{ ...BASE, aliases: ["甲", "", 7, "乙"], tags: ["丙", 8] }]) ?? [];
    expect(entry?.aliases).toEqual(["甲", "乙"]);
    expect(entry?.tags).toEqual(["丙"]);
  });

  it("importance 只认那三档，其余整个不带（档没了不影响内容，不算坏档）", () => {
    const high = normalizeBibleEntries([{ ...BASE, type: "timeline", importance: "high" }]);
    expect(high?.[0]?.importance).toBe("high");
    const bogus = normalizeBibleEntries([{ ...BASE, type: "timeline", importance: "critical" }]);
    expect(bogus?.[0]).not.toHaveProperty("importance");
  });

  it("archived 认严格 true；缺省与 truthy 的非布尔都算未归档", () => {
    expect(normalizeBibleEntries([{ ...BASE, archived: true }])?.[0]?.archived).toBe(true);
    expect(normalizeBibleEntries([{ ...BASE, archived: "yes" }])?.[0]?.archived).toBe(false);
  });

  it("时间戳不是有限数字就当 0，而不是判读不懂", () => {
    const [entry] = normalizeBibleEntries([{ ...BASE, createdAt: "x", updatedAt: Infinity }]) ?? [];
    expect(entry).toMatchObject({ createdAt: 0, updatedAt: 0 });
  });
});
