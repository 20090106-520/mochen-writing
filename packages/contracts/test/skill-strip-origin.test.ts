import { describe, expect, it } from "vitest";
import { stripSkillOrigin } from "../src/skill.js";

/**
 * 递技能正文给模型之前，剥掉末尾的「## 出处」（2026-11-12）。
 *
 * 这份函数的全部风险都集中在**边界**上：多剥一个字就是吃掉方法，少剥一个字就是模型多读一段
 * 版权声明。所以这里逐条钉边界，而不是只测「正常情况能剥」。
 */
describe("stripSkillOrigin · 只摘文末那一节", () => {
  const BODY = [
    "# 文风检查",
    "",
    "## 逐条扫：命中即改",
    "",
    "先按词表过一遍，再按句式过一遍。",
    "",
    "## 出处",
    "",
    "改编自 zenstory-ai/oh-story-claudecode 的 story-long-write（MIT）。"
  ].join("\n");

  it("摘掉文末的出处，方法原样留着", () => {
    const kept = stripSkillOrigin(BODY);
    expect(kept).not.toContain("## 出处");
    expect(kept).not.toContain("改编自");
    expect(kept).toContain("## 逐条扫：命中即改");
    expect(kept).toContain("先按词表过一遍，再按句式过一遍。");
    // 尾部空白跟着摘：留着两个空行，装配层按 \n\n 拼段时会多出一截空档。
    expect(kept.endsWith("。")).toBe(true);
  });

  it("没有出处就一个字不动", () => {
    const plain = "# 起手式\n\n第一句先落一个动作。";
    expect(stripSkillOrigin(plain)).toBe(plain);
  });

  it("「出处」在中间、后面还有正文：不许摘（摘到文末就是吃内容）", () => {
    const mid = [
      "# 某技能",
      "",
      "## 出处",
      "",
      "某处来的。",
      "",
      "## 还有一节方法",
      "",
      "这一段必须留下来。"
    ].join("\n");
    expect(stripSkillOrigin(mid)).toBe(mid);
  });

  it("文末那一节叫别的名字（「来源」「许可」）：不认，原样递出去", () => {
    // 只认「出处」两个字：认宽了会把「## 来源与取舍」这种正经方法段吃掉。
    const other = "# 技能\n\n## 来源与取舍\n\n这一节讲方法。";
    expect(stripSkillOrigin(other)).toBe(other);
  });

  it("整份正文只有一节出处：宁可原样递，也不递一段空白", () => {
    const only = "## 出处\n\n改编自某处。";
    expect(stripSkillOrigin(only)).toBe(only);
  });

  it("### 三级标题不算小节边界", () => {
    // 「### 出处」是方法内部的小标题，不是文末的出处节。
    const deep = "# 技能\n\n### 出处考据\n\n方法在这里。\n\n## 出处\n\n改编自某处。";
    const kept = stripSkillOrigin(deep);
    expect(kept).toContain("### 出处考据");
    expect(kept).not.toContain("改编自某处。");
  });

  it("出处后面只有空白行：照样摘干净", () => {
    const trailing = "# 技能\n\n方法。\n\n## 出处\n\n改编自某处（MIT）。\n\n\n";
    expect(stripSkillOrigin(trailing)).toBe("# 技能\n\n方法。");
  });
});
