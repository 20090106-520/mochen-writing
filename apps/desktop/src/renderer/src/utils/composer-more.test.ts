/**
 * 二级选项表 · 源码与数据契约（2026-11-09，2026-11-10 补独立卡片）。
 * 「更多」四组打开方式统一后，最容易长歪的是「某一组又退回成按一下就切」和
 * 「命令目录自己抄一份命令表」；自动技能按用户裁定挪出「更多」，改由
 * autoSkillSheetView 单独出视图，但仍走同一个渲染组件。
 * 这里把数据源、分组、当前态、禁用理由与动作分派逐项钉住。
 */
import { describe, expect, it } from "vitest";
import { SLASH_COMMANDS } from "./slash-commands";
import {
  MORE_GROUP_IDS,
  autoSkillSheetView,
  draftSampleSteps,
  groupHeadingAt,
  moreSheetView,
  type MoreGroupId,
  type MoreSheetState
} from "./composer-more";

const state = (over: Partial<MoreSheetState> = {}): MoreSheetState => ({
  hasBook: true,
  sampleCount: 1,
  workMode: "act",
  webSearchEnabled: true,
  disabledTools: [],
  commands: [...SLASH_COMMANDS],
  autoSkills: { enabled: true, paused: false, library: [], blockedCount: 0 },
  ...over
});

/** 技能卡里的一行（2026-11-10）：给出库里的某枚 + 这一轮的状态。 */
function skill(
  id: string,
  over: Partial<{ name: string; detail: string; pinned: boolean; auto: boolean }> = {}
): {
  id: string;
  name: string;
  detail: string;
  pinned: boolean;
  auto: boolean;
} {
  const name = id.slice(id.indexOf(":") + 1);
  return {
    id,
    name,
    detail: `治什么（${name}）`,
    pinned: false,
    auto: false,
    ...over
  };
}

describe("draftSampleSteps · 选档仍走唯一的循环动作", () => {
  it("同一档 0 步；顺着档序与绕回都算得对", () => {
    expect(draftSampleSteps(1, 1)).toBe(0);
    expect(draftSampleSteps(1, 2)).toBe(1);
    expect(draftSampleSteps(1, 3)).toBe(2);
    expect(draftSampleSteps(3, 1)).toBe(1);
    expect(draftSampleSteps(3, 2)).toBe(2);
  });

  it("不认识的值退回 0 步，绝不把档位推进到表外", () => {
    // 目录里的 id 从 DRAFT_SAMPLE_COUNTS 现拼，这一格是防御性兜底。
    expect(draftSampleSteps(1, 9 as unknown as 1)).toBe(0);
  });
});

describe("groupHeadingAt · 组标题只画在第一行", () => {
  it("换组才出标题，同组连续行返回 null", () => {
    const options = [{ group: "书稿" }, { group: "书稿" }, { group: "会话" }, { group: "会话" }];
    expect(options.map((_, i) => groupHeadingAt(options, i))).toEqual(["书稿", null, "会话", null]);
  });
});

describe("moreSheetView · 四组同款结构 + 独立的自动技能卡片", () => {
  it("四组与那张独立卡片都有标题、提示、页脚与至少一条可选项", () => {
    const views = [
      ...MORE_GROUP_IDS.map((group) => [group, moreSheetView(group, state())] as const),
      ["auto-skills", autoSkillSheetView(state())] as const
    ];
    for (const [group, view] of views) {
      expect(view.title.length, `${group} 缺标题`).toBeGreaterThan(0);
      expect(view.hint.length, `${group} 缺提示`).toBeGreaterThan(0);
      expect(view.foot.length, `${group} 缺页脚`).toBeGreaterThan(0);
      expect(view.options.length, `${group} 没有可选项`).toBeGreaterThan(0);
      for (const option of view.options) {
        expect(option.detail.length, `${group}/${option.id} 缺说明`).toBeGreaterThan(3);
        expect(option.group.length, `${group}/${option.id} 缺分组`).toBeGreaterThan(0);
      }
    }
  });

  it("技能卡：整库都在，挂着的标「自动/手动」，其余平铺可点（2026-11-10 用户裁定）", () => {
    const view = autoSkillSheetView(
      state({
        autoSkills: {
          enabled: true,
          paused: false,
          library: [
            skill("global:foreshadow", {
              name: "伏笔梳理",
              detail: "阶段「正文」匹配",
              pinned: true,
              auto: true
            }),
            skill("book:节拍", { name: "节拍", pinned: true, auto: false }),
            skill("global:deslop", { name: "去味" })
          ],
          blockedCount: 2
        }
      })
    );
    expect(view.options.find((o) => o.action === "auto-toggle")?.selected).toBe(true);
    // 三枚技能一行不少：这张卡就是「自己选用哪几枚」，不是「看看自动挑了啥」。
    const rows = view.options.filter((o) => o.action === "skill-toggle");
    expect(rows.map((o) => o.label)).toEqual(["伏笔梳理", "节拍", "去味"]);
    // 挂着的在前、未挂的在后：用户点开这张卡最想知道的是「这一轮到底带了什么」。
    expect(rows.map((o) => o.selected)).toEqual([true, true, false]);
    // 角标分得清「它替你挑的」与「你亲手挂的」——关总开关只撤前者。
    expect(rows.map((o) => o.badge)).toEqual(["自动", "手动", ""]);
    expect(rows[0]?.detail).toContain("阶段");
    expect(rows[2]?.detail).toContain("治什么");
    expect(view.options.find((o) => o.action === "auto-clear")?.disabled).toBe(false);
    expect(view.options.find((o) => o.action === "auto-reset")?.detail).toContain("2 条");
    // 装新的、改正文那一页有出口，但它是**一行**，不是默认落点。
    expect(view.options.find((o) => o.action === "skills-page")?.disabled).toBe(false);

    const off = autoSkillSheetView(
      state({ autoSkills: { enabled: false, paused: false, library: [], blockedCount: 0 } })
    );
    expect(off.options.find((o) => o.action === "auto-toggle")?.selected).toBe(false);
    expect(off.options.find((o) => o.action === "auto-clear")?.disabled).toBe(true);
    expect(off.options.find((o) => o.action === "auto-reset")?.disabled).toBe(true);
    // 空库也得留出口：卡片里说清「去技能库页装一份」，而不是只显示一句「没有」。
    expect(off.options.some((o) => o.action === "skills-page")).toBe(true);
    expect(off.empty).toContain("装一份");
  });

  it("「全部取下」的角标只数自动挂的：数总挂着会让人以为连同亲手挂的一起撤", () => {
    const view = autoSkillSheetView(
      state({
        autoSkills: {
          enabled: true,
          paused: false,
          library: [
            skill("global:a", { pinned: true, auto: true }),
            skill("book:b", { pinned: true, auto: false }),
            skill("book:c", { pinned: true, auto: false })
          ],
          blockedCount: 0
        }
      })
    );
    expect(view.options.find((o) => o.action === "auto-clear")?.badge).toBe("1 枚");
  });

  it("全部取下后本线程暂停：卡片说清「已暂停」，唯一能点的解封口是恢复自动推荐", () => {
    const view = autoSkillSheetView(
      state({ autoSkills: { enabled: true, paused: true, library: [], blockedCount: 3 } })
    );
    const toggle = view.options.find((o) => o.action === "auto-toggle");
    expect(toggle?.selected).toBe(true);
    expect(toggle?.detail).toContain("暂停");
    const clear = view.options.find((o) => o.action === "auto-clear");
    expect(clear?.badge).toBe("已暂停");
    expect(clear?.disabled).toBe(true);
    const reset = view.options.find((o) => o.action === "auto-reset");
    expect(reset?.disabled).toBe(false);
    expect(reset?.detail).toContain("解除本线程的自动挂入暂停");
    expect(reset?.detail).toContain("3 条手动否决");
  });

  it("多稿：三档来自 contracts，当前档打勾，动作统一是 draft", () => {
    const view = moreSheetView("draft", state({ sampleCount: 2 }));
    expect(view.options.map((o) => o.id)).toEqual(["1", "2", "3"]);
    expect(view.options.filter((o) => o.selected).map((o) => o.id)).toEqual(["2"]);
    expect(new Set(view.options.map((o) => o.action))).toEqual(new Set(["draft"]));
    expect(view.options[2]?.detail).toContain("3 倍");
  });

  it("工具：开关态来自 disabledTools，联网关掉时两枚出网工具从清单消失", () => {
    const on = moreSheetView("tools", state({ disabledTools: ["read_doc"] }));
    expect(on.options.find((o) => o.id === "read_doc")?.badge).toBe("已关");
    expect(on.options.find((o) => o.id === "read_doc")?.selected).toBe(false);
    expect(on.options.find((o) => o.id === "__roster__")?.action).toBe("roster");

    const off = moreSheetView("tools", state({ webSearchEnabled: false }));
    expect(off.options.some((o) => o.id === "web_search")).toBe(false);
    expect(off.options.some((o) => o.id === "web_read")).toBe(false);
    expect(off.hint).toMatch(/带出 \d+ \/ \d+ 枚/);
  });

  it("工具目录按用途归堆：读/写交替的原序不会让同一个组标题冒出两回", () => {
    const view = moreSheetView("tools", state());
    const headings = view.options
      .map((_, i) => groupHeadingAt(view.options, i))
      .filter((v): v is string => v !== null);
    expect(headings).toEqual(["只读检索", "会改稿", "更多"]);
  });

  it("命令：只列过闸后的命令，中文短名 + 图标 + 完整命令名 + 分组都不缺", () => {
    const view = moreSheetView("palette", state({ commands: ["model", "status"], hasBook: false }));
    const summon = view.options[0];
    expect(summon?.action).toBe("summon");
    expect(summon?.badge).toBe("/");
    const model = view.options.find((o) => o.id === "model");
    expect(model?.label).toBe("模型设置");
    expect(model?.badge).toBe("/model");
    expect(model?.icon).toBe("model");
    expect(model?.group).toBe("配置");
    expect(model?.action).toBe("command");
    expect(view.options.some((o) => o.id === "wordcount")).toBe(false);
  });

  it("命令目录按用途分组排序，且组内不重排到分组之外", () => {
    const view = moreSheetView("palette", state());
    const headings = view.options
      .map((_, i) => groupHeadingAt(view.options, i))
      .filter((v): v is string => v !== null);
    expect(headings[0]).toBe("快捷入口");
    expect(headings.slice(1)).toEqual(["书稿", "会话", "视图", "数据", "配置"]);
    // 命令表全在时：一条搜索入口 + 12 条命令，一枚不多一枚不少。
    expect(view.options.length).toBe(SLASH_COMMANDS.length + 1);
  });

  it("工作模式：两档来自 WORK_MODES；无书整组禁用且说明里讲清为什么", () => {
    const withBook = moreSheetView("work-mode", state({ workMode: "plan" }));
    expect(withBook.options.map((o) => o.id)).toEqual(["plan", "act"]);
    expect(withBook.options.filter((o) => o.selected).map((o) => o.id)).toEqual(["plan"]);

    const noBook = moreSheetView("work-mode", state({ hasBook: false }));
    expect(noBook.options.every((o) => o.disabled)).toBe(true);
    expect(noBook.options.every((o) => o.detail.includes("作品目录"))).toBe(true);
    expect(noBook.options.some((o) => o.selected)).toBe(false);
  });

  it("四组 id 与 chip 的 more 分区同集；自动技能不在里面（2026-11-10 用户裁定）", () => {
    expect([...MORE_GROUP_IDS]).toEqual(["draft", "tools", "palette", "work-mode"]);
    const all: MoreGroupId[] = ["draft", "tools", "palette", "work-mode"];
    expect([...MORE_GROUP_IDS]).toEqual(all);
    // 反向钉：自动技能连一个能走进 moreSheetView 的 group 都不该有。
    expect((MORE_GROUP_IDS as readonly string[]).includes("auto-skills")).toBe(false);
    // 2026-11-10 用户裁定：这张卡从「自动技能」扩成「技能」——整库可选，自动挑的标角标。
    expect(autoSkillSheetView(state()).title).toBe("技能");
  });
});
