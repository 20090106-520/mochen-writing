import { describe, expect, it } from "vitest";
import { skillBriefLine, SKILL_PATHS_MAX, type SkillRef } from "../src/skill.js";

/**
 * 挂入技能清单行（`skillBriefLine`）。
 *
 * 这一行会原样进系统提示，所以它同时受三件事约束：模型要能靠它调 `use_skill`（id 必须在）、
 * 一行不能长到被装配层的 clip 从中间切断、同一句制式话不能每条都重复一遍。
 * 2026-11-12 之前三条都破了：行尾缀着「正文未载入，需要时用 use_skill("id") 读取」，
 * 挂满 12 条就是 12 遍；description 一个字不截，三千字说明直接撑满 4000 字上限。
 */

function refOf(patch: Partial<SkillRef> = {}): SkillRef {
  return {
    id: "global:check-style",
    source: "global",
    dirName: "check-style",
    displayName: "文风检查",
    description: "按用词、句式、节奏三层找当前章的 AI 腔。",
    stages: [],
    appliesTo: [],
    relPath: "check-style/SKILL.md",
    ...patch
  };
}

describe("skillBriefLine · 挂入技能的一行清单", () => {
  it("带 id：模型靠它调 use_skill，少了就只能凭名字猜", () => {
    expect(skillBriefLine(refOf())).toContain("global:check-style");
  });

  it("不再逐行重复「正文未载入」那句——读法由上下文包末尾说一次", () => {
    const line = skillBriefLine(refOf());
    expect(line).not.toContain("正文未载入");
    expect(line).not.toContain("读取");
  });

  it("挂满 12 条时整段清单仍是短句，不是十二份说明书", () => {
    const text = Array.from({ length: SKILL_PATHS_MAX }, (_, index) =>
      skillBriefLine(refOf({ id: `global:s${index}`, dirName: `s${index}` }))
    ).join("\n");
    expect(text.length).toBeLessThan(SKILL_PATHS_MAX * 100);
  });

  it("description 超长按 48 字截断：三千字说明书不该整份进提示词", () => {
    const line = skillBriefLine(refOf({ description: "问".repeat(3000) }));
    const chars = [...line];
    expect(chars.length).toBeLessThan(120);
    expect(line).toContain("…");
    expect(line).not.toContain("问".repeat(60));
  });

  it("行长度上界远小于装配层的 4000 字 clip：那个上限不该有机会切到清单行", () => {
    const worst = skillBriefLine(
      refOf({
        description: "长".repeat(3000),
        stages: ["draft", "review", "polish"],
        appliesTo: ["chapter", "outline"]
      })
    );
    expect([...worst].length).toBeLessThan(200);
  });

  it("description 里的换行压成一行：否则一条技能在清单里被拆成两段", () => {
    const line = skillBriefLine(refOf({ description: "第一行\n第二行\t第三行" }));
    expect(line).not.toContain("\n");
    expect(line).toContain("第一行 第二行 第三行");
  });

  it("没写说明给「（无说明）」，不留一个空心的冒号", () => {
    expect(skillBriefLine(refOf({ description: "   " }))).toContain("：（无说明）");
  });

  it("阶段与文稿都为空时不出空括号", () => {
    expect(skillBriefLine(refOf())).not.toContain("（）");
  });

  it("阶段与文稿都有时按「阶段；文稿」排，与技能库页的读法一致", () => {
    const line = skillBriefLine(refOf({ stages: ["review"], appliesTo: ["chapter"] }));
    expect(line).toContain("（阶段：review；文稿：chapter）");
  });

  it("与技能库索引行同形：名称（id）：说明——两处一把尺，模型不必学两种格式", () => {
    const line = skillBriefLine(refOf());
    expect(line.startsWith("文风检查（global:check-style）：")).toBe(true);
  });
});
