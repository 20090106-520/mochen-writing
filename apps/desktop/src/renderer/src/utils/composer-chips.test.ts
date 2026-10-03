import { describe, expect, it } from "vitest";
import { permissionChipView } from "./permission-chip";
import { composerChips, composerCounter, CHIP_EMIT } from "./composer-chips";
import { USER_TEXT_MAX_LEN } from "@mochen/contracts";

/** chip 行的入参默认值：只关心某一枚时，其余按「什么都没开」传。 */
function input(over: Partial<Parameters<typeof composerChips>[0]> = {}) {
  return {
    hasBook: true,
    mode: "read-only" as const,
    saving: false,
    thinkingLevel: "off" as const,
    webSearchEnabled: false,
    ...over
  };
}

function chip(id: string, over: Partial<Parameters<typeof composerChips>[0]> = {}) {
  return composerChips(input(over)).find((item) => item.id === id);
}

describe("composer-chips · 五枚真开关，排队不做按钮（F-D + #101）", () => {
  it("id 顺序逐字钉死：permission/thinking/web-search/tools/palette（第三枚排队按钮不许长出来）", () => {
    expect(composerChips(input()).map((c) => c.id)).toEqual([
      "permission",
      "thinking",
      "web-search",
      "tools",
      "palette"
    ]);
  });

  it("T9-1 反向钉：palette chip 的 title 不得再宣传不存在的 Ctrl+K 键位", () => {
    // 实测 hotkeys.ts 的全局 Ctrl 族没有 k，面板真身是裸 / 键。
    expect(chip("palette")?.title).not.toContain("Ctrl");
  });

  it("联动用例：permission chip 与 permissionChipView 的四个显示字段逐字段同值（防两份判定漂移）", () => {
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
        title: view.title
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

  it("每枚 chip 的键集固定为五字段（active 是aria-pressed 的真值来源，不许漏也不许多）", () => {
    for (const c of composerChips(input()))
      expect(Object.keys(c).sort()).toEqual(["active", "disabled", "id", "text", "title"]);
  });
});

describe("composer-chips · 深度思考", () => {
  it("关档文案不带档位名，开档才缀上中文档（标签只读 THINKING_LEVEL_LABELS）", () => {
    expect(chip("thinking", { thinkingLevel: "off" })?.text).toBe("深度思考");
    expect(chip("thinking", { thinkingLevel: "low" })?.text).toBe("深度思考 · 低");
    expect(chip("thinking", { thinkingLevel: "medium" })?.text).toBe("深度思考 · 中");
    expect(chip("thinking", { thinkingLevel: "high" })?.text).toBe("深度思考 · 高");
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
});

describe("composer-chips · 联网搜索与工具清单", () => {
  it("联网文案恒定「联网搜索」，开关只体现在 active 与 title 上", () => {
    expect(chip("web-search")?.text).toBe("联网搜索");
    expect(chip("web-search")?.active).toBe(false);
    expect(chip("web-search", { webSearchEnabled: true })?.active).toBe(true);
  });

  it("title 报出挂在 tools 里的那一枚 web_search；关的时候说「本轮不带」", () => {
    expect(chip("web-search")?.title).toContain("web_search");
    expect(chip("web-search")?.title).not.toContain("本轮已带");
    expect(chip("web-search", { webSearchEnabled: true })?.title).toContain("本轮已带 web_search");
  });

  it("工具 chip 永远不 disabled，且文案里的数量就是从 contracts 数出来的那五枚", () => {
    const tools = chip("tools");
    expect(tools?.disabled).toBe(false);
    expect(tools?.text).toBe("工具 ▾");
    expect(tools?.title).toContain("5 枚");
    expect(tools?.active).toBe(false);
  });

  it("三枚新 chip 都不 disabled——它们是请求形状开关，不依赖是否开书", () => {
    const chips = composerChips(input({ hasBook: false, mode: null }));
    for (const id of ["thinking", "web-search", "tools"])
      expect(chips.find((c) => c.id === id)?.disabled).toBe(false);
  });
});

describe("composer-chips · CHIP_EMIT 与 ComposerChipId 同集", () => {
  it("五枚 chip 各有唯一事件名，漏一键就会发出 undefined 事件长成死按钮", () => {
    // 键集必须与 ComposerChipId 完全一致：这枚「按了没反应的 chip」正是红线。
    expect(Object.keys(CHIP_EMIT).sort()).toEqual([
      "palette",
      "permission",
      "thinking",
      "tools",
      "web-search"
    ]);
    expect(new Set(Object.values(CHIP_EMIT)).size).toBe(5);
    expect(CHIP_EMIT.permission).toBe("open-permission-menu");
    expect(CHIP_EMIT.palette).toBe("open-palette");
    expect(CHIP_EMIT.thinking).toBe("cycle-thinking");
    expect(CHIP_EMIT["web-search"]).toBe("toggle-web-search");
    expect(CHIP_EMIT.tools).toBe("open-tool-roster");
  });

  it("五枚 chip 的 id 都能在 CHIP_EMIT 里取到事件名（穷尽性运行时钉）", () => {
    for (const c of composerChips(input())) expect(CHIP_EMIT[c.id]).toBeTypeOf("string");
  });
});

describe("composerCounter · 计数条与守卫共用同一个上限", () => {
  it("空串是 0/20000，数字来自 USER_TEXT_MAX_LEN 而不是手抄", () => {
    expect(composerCounter("")).toEqual({ text: `0/${USER_TEXT_MAX_LEN}`, over: false });
  });

  it("按码点计数：一个 emoji 算一个字，两条代理对不许算成两个", () => {
    expect(composerCounter("🌊").text).toBe(`1/${USER_TEXT_MAX_LEN}`);
  });

  it("刚好到上限不算超，超一个字就翻红（over 的边界由计数条与守卫共同承认）", () => {
    expect(composerCounter("字".repeat(USER_TEXT_MAX_LEN))).toEqual({
      text: `${USER_TEXT_MAX_LEN}/${USER_TEXT_MAX_LEN}`,
      over: false
    });
    expect(composerCounter("字".repeat(USER_TEXT_MAX_LEN + 1)).over).toBe(true);
  });
});
