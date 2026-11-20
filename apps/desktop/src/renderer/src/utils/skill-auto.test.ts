/**
 * 自动挂技能的装配计划 · 纯函数契约（2026-11-09）。
 * 最容易长歪的三件事：自动撤掉用户亲手挂的、把用户取下的又加回来、
 * 以及绕开书级停用的硬闸。下面逐条把边界钉死。
 */
import { describe, expect, it } from "vitest";
import { AUTO_SKILL_LIMIT, autoSkillPlanOf, preloadSkillIdOf, sameSkillIds } from "./skill-auto";
import type { SkillCandidate, SkillPick } from "./skill-pick";
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

  it("上限生效：换档就停，不多收一条", () => {
    // 分三档：70 / 70 / 40 / 8。limit=3 时第四条已经换档，到此为止。
    const many = [
      skill("a", { stages: ["正文"], appliesTo: ["chapter"] }),
      skill("b", { stages: ["正文"], appliesTo: ["chapter"] }),
      skill("c", { stages: ["正文"] }),
      skill("d", { description: "伏笔" })
    ];
    const plan = autoSkillPlanOf(args({ candidates: many }));
    expect(plan.picks.map((pick) => pick.id)).toEqual(["a", "b", "c"]);
  });

  it("同分不切档：四条出厂审校技能都该进（否则 check-style 永远排第四）", () => {
    // 真实场景：同一本新书里四条审校技能的 stage 都是「正文」、appliesTo 都是 chapter，
    // 得分完全相同。旧实现按 id 字典序 slice(0, 3) —— `check-style` 恰好排第四，
    // 也就是**去 AI 味那条技能从来没被自动挂上过**，且没有任何征兆。
    const builtin = ["check-consistency", "check-logic", "check-plot", "check-style"].map((id) =>
      skill(`global:${id}`, { stages: ["正文"], appliesTo: ["chapter"] })
    );
    const plan = autoSkillPlanOf(args({ candidates: builtin }));
    expect(plan.picks).toHaveLength(4);
    expect(plan.picks.length).toBeGreaterThan(AUTO_SKILL_LIMIT);
    expect(plan.picks.map((pick) => pick.id)).toContain("global:check-style");
  });

  it("limit=0 等于全撤，不把负 slice 语义带进来", () => {
    const many = ["a", "b", "c", "d"].map((id) => skill(id, { stages: ["正文"] }));
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

describe("preloadSkillIdOf · 只预读唯一榜首（2026-11-17）", () => {
  const pick = (id: string, score: number): SkillPick => ({
    id,
    displayName: id,
    score,
    reasons: []
  });

  it("空榜不预读", () => {
    expect(preloadSkillIdOf([])).toBe("");
  });

  it("榜首严格领先时预读它", () => {
    expect(preloadSkillIdOf([pick("a", 70), pick("b", 40)])).toBe("a");
  });

  it("并列第一不预读：两条同样该用，挑谁都是掷骰子", () => {
    expect(preloadSkillIdOf([pick("a", 70), pick("b", 70), pick("c", 40)])).toBe("");
  });

  it("只剩一条时它就是唯一榜首，照预读", () => {
    expect(preloadSkillIdOf([pick("a", 8)])).toBe("a");
  });
});
