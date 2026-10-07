import { describe, expect, it } from "vitest";
import {
  AGENT_PROFILES,
  DEFAULT_PROFILE_ID,
  findProfile,
  profilesForStage,
  resolveProfile,
  writeScopeAllows
} from "../src/agent-profile.js";
import { bookMetaSchema, parseBookMeta } from "../src/book.js";
import { AGENT_TOOL_NAMES } from "../src/tools.js";

const STAGE_IDS = ["idea", "outline", "character", "draft", "revision"] as const;

describe("墨宸花名册 · 六枚档案的形状", () => {
  it("恰好六枚，id 不重", () => {
    expect(AGENT_PROFILES).toHaveLength(6);
    expect(new Set(AGENT_PROFILES.map((p) => p.id)).size).toBe(6);
  });

  it("每一枚都报得出屏显名、职责、提示词（不许有空壳档案）", () => {
    for (const profile of AGENT_PROFILES) {
      expect(profile.name.trim(), `${profile.id} 没有屏显名`).not.toBe("");
      expect(profile.duty.trim(), `${profile.id} 没有职责说明`).not.toBe("");
      expect(profile.prompt.trim().length, `${profile.id} 的提示词是空的`).toBeGreaterThan(10);
      expect(profile.tools.length, `${profile.id} 一个工具都没有`).toBeGreaterThan(0);
    }
  });

  // 反向钉：档案的工具集只能从 AGENT_TOOL_NAMES 取子集（spec §5.1「工具只能从 5 个里取子集」）。
  // 有人往花名册里塞一个不存在的工具名，这条立刻红——编译期未必拦得住字符串字面量。
  it("工具集全部来自 AGENT_TOOL_NAMES，没有凭空多出来的", () => {
    for (const profile of AGENT_PROFILES) {
      for (const tool of profile.tools) {
        expect(
          (AGENT_TOOL_NAMES as readonly string[]).includes(tool),
          `${profile.id} 用了不在 AGENT_TOOL_NAMES 里的工具：${tool}`
        ).toBe(true);
      }
    }
  });

  it("每一枚都至少能读文档（没有档案是瞎子）", () => {
    for (const profile of AGENT_PROFILES) {
      expect(profile.tools, `${profile.id} 连 read_doc 都没有`).toContain("read_doc");
    }
  });
});

describe("resolveProfile · 四级优先级", () => {
  const stages = STAGE_IDS.map((id) => ({ id, name: id }));

  it("书级 activeProfile 压过阶段自带与阶段默认", () => {
    const withOwn = [{ id: "draft", name: "正文", profile: "continuer" }];
    expect(
      resolveProfile({ activeProfile: "reviewer", stages: withOwn, activeStage: "draft" }).id
    ).toBe("reviewer");
  });

  it("书级没设时用阶段自带的 profile", () => {
    const withOwn = [{ id: "draft", name: "正文", profile: "continuer" }];
    expect(resolveProfile({ stages: withOwn, activeStage: "draft" }).id).toBe("continuer");
  });

  it("阶段既没自带、也不在表里（如「构思」未登记）⇒ 落到全局兜底，不抛错", () => {
    expect(
      resolveProfile({ stages: [{ id: "brand-new", name: "新阶段" }], activeStage: "brand-new" }).id
    ).toBe(DEFAULT_PROFILE_ID);
  });

  it("activeStage 为 null（还没开书）⇒ 兜底，不炸", () => {
    expect(resolveProfile({ stages, activeStage: null }).id).toBe(DEFAULT_PROFILE_ID);
  });

  it("activeProfile 写了不存在的 id ⇒ 静默兜底，绝不把半个档案带进上下文", () => {
    // 脏数据（手改 book.json / 旧版本残留）不该让整个智能体停摆。
    expect(
      resolveProfile({ activeProfile: "no-such-profile", stages, activeStage: "draft" }).id
    ).toBe(DEFAULT_PROFILE_ID);
  });

  it("阶段 id 未登记时，表里的对应关系仍然成立", () => {
    expect(resolveProfile({ stages, activeStage: "revision" }).id).toBe("reviewer");
    expect(resolveProfile({ stages, activeStage: "idea" }).id).toBe("world");
  });
});

describe("writeScopeAllows · 写入范围是上限（spec §5.1 约束 3）", () => {
  it("审稿对任何目标都不放行——只出批注式提案", () => {
    const reviewer = findProfile("reviewer")!;
    expect(writeScopeAllows(reviewer.writeScope, "current-chapter")).toBe(false);
    expect(writeScopeAllows(reviewer.writeScope, "chapter")).toBe(false);
    expect(writeScopeAllows(reviewer.writeScope, "outline")).toBe(false);
  });

  it("主笔只碰当前章，碰不到人物卡", () => {
    const lead = findProfile("lead-writer")!;
    expect(writeScopeAllows(lead.writeScope, "current-chapter")).toBe(true);
    expect(writeScopeAllows(lead.writeScope, "chapter")).toBe(true);
    expect(writeScopeAllows(lead.writeScope, "character")).toBe(false);
  });

  it("世界的上限是素材与大纲，碰不到正文", () => {
    const world = findProfile("world")!;
    expect(writeScopeAllows(world.writeScope, "material")).toBe(true);
    expect(writeScopeAllows(world.writeScope, "outline")).toBe(true);
    expect(writeScopeAllows(world.writeScope, "chapter")).toBe(false);
  });

  it("续写声明了只追加（appendOnly），这是给装配层看的标记", () => {
    const continuer = findProfile("continuer")!;
    expect(continuer.writeScope.kind).toBe("current-chapter");
    expect(continuer.writeScope.kind === "current-chapter" && continuer.writeScope.appendOnly).toBe(
      true
    );
  });
});

describe("profilesForStage · 一阶段可挂多枚档案", () => {
  it("正文阶段挂主笔与续写两枚（spec §5.1：中栏可切到续写）", () => {
    const ids = profilesForStage([{ id: "draft", name: "正文" }], "draft").map((p) => p.id);
    expect(ids).toContain("lead-writer");
    expect(ids).toContain("continuer");
  });

  it("阶段自带的那一枚排在最前", () => {
    const stages = [{ id: "draft", name: "正文", profile: "continuer" }];
    expect(profilesForStage(stages, "draft")[0]!.id).toBe("continuer");
  });

  it("未登记的阶段至少给出兜底那一枚，不能是空数组（空数组=选择器开天窗）", () => {
    const ids = profilesForStage([{ id: "mystery", name: "?" }], "mystery").map((p) => p.id);
    expect(ids).toContain(DEFAULT_PROFILE_ID);
  });
});

describe("book.json 兼容：老书没有 profile 字段也要解析得过", () => {
  it("单个 draft 阶段、无任何 profile 字段的老书照常解析", () => {
    const meta = parseBookMeta({
      id: "b1",
      title: "深渊之下",
      schemaVersion: 1,
      stages: [{ id: "draft", name: "正文" }],
      activeStage: "draft",
      permissionMode: "read-only",
      chapterOrder: []
    });
    expect(meta.stages[0]!.profile).toBeUndefined();
    expect(meta.activeProfile).toBeUndefined();
    // 而且它能解析出一枚真档案，不是落空
    expect(resolveProfile({ stages: meta.stages, activeStage: meta.activeStage }).id).toBe(
      "lead-writer"
    );
  });

  it("带 profile 字段的新书也能过校验", () => {
    const parsed = bookMetaSchema.safeParse({
      id: "b1",
      title: "深渊之下",
      schemaVersion: 1,
      stages: [{ id: "draft", name: "正文", profile: "continuer" }],
      activeStage: "draft",
      permissionMode: "full-access",
      chapterOrder: [],
      activeProfile: "continuer"
    });
    expect(parsed.success).toBe(true);
  });

  it("profile 是空串 ⇒ 拒绝（写了就要写对，空串是脏数据不是「未设置」）", () => {
    const parsed = bookMetaSchema.safeParse({
      id: "b1",
      title: "深渊之下",
      schemaVersion: 1,
      stages: [{ id: "draft", name: "正文", profile: "" }],
      activeStage: "draft",
      permissionMode: "full-access",
      chapterOrder: []
    });
    expect(parsed.success).toBe(false);
  });
});
