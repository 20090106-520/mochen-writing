/**
 * 自动挂技能的装配计划 · 纯函数契约（2026-11-09）。
 * 最容易长歪的三件事：自动撤掉用户亲手挂的、把用户取下的又加回来、
 * 以及绕开书级停用的硬闸。下面逐条把边界钉死。
 */
import { describe, expect, it } from "vitest";
import { AUTO_SKILL_LIMIT, autoSkillPlanOf, sameSkillIds } from "./skill-auto";
import type { SkillCandidate } from "./skill-pick";
import type { AutoSkillPlanArgs } from "./skill-auto";

const skill = (id: string, over: Partial<SkillCandidate> = {}): SkillCandidate => ({
  id,
  displayName: id,
  description: "",
  stages: [],
  appliesTo: [],
  ...over
});

const scene = { stageName: "正文", docKind: "chapter", instruction: "帮我看看伏笔" };
const args = (over: Partial<AutoSkillPlanArgs> = {}): AutoSkillPlanArgs => ({
  candidates: [skill("a", { stages: ["正文"] }), skill("b", { stages: ["正文"] })],
  scene,
  pinned: [],
  autoPinned: [],
  blocked: [],
  disabled: [],
  ...over
});

describe("autoSkillPlanOf · 只增删自己加的", () => {
  it("命中的技能进 add 与 desired，理由直接来自 rankSkills", () => {
    const plan = autoSkillPlanOf(args());
    expect(plan.picks.map((p) => p.id)).toEqual(["a", "b"]);
    expect(plan.picks[0]?.reasons).toContain("阶段「正文」匹配");
    expect(plan.add).toEqual(["a", "b"]);
    expect(plan.desired).toEqual(["a", "b"]);
    expect(plan.autoPinned).toEqual(["a", "b"]);
    expect(plan.drop).toEqual([]);
  });

  it("一个信号都没命中时什么都不挂", () => {
    const plan = autoSkillPlanOf(args({ scene: { ...scene, stageName: "大纲" } }));
    expect(plan.picks).toEqual([]);
    expect(plan.add).toEqual([]);
    expect(plan.desired).toEqual([]);
  });

  it("用户手动挂入的既不重复推荐，也不会被自动撤掉", () => {
    const plan = autoSkillPlanOf(args({ pinned: ["manual"] }));
    expect(plan.desired).toContain("manual");
    expect(plan.drop).toEqual([]);
    expect(plan.add).toEqual(["a", "b"]);
  });

  it("手动取下过的进 blocked：不再自动加回来", () => {
    const plan = autoSkillPlanOf(args({ blocked: ["a"] }));
    expect(plan.add).toEqual(["b"]);
    expect(plan.picks.map((p) => p.id)).toEqual(["b"]);
  });

  it("书级停用是硬闸：自动识别绕不过去", () => {
    const plan = autoSkillPlanOf(args({ disabled: ["a", "b"] }));
    expect(plan.picks).toEqual([]);
    expect(plan.desired).toEqual([]);
  });

  it("上次自动挂的、这次不再命中，只撤那一枚", () => {
    const plan = autoSkillPlanOf(
      args({
        candidates: [skill("a", { stages: ["正文"] }), skill("stale")],
        pinned: ["a", "stale", "manual"],
        autoPinned: ["a", "stale"]
      })
    );
    expect(plan.drop).toEqual(["stale"]);
    expect(plan.desired).toEqual(["manual", "a"]);
    expect(plan.autoPinned).toEqual(["a"]);
  });

  it("被手动否决 / 停用的自动技能这次就撤掉", () => {
    const plan = autoSkillPlanOf(args({ pinned: ["a"], autoPinned: ["a"], blocked: ["a"] }));
    expect(plan.drop).toEqual(["a"]);
    expect(plan.desired).toEqual(["b"]);
  });

  it("上限生效；limit=0 等于全撤，不把负 slice 语义带进来", () => {
    const many = ["a", "b", "c", "d"].map((id) => skill(id, { stages: ["正文"] }));
    expect(autoSkillPlanOf(args({ candidates: many })).picks).toHaveLength(AUTO_SKILL_LIMIT);
    const zero = autoSkillPlanOf(
      args({ candidates: many, pinned: ["a", "b"], autoPinned: ["a", "b"], limit: 0 })
    );
    expect(zero.picks).toEqual([]);
    expect(zero.drop).toEqual(["a", "b"]);
    expect(zero.desired).toEqual([]);
  });

  it("纯函数：不改入参，同输入同输出", () => {
    const input = args({ pinned: ["a"], autoPinned: ["a"] });
    const snapshot = JSON.stringify(input);
    expect(autoSkillPlanOf(input)).toEqual(autoSkillPlanOf(input));
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("sameSkillIds · 顺序无关的相等", () => {
  it("同集合返回真，长度不同或换了一枚都返回假", () => {
    expect(sameSkillIds(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameSkillIds(["a"], ["a", "b"])).toBe(false);
    expect(sameSkillIds(["a", "b"], ["a", "c"])).toBe(false);
  });
});
