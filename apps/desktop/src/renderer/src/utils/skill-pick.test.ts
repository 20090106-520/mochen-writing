import { describe, expect, it } from "vitest";
import {
  KEYWORD_SCORE_CAP,
  SKILL_PICK_WEIGHTS,
  rankSkills,
  skillPickOf,
  type SkillCandidate,
  type SkillPickScene
} from "./skill-pick";

/**
 * 自动选技的得分逻辑（先红后绿）。
 *
 * 这组用例钉的是三件事：
 * ① 三路信号（阶段 / 适用文稿 / 关键词）各自出多少分、理由怎么说；
 * ② 「阶段」「适用文稿」只是**正信号**不是闸门——没命中也能靠关键词上榜；
 * ③ 排序与取前 N 的判定只有一份（模板不许自己 sort），已挂入的不重复推荐。
 */

function skill(over: Partial<SkillCandidate> = {}): SkillCandidate {
  return {
    id: "global:x",
    displayName: "示例技能",
    description: "一句说明",
    stages: [],
    appliesTo: [],
    ...over
  };
}

function scene(over: Partial<SkillPickScene> = {}): SkillPickScene {
  return { stageName: "正文", docKind: "chapter", instruction: "", ...over };
}

describe("单件技能的得分", () => {
  it("阶段命中 +40，理由写清是哪一个阶段", () => {
    const pick = skillPickOf(skill({ stages: ["正文"] }), scene({ docKind: null }));
    expect(pick.score).toBe(SKILL_PICK_WEIGHTS.stage);
    expect(pick.reasons).toEqual(["阶段「正文」匹配"]);
  });

  it("适用文稿命中 +30，理由写清是哪一个文稿类", () => {
    const pick = skillPickOf(skill({ appliesTo: ["chapter"] }), scene({ stageName: "" }));
    expect(pick.score).toBe(SKILL_PICK_WEIGHTS.appliesTo);
    expect(pick.reasons).toEqual(["适用文稿 chapter 匹配"]);
  });

  it("两轴都命中 = 两路分相加", () => {
    const pick = skillPickOf(skill({ stages: ["正文"], appliesTo: ["chapter"] }), scene());
    expect(pick.score).toBe(SKILL_PICK_WEIGHTS.stage + SKILL_PICK_WEIGHTS.appliesTo);
    expect(pick.reasons).toEqual(["阶段「正文」匹配", "适用文稿 chapter 匹配"]);
  });

  it("阶段名是精确比对，不是子串：技能写「正文改写」不等于当前「正文」", () => {
    const pick = skillPickOf(skill({ stages: ["正文改写"] }), scene({ docKind: null }));
    expect(pick.score).toBe(0);
    expect(pick.reasons).toEqual([]);
  });

  it("没打开文稿（docKind null）⇒ 适用文稿这一路静默，不是「一个都不匹配」的扣分", () => {
    const pick = skillPickOf(skill({ appliesTo: ["chapter"] }), scene({ docKind: null }));
    expect(pick.score).toBe(0);
    expect(pick.reasons).toEqual([]);
  });

  it("阶段名为空 ⇒ 阶段这一路静默", () => {
    const pick = skillPickOf(skill({ stages: ["正文"] }), scene({ stageName: "" }));
    expect(pick.score).toBe(0);
    expect(pick.reasons).toEqual([]);
  });

  it("关键词命中：指令里的两字词落进技能的标题 / 说明里，每命中一条 +8", () => {
    const pick = skillPickOf(
      skill({ displayName: "查伏笔", description: "检查伏笔台账" }),
      scene({ stageName: "", docKind: null, instruction: "帮我看看伏笔收得怎么样" })
    );
    expect(pick.score).toBe(SKILL_PICK_WEIGHTS.keyword);
    expect(pick.reasons).toEqual(["命中关键词「伏笔」"]);
  });

  it("关键词贡献有上限：命中再多也只算 KEYWORD_SCORE_CAP，理由最多列三条", () => {
    const pick = skillPickOf(
      skill({ displayName: "汇总", description: "伏笔大纲对话节奏视角动机文风素材" }),
      scene({
        stageName: "",
        docKind: null,
        instruction: "伏笔 大纲 对话 节奏 视角 动机 文风 素材"
      })
    );
    expect(pick.score).toBe(KEYWORD_SCORE_CAP);
    expect(pick.reasons).toEqual(["命中关键词「伏笔」「大纲」「对话」"]);
  });

  it("三路都命中 = 全部相加（关键词已封顶）", () => {
    const pick = skillPickOf(
      skill({ stages: ["正文"], appliesTo: ["chapter"], description: "检查伏笔" }),
      scene({ instruction: "伏笔" })
    );
    expect(pick.score).toBe(
      SKILL_PICK_WEIGHTS.stage + SKILL_PICK_WEIGHTS.appliesTo + SKILL_PICK_WEIGHTS.keyword
    );
    expect(pick.reasons).toHaveLength(3);
  });

  it("一个信号都没命中 ⇒ 0 分、空理由（不编一个「差不多」的分）", () => {
    const pick = skillPickOf(
      skill({ description: "一句说明" }),
      scene({ instruction: "随便写点什么" })
    );
    expect(pick.score).toBe(0);
    expect(pick.reasons).toEqual([]);
  });

  it("阶段 / 适用文稿是正信号不是闸门：两轴空着、只要关键词命中就照样上榜", () => {
    const pick = skillPickOf(
      skill({ stages: [], appliesTo: [], description: "检查伏笔台账" }),
      scene({ stageName: "", docKind: null, instruction: "伏笔" })
    );
    expect(pick.score).toBe(SKILL_PICK_WEIGHTS.keyword);
  });
});

describe("排序与取前 N", () => {
  it("排除已挂入的：已在这一轮上下文里的不再推荐", () => {
    const a = skill({ id: "global:a", stages: ["正文"] });
    const b = skill({ id: "global:b", stages: ["正文"] });
    const ranked = rankSkills([a, b], scene({ docKind: null }), 12, ["global:a"]);
    expect(ranked.map((one) => one.id)).toEqual(["global:b"]);
  });

  it("按得分从高到低排", () => {
    const high = skill({ id: "global:high", stages: ["正文"], appliesTo: ["chapter"] });
    const low = skill({ id: "global:low", stages: ["正文"] });
    const ranked = rankSkills([low, high], scene());
    expect(ranked.map((one) => one.id)).toEqual(["global:high", "global:low"]);
  });

  it("同分时按 id 升序，保证同输入同输出", () => {
    const b = skill({ id: "global:b", stages: ["正文"] });
    const a = skill({ id: "global:a", stages: ["正文"] });
    const ranked = rankSkills([b, a], scene({ docKind: null }));
    expect(ranked.map((one) => one.id)).toEqual(["global:a", "global:b"]);
  });

  it("0 分的一个都不推荐（空场上榜等于把技能库倒给用户）", () => {
    const ranked = rankSkills([skill({ id: "global:a" })], scene({ instruction: "随便写点什么" }));
    expect(ranked).toEqual([]);
  });

  it("取前 N：只留得分最高的前 N 条", () => {
    const list = [
      skill({ id: "global:a", stages: ["正文"], appliesTo: ["chapter"] }),
      skill({ id: "global:b", stages: ["正文"] }),
      skill({ id: "global:c", appliesTo: ["chapter"] })
    ];
    const ranked = rankSkills(list, scene(), 2);
    expect(ranked.map((one) => one.id)).toEqual(["global:a", "global:b"]);
  });

  it("同分不切档（keepTies）：截断位上同分就一并收下", () => {
    const same = ["a", "b", "c", "d"].map((id) => skill({ id: `global:${id}`, stages: ["正文"] }));
    // limit=3、四条同分 ⇒ 四条全进。旧实现按 id 字典序砍掉 `global:d`——
    // 出厂四条审校技能里，那条正好是 `check-style`。
    expect(rankSkills(same, scene({ docKind: null }), 3, [], true)).toHaveLength(4);
  });

  it("同分扩容不突破硬上限：全库同分也只挂 12 条", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      skill({ id: `global:s${String(i).padStart(2, "0")}`, stages: ["正文"] })
    );
    expect(rankSkills(many, scene({ docKind: null }), 3, [], true)).toHaveLength(12);
  });

  it("keepTies 扩容只到 hardCap（2026-11-24 预算闸）：手动已占的名额不参与扩容", () => {
    // 自动挂入把「12 − 手动已占」递进来：同分再多也只收预算内的几条，
    // 否则手动 10 条 + 扩容 12 条 = 22 条，那一轮在 startTurn 边界上整轮拒收。
    const same = Array.from({ length: 8 }, (_, i) =>
      skill({ id: `global:s${i}`, stages: ["正文"] })
    );
    expect(rankSkills(same, scene({ docKind: null }), 3, [], true, 2)).toHaveLength(2);
  });

  it("不开 keepTies 时 limit 一律照切：调用方明说只要三条，就只给三条", () => {
    // 技能库页的「推荐」榜走的是这条：limit 是调用方的明确要求，不是产品默认值。
    const same = Array.from({ length: 8 }, (_, i) =>
      skill({ id: `global:s${i}`, stages: ["正文"] })
    );
    expect(rankSkills(same, scene({ docKind: null }), 3)).toHaveLength(3);
  });

  it("默认按技能挂入上限取前 N（12）", () => {
    const list = Array.from({ length: 15 }, (_, i) =>
      skill({ id: `global:s${String(i).padStart(2, "0")}`, stages: ["正文"] })
    );
    expect(rankSkills(list, scene({ docKind: null }))).toHaveLength(12);
  });

  it("N 为 0 或负数 ⇒ 一条都不给（不是「给全部」）", () => {
    const list = [skill({ id: "global:a", stages: ["正文"] })];
    expect(rankSkills(list, scene({ docKind: null }), 0)).toEqual([]);
    expect(rankSkills(list, scene({ docKind: null }), -3)).toEqual([]);
  });

  it("纯函数：不改动传进来的候选与场景数组", () => {
    const candidates: SkillCandidate[] = [
      skill({ id: "global:a", stages: ["正文"], appliesTo: ["chapter", "material"] })
    ];
    const s = scene({ instruction: "伏笔" });
    const snapshot = JSON.stringify({ candidates, s });
    rankSkills(candidates, s);
    expect(JSON.stringify({ candidates, s })).toBe(snapshot);
  });

  it("结果带上 displayName，界面不必拿 id 再回表查一次", () => {
    const ranked = rankSkills(
      [skill({ id: "book:伏笔", displayName: "伏笔台账", stages: ["正文"] })],
      scene({ docKind: null })
    );
    expect(ranked[0]?.displayName).toBe("伏笔台账");
  });
});
