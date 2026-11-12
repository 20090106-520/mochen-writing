import { beforeEach, describe, expect, it } from "vitest";
import type { SkillRef } from "@mochen/contracts";
import { createDocToolHost } from "./doc-tools-host.js";

/**
 * 技能停用是一道硬闸（P0-4）。
 *
 * 停用开关只在技能页上，但真正要紧的是模型那一侧：被停用的技能**既不该出现在清单里**，
 * 也**不该能显式读到正文**。技能 id 会长久留在会话历史里，模型照着旧 id 调 `use_skill`
 * 是常态；只挡清单不挡正文，停用就等于没关。
 */
let skillRefs: SkillRef[] = [];
let skillDisabledIds: string[] = [];
let skillReads: string[] = [];

beforeEach(() => {
  skillRefs = [];
  skillDisabledIds = [];
  skillReads = [];
});

function ref(id: string): SkillRef {
  const [source, dirName] = id.split(":") as ["global" | "book", string];
  return {
    id,
    source,
    dirName,
    displayName: id,
    description: "",
    stages: [],
    appliesTo: [],
    relPath: `skills/${dirName}/SKILL.md`
  };
}

function host() {
  return createDocToolHost({
    root: () => null,
    docs: () => [],
    context: () => ({ docRelPath: null, permissionMode: "read-only", workMode: "act" }),
    onProposal: () => {},
    newId: () => "p1",
    now: () => "2026-11-08T00:00:00.000Z",
    webSearch: async () => ({
      sourceId: "test",
      sourceLabel: "测试源",
      results: [],
      attempted: 0,
      skipped: [],
      deduped: 0
    }),
    webRead: async () => ({ title: "", url: "", text: "", truncated: false }),
    listSkills: async () => skillRefs,
    readSkill: async (id) => {
      skillReads.push(id);
      return { title: id, text: `技能正文：${id}` };
    },
    skillDisabled: (id) => skillDisabledIds.includes(id)
  });
}

describe("技能停用是一道硬闸（P0-4）", () => {
  it("无参清单里不出现已停用的技能（模型看不见它）", async () => {
    skillRefs = [ref("global:rhythm"), ref("book:foreshadow")];
    skillDisabledIds = ["book:foreshadow"];
    const out = await host().call("use_skill", {});
    expect(out.ok, out.text).toBe(true);
    expect(out.text).toContain("global:rhythm");
    expect(out.text).not.toContain("book:foreshadow");
  });

  it("**显式读取**已停用的技能也拒绝，且一次正文都不读", async () => {
    skillRefs = [ref("book:foreshadow")];
    skillDisabledIds = ["book:foreshadow"];
    const out = await host().call("use_skill", { skill: "book:foreshadow" });
    expect(out.ok).toBe(false);
    expect(out.text).toContain("已停用");
    expect(skillReads).toEqual([]);
  });

  it("没停用的照常能读（闸不是一刀切）", async () => {
    skillRefs = [ref("global:rhythm")];
    const out = await host().call("use_skill", { skill: "global:rhythm" });
    expect(out.ok, out.text).toBe(true);
    expect(out.text).toContain("技能正文：global:rhythm");
    expect(skillReads).toEqual(["global:rhythm"]);
  });
});

/**
 * 无参清单的行形（2026-11-12）。
 *
 * 这一份清单原先写成 `- id · 名称：说明`，而系统提示里的技能清单是 `- 名称（id）：说明`——
 * 同一个东西两种形状，模型得学两遍。现在两处都走 `skillBriefLine`，格式只有一种，
 * description 也共用同一把 48 字的尺（几千字说明撑不满一条回执）。
 */
describe("use_skill 无参清单与系统提示同形", () => {
  it("行形是「名称（id）：说明」，不是「id · 名称：说明」", async () => {
    skillRefs = [{ ...ref("global:rhythm"), displayName: "节奏", description: "一章一节拍。" }];
    const out = await host().call("use_skill", {});
    expect(out.text).toContain("- 节奏（global:rhythm）：一章一节拍。");
    expect(out.text).not.toContain("·");
  });

  it("description 与索引同尺：超长也截到一个能读的长度", async () => {
    skillRefs = [{ ...ref("global:long"), description: "说明".repeat(500) }];
    const out = await host().call("use_skill", {});
    expect(out.text).toContain("…");
    expect(out.text.length).toBeLessThan(200);
  });
});
