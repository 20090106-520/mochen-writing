import { describe, expect, it } from "vitest";
import { NO_BOOK_CHIP_LABEL, permissionChipView } from "./permission-chip";
import {
  CHIP_EMIT,
  composerChips,
  composerCounter,
  WORK_MODE_NO_BOOK_LABEL
} from "./composer-chips";
import { USER_TEXT_MAX_LEN, WORK_MODE_LABELS } from "@mochen/contracts";

/** chip 行的入参默认值：只关心某一枚时，其余按「什么都没开」传。 */
function input(over: Partial<Parameters<typeof composerChips>[0]> = {}) {
  return {
    hasBook: true,
    mode: "read-only" as const,
    workMode: "act" as const,
    saving: false,
    thinkingLevel: "off" as const,
    thinkingWire: "standard" as const,
    webSearchEnabled: false,
    sampleCount: 1 as const,
    modelLabel: "mochen-mock",
    baseURL: "http://127.0.0.1:8787/v1",
    ...over
  };
}

function chip(id: string, over: Partial<Parameters<typeof composerChips>[0]> = {}) {
  return composerChips(input(over)).find((item) => item.id === id);
}

/** #112 照参考图定的数组序 = 左端从左到右的渲染序，权限档落在右端。 */
const CHIP_ORDER = [
  "model",
  "thinking",
  "web-search",
  "draft",
  "tools",
  "palette",
  "work-mode",
  "permission"
];

describe("composer-chips · 八枚真开关/入口，排队不做按钮（F-D + #101 + #104）", () => {
  it("id 顺序逐字钉死：model/thinking/web-search/draft/tools/palette/permission（排队按钮不许长出来）", () => {
    expect(composerChips(input()).map((c) => c.id)).toEqual(CHIP_ORDER);
  });

  it("T9-1 反向钉：palette chip 的 title 不得再宣传不存在的 Ctrl+K 键位", () => {
    // 实测 hotkeys.ts 的全局 Ctrl 族没有 k，面板真身是裸 / 键。
    expect(chip("palette")?.title).not.toContain("Ctrl");
  });

  // ── 先计划后动手（2026-10-05 批次 4） ────────────────────────────────────
  it("工作模式 chip 文案读 WORK_MODE_LABELS，不手抄标签", () => {
    expect(chip("work-mode", { workMode: "plan" })?.text).toBe(WORK_MODE_LABELS.plan);
    expect(chip("work-mode", { workMode: "act" })?.text).toBe(WORK_MODE_LABELS.act);
  });

  // 落在右端那一摞：它和权限档是同一族问题（「能碰多大」），分栏表是它的一部分（铁律 6）。
  it("工作模式 chip 落在右端、挨着权限档", () => {
    expect(chip("work-mode")?.slot).toBe("right");
  });

  it("两枚都是真开关，所以带按下态、不带下拉三角", () => {
    // 计划档是**按下去生效**的两态，`aria-pressed` 用 active 才不撒谎；
    // 点一下就切换、没有第二层可展开 ⇒ caret 恒假。
    expect(chip("work-mode", { workMode: "plan" })?.active).toBe(true);
    expect(chip("work-mode", { workMode: "act" })?.active).toBe(false);
    expect(chip("work-mode")?.caret).toBe(false);
    // 事件名走 CHIP_EMIT 这张穷尽表（铁律 6）：少一格 tsc 当场报，少一个事件这里报。
    expect(CHIP_EMIT["work-mode"]).toBe("toggle-work-mode");
  });

  // 没开书时这一格不存在意义：工作模式是**书级**设置，没书就没有它。
  it("没打开作品目录 ⇒ 禁用并说清为什么（不假装自己开着某个模式）", () => {
    const c = chip("work-mode", { hasBook: false, mode: null });
    expect(c?.disabled).toBe(true);
    expect(c?.active).toBe(false);
    expect(c?.text).toBe(WORK_MODE_NO_BOOK_LABEL);
    // 反向钉（2026-10-14 真机截图）：不许和 permission chip 的无书文案撞成同一串——
    // 两枚同排右端的 chip 并排一模一样，读起来像渲染事故。
    expect(c?.text).not.toBe(NO_BOOK_CHIP_LABEL);
    expect(c?.title).toContain("作品目录");
  });

  // 反向钉：图标不许和「工具」那枚撞成同一个（两枚并排长一样，用户分不出按的是哪颗）。
  it("工作模式的图标与工具 chip 不撞", () => {
    expect(chip("work-mode", { workMode: "plan" })?.icon).not.toBe(chip("tools")?.icon);
    expect(chip("work-mode", { workMode: "act" })?.icon).not.toBe(chip("tools")?.icon);
  });

  it("联动用例：permission chip 与 permissionChipView 的五个显示字段逐字段同值（防两份判定漂移）", () => {
    const inputs = [
      input({ mode: "chapter-write" }),
      input({ mode: "full-access", saving: true }),
      input({ hasBook: false, mode: null })
    ];
    for (const item of inputs) {
      const view = permissionChipView(item);
      const permission = composerChips(item).find((c) => c.id === "permission");
      expect(permission).toMatchObject({
        id: "permission",
        text: view.text,
        disabled: view.disabled,
        title: view.title,
        icon: view.icon
      });
    }
  });

  it("无书 ⇒ permission chip disabled 且文案不是任何档位名（透传 permissionChipView 的诚实）", () => {
    const permission = chip("permission", { hasBook: false, mode: null });
    expect(permission?.disabled).toBe(true);
    expect(permission?.text).toBe("未打开作品目录");
    expect(permission?.text).not.toBe("只读参考"); // 波 1 缺陷②「捏造档位名」的反向钉
  });

  it("排队数字不在 chip 行出现（裁定 C：唯一真身是 composeStatusLine）", () => {
    expect(composerChips(input()).every((c) => !c.text.includes("排队"))).toBe(true);
  });

  it("每枚 chip 的键集固定为八字段（active 是aria-pressed 的真值来源，不许漏也不许多；#112 起 icon/caret 取代 badge，图标与下拉三角同表决策）", () => {
    for (const c of composerChips(input()))
      expect(Object.keys(c).sort()).toEqual([
        "active",
        "caret",
        "disabled",
        "icon",
        "id",
        "slot",
        "text",
        "title"
      ]);
  });
});

describe("composer-chips · 深度思考", () => {
  it("文案只有档位名（#112 照参考图：图标已经说明这是思考等级，文字不再重复「深度思考」）", () => {
    expect(chip("thinking", { thinkingLevel: "off" })?.text).toBe("关闭");
    expect(chip("thinking", { thinkingLevel: "low" })?.text).toBe("较低");
    expect(chip("thinking", { thinkingLevel: "medium" })?.text).toBe("标准");
    expect(chip("thinking", { thinkingLevel: "high" })?.text).toBe("深度");
  });

  it("active 只在非 off 时为真（关档时按下态不许骗人）", () => {
    expect(chip("thinking", { thinkingLevel: "off" })?.active).toBe(false);
    expect(chip("thinking", { thinkingLevel: "low" })?.active).toBe(true);
  });

  // 报不出出站字段名的控件不进 UI：title 必须说出这一档实际发出去的那对键值。
  it("title 逐字报出 reasoning_effort 与档位；关档则说「不发字段」", () => {
    expect(chip("thinking", { thinkingLevel: "off" })?.title).toContain("reasoning_effort");
    expect(chip("thinking", { thinkingLevel: "off" })?.title).toContain("不发");
    expect(chip("thinking", { thinkingLevel: "medium" })?.title).toContain(
      "reasoning_effort=medium"
    );
  });

  it("循环次序从 THINKING_LEVELS 现拼，不手抄第二份档位名（改标签不会留下一句说谎的提示）", () => {
    for (const level of ["off", "low", "medium", "high"] as const)
      expect(chip("thinking", { thinkingLevel: level })?.title).toContain(
        "关闭 → 较低 → 标准 → 深度"
      );
  });
});

describe("composer-chips · 联网搜索与工具清单", () => {
  it("联网文案恒定「联网搜索」，开关只体现在 active 与 title 上", () => {
    expect(chip("web-search")?.text).toBe("联网搜索");
    expect(chip("web-search")?.active).toBe(false);
    expect(chip("web-search", { webSearchEnabled: true })?.active).toBe(true);
  });

  it("title 报出两枚出网工具（web_search + web_read）；关的时候说「本轮不带」", () => {
    expect(chip("web-search")?.title).toContain("web_search");
    expect(chip("web-search")?.title).toContain("web_read");
    expect(chip("web-search")?.title).not.toContain("本轮已带");
    expect(chip("web-search", { webSearchEnabled: true })?.title).toContain("本轮已带联网工具");
  });

  it("工具 chip 永远不 disabled，且文案里的枚数跟着联网开关走（关 6 / 开 8）", () => {
    const tools = chip("tools");
    expect(tools?.disabled).toBe(false);
    // #112：下拉三角是 icon/caret 两枚字段渲染出来的，不再混进 text（同一件事两份真身）。
    expect(tools?.text).toBe("工具");
    // 枚数从 toolRoster(开关) 数出来，不是手抄：关掉那一轮两枚出网工具根本不出站。
    // 2026-10-23 加 use_skill 后：关 6 / 开 8。
    expect(tools?.title).toContain("6 枚");
    expect(chip("tools", { webSearchEnabled: true })?.title).toContain("8 枚");
    expect(tools?.active).toBe(false);
  });

  it("入口 chip 永不 disabled——它们只看请求形状与本机配置，不依赖是否开书", () => {
    const chips = composerChips(input({ hasBook: false, mode: null }));
    for (const id of ["thinking", "web-search", "draft", "tools", "model"])
      expect(chips.find((c) => c.id === id)?.disabled).toBe(false);
  });

  it("最裸的一档（没开书 + 没地址 + 没模型名）也不许把模型入口禁成摆设", () => {
    // 变异 M-B 实测：只测「有 baseURL」那一支时，`disabled: baseURL === ""` 这种写法能全绿通过。
    const model = chip("model", { hasBook: false, mode: null, modelLabel: "", baseURL: "" });
    expect(model?.disabled).toBe(false);
    expect(model?.text).toBe("未配置模型");
  });
});

describe("composer-chips · 模型入口（#104）", () => {
  it("有配置 ⇒ 文案就是 ProviderView.model 本身，不缀中文译名也不塞地址", () => {
    const model = chip("model");
    expect(model?.text).toBe("mochen-mock");
    expect(model?.text).not.toContain("http");
    expect(model?.text).not.toContain("•"); // 掩码属于密钥，不属于这枚 chip
  });

  it("没有模型名 ⇒ 老实说「未配置模型」，不冒充任何模型名", () => {
    expect(chip("model", { modelLabel: "" })?.text).toBe("未配置模型");
  });

  it("title 报出通道名 provider:list-models 与被访问的 {baseURL}/models（铁律：报不出通道名不进 UI）", () => {
    const title = chip("model")?.title ?? "";
    expect(title).toContain("provider:list-models");
    expect(title).toContain("http://127.0.0.1:8787/v1/models");
    expect(title).toContain("当前模型 mochen-mock");
  });

  it("改地址/密钥不是这枚 chip 能做的事 ⇒ title 把它指回模型设置", () => {
    expect(chip("model")?.title).toContain("模型设置");
    expect(chip("model", { modelLabel: "", baseURL: "" })?.title).toContain("模型设置");
  });

  it("没配 baseURL 时 title 不谎称能拉到名单，也不拼出「/models」这种半截地址", () => {
    const title = chip("model", { modelLabel: "", baseURL: "" })?.title ?? "";
    expect(title).toContain("还没有 API 地址");
    expect(title).not.toContain("/models");
  });

  it("active 恒假：弹层打开是瞬态，不是按下态（aria-pressed 用它只会撒谎）", () => {
    expect(chip("model")?.active).toBe(false);
    expect(chip("model", { modelLabel: "", baseURL: "" })?.active).toBe(false);
  });
});

/**
 * #112 照参考图（用户提供的三张截图）对齐输入卡：
 * 他那张卡左端是 `＋ / 模型 ▾ / 思考等级 ▾` **三枚独立控件**，#105 我把模型与思考等级
 * 合并成一枚 chip 是自创的，截图证明它不存在 ⇒ 撤销合并（裁定 I）。
 * 地球角标同理：它说的是「这一轮带不带 web_search」，挂在模型名字上等于让模型 chip 冒充联网开关；
 * 而联网自己已经是一枚 chip ⇒ badge 字段整个退役，改由 icon 承载（裁定 I 续）。
 * 图标的合法名不靠这条测试把关：`ComposerChipView.icon` 是 `IconName`，写错的名字在 tsc 就编不过。
 */
describe("composer-chips · #112 撤销合并口径，两枚控件各说各的", () => {
  it("开着思考等级时模型 chip 仍是裸模型名——等级只在它自己那一枚上说一次", () => {
    const model = chip("model", { thinkingLevel: "high" });
    expect(model?.text).toBe("mochen-mock");
    expect(model?.text).not.toContain("深度");
    expect(chip("thinking", { thinkingLevel: "high" })?.text).toBe("深度");
  });

  it("每枚 chip 有自己的图标：模型=立方体、思考=脑、联网=地球、多稿=复制、工具=清单、命令=火花、档位=按档而变", () => {
    expect(chip("model")?.icon).toBe("model");
    expect(chip("thinking")?.icon).toBe("brain");
    expect(chip("web-search")?.icon).toBe("globe");
    expect(chip("draft")?.icon).toBe("copy");
    expect(chip("tools")?.icon).toBe("list");
    expect(chip("palette")?.icon).toBe("sparkles");
    expect(chip("permission")?.icon).toBe("user");
    expect(chip("permission", { mode: "full-access" })?.icon).toBe("check");
    expect(chip("permission", { mode: "chapter-write" })?.icon).toBe("edit");
    expect(chip("permission", { hasBook: false, mode: null })?.icon).toBe("folder");
  });

  it("只有打开弹层的入口带下拉三角：真开关（思考循环 / 联网开关 / 多稿循环 / 工作模式）没有「更多」可展开", () => {
    for (const id of ["model", "tools", "palette", "permission"])
      expect(chip(id)?.caret, `${id} 是入口，该带三角`).toBe(true);
    for (const id of ["thinking", "web-search", "draft", "work-mode"])
      expect(chip(id)?.caret, `${id} 是开关，不该带三角`).toBe(false);
  });

  // 2026-10-05 批次 4：右端从「只有权限」扩到「工作模式 + 权限」——
  // 两者同属「能碰多大」这一族，分在同一端才看得出它们是一件事的两道闸。
  it("分栏：左端全是运行配置，右端是工作模式与权限（发送键由模板自己管）", () => {
    const chips = composerChips(input());
    const left = chips.filter((c) => c.slot === "left").map((c) => c.id);
    const right = chips.filter((c) => c.slot === "right").map((c) => c.id);
    expect(left).toEqual(["model", "thinking", "web-search", "draft", "tools", "palette"]);
    expect(right).toEqual(["work-mode", "permission"]);
  });
});

describe("composer-chips · CHIP_EMIT 与 ComposerChipId 同集", () => {
  it("八枚 chip 各有唯一事件名，漏一键就会发出 undefined 事件长成死按钮", () => {
    // 键集必须与 ComposerChipId 完全一致：这枚「按了没反应的 chip」正是红线。
    expect(Object.keys(CHIP_EMIT).sort()).toEqual([
      "draft",
      "model",
      "palette",
      "permission",
      "thinking",
      "tools",
      "web-search",
      "work-mode"
    ]);
    expect(new Set(Object.values(CHIP_EMIT)).size).toBe(8);
    expect(CHIP_EMIT.permission).toBe("open-permission-menu");
    expect(CHIP_EMIT.palette).toBe("open-palette");
    expect(CHIP_EMIT.thinking).toBe("cycle-thinking");
    expect(CHIP_EMIT["web-search"]).toBe("toggle-web-search");
    expect(CHIP_EMIT.draft).toBe("cycle-draft-sample");
    expect(CHIP_EMIT.tools).toBe("open-tool-roster");
    expect(CHIP_EMIT.model).toBe("open-model-select");
  });

  it("八枚 chip 的 id 都能在 CHIP_EMIT 里取到事件名（穷尽性运行时钉）", () => {
    for (const c of composerChips(input())) expect(CHIP_EMIT[c.id]).toBeTypeOf("string");
  });
});

describe("composer-chips · 多稿档（P0-②）", () => {
  it("三档文案：关 / ×2 / ×3（档与量各说各的话，不把两件事挤成一串）", () => {
    expect(chip("draft", { sampleCount: 1 })?.text).toBe("多稿关");
    expect(chip("draft", { sampleCount: 2 })?.text).toBe("多稿 ×2");
    expect(chip("draft", { sampleCount: 3 })?.text).toBe("多稿 ×3");
  });

  it("active 只在多稿真开着（>1）时为真：关是常态，按下态不许骗人", () => {
    expect(chip("draft", { sampleCount: 1 })?.active).toBe(false);
    expect(chip("draft", { sampleCount: 2 })?.active).toBe(true);
    expect(chip("draft", { sampleCount: 3 })?.active).toBe(true);
  });

  // 报不出出站字段名的控件不进 UI：title 必须报出真的发出去的那个字段名与值。
  it("title 逐字报出 sampleCount 与真实值，并把 N 倍 token 成本说在前面", () => {
    expect(chip("draft", { sampleCount: 1 })?.title).toContain("sampleCount=1");
    expect(chip("draft", { sampleCount: 1 })?.title).toContain("一次生成");
    expect(chip("draft", { sampleCount: 2 })?.title).toContain("sampleCount=2");
    expect(chip("draft", { sampleCount: 2 })?.title).toContain("2 倍");
    expect(chip("draft", { sampleCount: 3 })?.title).toContain("sampleCount=3");
    expect(chip("draft", { sampleCount: 3 })?.title).toContain("3 倍");
  });

  it("循环次序从 DRAFT_SAMPLE_COUNTS 现拼：三档报的是同一句「关 → ×2 → ×3 → 关」", () => {
    for (const count of [1, 2, 3] as const)
      expect(chip("draft", { sampleCount: count })?.title).toContain("关 → ×2 → ×3 → 关");
  });
});

describe("composerCounter · 计数条与守卫共用同一个上限", () => {
  it("空串是 0/20000，数字来自 USER_TEXT_MAX_LEN 而不是手抄", () => {
    expect(composerCounter("")).toEqual({
      text: `0/${USER_TEXT_MAX_LEN}`,
      over: false,
      near: false
    });
  });

  it("按码点计数：一个 emoji 算一个字，两条代理对不许算成两个", () => {
    expect(composerCounter("🌊").text).toBe(`1/${USER_TEXT_MAX_LEN}`);
  });

  it("刚好到上限不算超但已接近（near 归 #105 计数条），超一个字才翻 over", () => {
    expect(composerCounter("字".repeat(USER_TEXT_MAX_LEN))).toEqual({
      text: `${USER_TEXT_MAX_LEN}/${USER_TEXT_MAX_LEN}`,
      over: false,
      near: true
    });
    expect(composerCounter("字".repeat(USER_TEXT_MAX_LEN + 1)).over).toBe(true);
  });
});
