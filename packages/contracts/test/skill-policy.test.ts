import { describe, expect, it } from "vitest";
import {
  EMPTY_SKILL_POLICY,
  effectiveSkillIds,
  isSkillDisabled,
  parseBookMeta,
  skillPolicyOf,
  skillPolicyWithDefault,
  skillPolicyWithDisabled
} from "../src/index.js";

/** 升级前写下的老 book.json：没有任何技能策略字段。 */
const oldBook = {
  id: "book_old",
  title: "旧书",
  schemaVersion: 1,
  stages: [{ id: "draft", name: "正文" }],
  activeStage: "draft",
  permissionMode: "read-only",
  chapterOrder: []
};

describe("书级技能策略（P0-4）", () => {
  it("老书没有 skillPolicy ⇒ 归一化成两个空清单，行为与升级前一致", () => {
    const meta = parseBookMeta(oldBook);
    expect(meta.skillPolicy).toBeUndefined();
    expect(skillPolicyOf(meta)).toEqual({ enabled: [], disabled: [] });
    expect(skillPolicyOf(null)).toEqual(EMPTY_SKILL_POLICY);
  });

  it("新书带 skillPolicy 能原样往返；半份策略（只写 enabled）缺的清单补空", () => {
    const full = {
      ...oldBook,
      skillPolicy: { enabled: ["global:rhythm"], disabled: ["book:foreshadow"] }
    };
    expect(parseBookMeta(full).skillPolicy).toEqual(full.skillPolicy);

    const half = { ...oldBook, skillPolicy: { enabled: ["global:rhythm"] } };
    expect(parseBookMeta(half).skillPolicy).toEqual({
      enabled: ["global:rhythm"],
      disabled: []
    });
  });

  it("生效清单：线程覆盖优先；停用的一律剔除，顺序不变", () => {
    const policy = { enabled: ["global:rhythm"], disabled: ["book:foreshadow"] };
    // 没有覆盖 ⇒ 继承书级默认。
    expect(effectiveSkillIds(policy)).toEqual(["global:rhythm"]);
    // 覆盖里有停用项 ⇒ 被剔除。
    expect(effectiveSkillIds(policy, ["book:foreshadow", "global:rhythm"])).toEqual([
      "global:rhythm"
    ]);
    // 空覆盖是明确的「本会话一个都不挂」，不退回去继承。
    expect(effectiveSkillIds(policy, [])).toEqual([]);
    expect(isSkillDisabled(policy, "book:foreshadow")).toBe(true);
    expect(isSkillDisabled(policy, "global:rhythm")).toBe(false);
  });

  it("设为默认时顺手解除停用（两个清单互斥）", () => {
    const next = skillPolicyWithDefault(
      { enabled: [], disabled: ["global:rhythm"] },
      "global:rhythm",
      true
    );
    expect(next).toEqual({ enabled: ["global:rhythm"], disabled: [] });
    expect(skillPolicyWithDefault(next, "global:rhythm", false)).toEqual({
      enabled: [],
      disabled: []
    });
  });

  it("停用时从默认清单摘掉；重新启用不自动挂回默认", () => {
    const policy = { enabled: ["global:rhythm"], disabled: [] };
    const off = skillPolicyWithDisabled(policy, "global:rhythm", true);
    expect(off).toEqual({ enabled: [], disabled: ["global:rhythm"] });
    expect(skillPolicyWithDisabled(off, "global:rhythm", false)).toEqual({
      enabled: [],
      disabled: []
    });
  });
});
