import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import type { SkillRef } from "@mochen/contracts";
import { useExtensionBrowseStore } from "./useExtensionBrowse";

/**
 * 技能页顶上那条「推荐」的装配层（2026-10-17，接 `utils/skill-pick` 的得分逻辑）。
 *
 * 打分本体已在 `skill-pick.test.ts` 里逐条钉过；这里只钉**装配**这三件事：
 * ① `SkillRef` 到候选切面的映射对不对（字段名一旦对歪，分数就静默变错）；
 * ② 已挂入的不重复推荐（跨 store 的那条口径）；
 * ③ 场景三项（阶段名 / 文稿类 / 指令）真的透传给了打分，没在中途被替换。
 */

function skill(over: Partial<SkillRef> = {}): SkillRef {
  return {
    id: "global:x",
    source: "global",
    dirName: "x",
    displayName: "示例技能",
    description: "一句说明",
    stages: [],
    appliesTo: [],
    relPath: "x/SKILL.md",
    ...over
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("useExtensionBrowse · 推荐装配", () => {
  it("把技能库按字段映射成候选：阶段命中就按阶段给分", () => {
    const ranked = useExtensionBrowseStore().skillRecommendations({
      library: [skill({ id: "global:rhythm", stages: ["正文"] })],
      pinned: [],
      stageName: "正文",
      docKind: null,
      instruction: ""
    });
    expect(ranked.map((one) => one.id)).toEqual(["global:rhythm"]);
    expect(ranked[0]?.score).toBe(40);
    expect(ranked[0]?.reasons).toEqual(["阶段「正文」匹配"]);
  });

  it("文稿类与指令都透传：appliesTo 命中 + 关键词命中两路都算上", () => {
    const ranked = useExtensionBrowseStore().skillRecommendations({
      library: [skill({ id: "global:plot", appliesTo: ["chapter"], description: "检查伏笔" })],
      pinned: [],
      stageName: "",
      docKind: "chapter",
      instruction: "伏笔"
    });
    expect(ranked[0]?.score).toBe(30 + 8);
    expect(ranked[0]?.reasons).toEqual(["适用文稿 chapter 匹配", "命中关键词「伏笔」"]);
  });

  it("已挂入的不再推荐", () => {
    const ranked = useExtensionBrowseStore().skillRecommendations({
      library: [
        skill({ id: "global:a", stages: ["正文"] }),
        skill({ id: "global:b", stages: ["正文"] })
      ],
      pinned: ["global:a"],
      stageName: "正文",
      docKind: null,
      instruction: ""
    });
    expect(ranked.map((one) => one.id)).toEqual(["global:b"]);
  });

  it("空技能库 ⇒ 空推荐（不是「没信号」和「没数据」混成一团）", () => {
    const ranked = useExtensionBrowseStore().skillRecommendations({
      library: [],
      pinned: [],
      stageName: "正文",
      docKind: "chapter",
      instruction: "随手写点"
    });
    expect(ranked).toEqual([]);
  });

  it("limit 可覆盖默认（默认取技能挂入上限 12）", () => {
    const library = Array.from({ length: 15 }, (_, i) =>
      skill({ id: `global:s${String(i).padStart(2, "0")}`, stages: ["正文"] })
    );
    const ranked = useExtensionBrowseStore().skillRecommendations({
      library,
      pinned: [],
      stageName: "正文",
      docKind: null,
      instruction: "",
      limit: 3
    });
    expect(ranked).toHaveLength(3);
  });
});
