import { describe, expect, it } from "vitest";
import {
  capabilityOf,
  defaultThinkingLevelOf,
  effectiveContextWindowOf,
  MODEL_CAPABILITIES,
  nextThinkingLevel,
  normalizeModelKey,
  STANDARD_THINKING_LEVELS,
  THINKING_LEVEL_LABELS,
  THINKING_LEVELS,
  thinkingLevelsOf,
  thinkingWireValueOf,
  type ThinkingLevel
} from "../src/index.js";

/**
 * 模型能力表（2026-11-21）的契约根。
 *
 * 这一族测的是**事实**：「哪个模型有多少窗口、认哪几档思考深度」。
 * 每条断言都能反过来证红——把能力表里那一格改错（窗口写成 24k、档位集合写多一档、
 * 把「不认这一档控制」写成认），下面对应的用例就会红。
 *
 * **表里的数字都有出处**：MiniMax 官方文档
 * `https://platform.minimax.cn/docs/api-reference/text-chat-openai`（2026-11-21 读）。
 * 表里没有的模型一律走通用口径——那是「按最常见的那套办」，不是对这个模型的断言。
 */
describe("MODEL_CAPABILITIES · 能力表本身", () => {
  it("MiniMax-M3.1-Flash：1M 窗口 + 五档（low/medium/high/xhigh/max），**没有关闭档**", () => {
    const cap = capabilityOf("MiniMax-M3.1-Flash");
    expect(cap?.contextWindow).toBe(1_000_000);
    // 官方文档：可取 low/medium/high/xhigh/max；且深度思考强制开启，传 none 会 HTTP 400。
    expect(cap?.thinkingLevels).toEqual(["low", "medium", "high", "xhigh", "max"]);
    // 「没有关闭档」是这条断言的正脸：多写一个 off 就会红。
    expect(cap?.thinkingLevels).not.toContain("off");
    // 省略时默认 max（官方口径）。
    expect(defaultThinkingLevelOf("MiniMax-M3.1-Flash")).toBe("max");
  });

  it("MiniMax-M3：1M 窗口，但官方写明它**忽略 reasoning_effort** ⇒ 档位集合是空的", () => {
    const cap = capabilityOf("MiniMax-M3");
    expect(cap?.contextWindow).toBe(1_000_000);
    // 官方文档原话：「仅 MiniMax-M3.1-Flash 支持真正的思考深度调节，其他模型会忽略该字段。」
    // 空数组不是「没填」，是「这个模型不认这一档控制」——界面据此不摆那个控件。
    expect(cap?.thinkingLevels).toEqual([]);
    expect(thinkingLevelsOf("MiniMax-M3")).toEqual([]);
  });

  it("模型名归一化：`minimax-m3` / `MINIMAX_M3` / `MiniMax-M3` 认得同一份能力", () => {
    expect(normalizeModelKey("MiniMax-M3.1-Flash")).toBe("minimaxm31flash");
    expect(normalizeModelKey("minimax-m3")).toBe("minimaxm3");
    // 同一家在不同网关上的写法不统一；认不出来就会「明明是这个模型，界面却说什么都不知道」。
    expect(capabilityOf("minimax-m3")).toBe(capabilityOf("MINIMAX_M3"));
    expect(capabilityOf("minimax-m3")).toBe(capabilityOf("MiniMax-M3"));
  });

  it("表里没有的模型就是没有：查不到返回 null，档位回落通用四档", () => {
    expect(capabilityOf("some-model-nobody-knows")).toBeNull();
    expect(thinkingLevelsOf("some-model-nobody-knows")).toEqual([...STANDARD_THINKING_LEVELS]);
    expect(defaultThinkingLevelOf("some-model-nobody-knows")).toBe("off");
  });

  it("能力表的键都是归一化后的模型名（表里不该出现没归一化的键）", () => {
    for (const key of Object.keys(MODEL_CAPABILITIES)) expect(normalizeModelKey(key)).toBe(key);
  });

  /**
   * 2026-11-21 随预置清单换新而补的几格（出处都写在能力表那一份的注释里）：
   * 百炼当前主推三档（1M，思考走 `enable_thinking` ⇒ 不认 `reasoning_effort`），
   * Kimi K3.1 Pro / K3（1M，顶层 `reasoning_effort` 取 low/high/max，默认 max）。
   */
  it("百炼当前主推三档：1M 窗口，思考走 enable_thinking ⇒ 不认 reasoning_effort", () => {
    for (const model of ["qwen4-max", "qwen3.7-plus", "qwen3.8-flash"]) {
      expect(capabilityOf(model)?.contextWindow, model).toBe(1_048_576);
      expect(capabilityOf(model)?.thinkingLevels, model).toEqual([]);
    }
  });

  it("Kimi K3.1 Pro / K3：1M 窗口 + 顶层 reasoning_effort（low/high/max，默认 max）", () => {
    for (const model of ["kimi-k3.1-pro", "kimi-k3"]) {
      expect(capabilityOf(model)?.contextWindow, model).toBe(1_000_000);
      expect(capabilityOf(model)?.thinkingLevels, model).toEqual(["low", "high", "max"]);
      expect(defaultThinkingLevelOf(model), model).toBe("max");
    }
  });
});

describe("档位枚举 · 六档与标签", () => {
  it("六档按 off/low/medium/high/xhigh/max 的顺序逐字钉死", () => {
    expect([...THINKING_LEVELS]).toEqual(["off", "low", "medium", "high", "xhigh", "max"]);
  });

  it("每一档都有中文标签，且键集与枚举完全一致", () => {
    expect(Object.keys(THINKING_LEVEL_LABELS).sort()).toEqual([...THINKING_LEVELS].sort());
    for (const level of THINKING_LEVELS) expect(THINKING_LEVEL_LABELS[level]).not.toBe("");
    // 后两档是 MiniMax 官方文档新增的那两档，词按同一族口径往下排。
    expect(THINKING_LEVEL_LABELS.xhigh).toBe("超深");
    expect(THINKING_LEVEL_LABELS.max).toBe("极限");
  });
});

describe("nextThinkingLevel · 在给定的档位集合里转", () => {
  it("通用四档：off → low → medium → high → off（与旧行为一字不差）", () => {
    expect(nextThinkingLevel("off")).toBe("low");
    expect(nextThinkingLevel("low")).toBe("medium");
    expect(nextThinkingLevel("medium")).toBe("high");
    expect(nextThinkingLevel("high")).toBe("off");
  });

  it("能力表给出的集合里转：走不出这个集合（走出去就是往上游发它不认的值）", () => {
    const levels = thinkingLevelsOf("MiniMax-M3.1-Flash");
    expect(nextThinkingLevel("low", levels)).toBe("medium");
    expect(nextThinkingLevel("xhigh", levels)).toBe("max");
    // 最后一档回到第一档：这一族没有 off，所以回到 low 而不是 off。
    expect(nextThinkingLevel("max", levels)).toBe("low");
  });

  it("当前档不在这一族里（换模型后残留的旧档）⇒ 从第一档重新开始", () => {
    const levels = thinkingLevelsOf("MiniMax-M3.1-Flash");
    expect(nextThinkingLevel("off", levels)).toBe("low");
  });

  it("空集合（这个模型不认这一档控制）⇒ 不动", () => {
    const levels = thinkingLevelsOf("MiniMax-M3");
    expect(nextThinkingLevel("off", levels)).toBe("off");
    expect(nextThinkingLevel("high", levels)).toBe("high");
  });
});

describe("thinkingWireValueOf · 出站那个字", () => {
  it("能力表不认识这个模型 ⇒ 连接级口径（最高档叫 high 还是 xhigh 由端点决定）", () => {
    expect(thinkingWireValueOf("high", "standard")).toBe("high");
    expect(thinkingWireValueOf("high", "xhigh")).toBe("xhigh");
    expect(thinkingWireValueOf("medium", "xhigh")).toBe("medium");
  });

  it("能力表认识这个模型 ⇒ 表里列的档位名就是线上那个字", () => {
    const cap = capabilityOf("MiniMax-M3.1-Flash");
    expect(thinkingWireValueOf("xhigh", "standard", cap)).toBe("xhigh");
    expect(thinkingWireValueOf("max", "standard", cap)).toBe("max");
    expect(thinkingWireValueOf("high", "standard", cap)).toBe("high");
  });

  it('off 两边都返回空串：关档靠的是不发字段，不是发 "off"', () => {
    expect(thinkingWireValueOf("off", "standard")).toBe("");
    expect(thinkingWireValueOf("off", "xhigh", capabilityOf("MiniMax-M3.1-Flash"))).toBe("");
  });

  it("表里最高档叫 high 而端点是 xhigh 口径时，仍按连接发 xhigh（表没改名就尊重端点）", () => {
    const cap: { thinkingLevels: readonly ThinkingLevel[] } = {
      thinkingLevels: ["off", "low", "medium", "high"]
    };
    expect(thinkingWireValueOf("high", "xhigh", cap)).toBe("xhigh");
    expect(thinkingWireValueOf("high", "standard", cap)).toBe("high");
  });
});

describe("effectiveContextWindowOf · 这个模型按哪个窗口算预算", () => {
  it("谁更具体谁赢：档案填过 ⇒ 能力表 ⇒ 连接级", () => {
    expect(
      effectiveContextWindowOf({
        model: "MiniMax-M3.1-Flash",
        profileContextWindow: 32768,
        connectionContextWindow: 65536
      })
    ).toBe(32768);
    // 档案没填 ⇒ 能力表那份（1M）赢过连接级那份。
    expect(
      effectiveContextWindowOf({
        model: "MiniMax-M3.1-Flash",
        connectionContextWindow: 65536
      })
    ).toBe(1_000_000);
    // 两个都没有 ⇒ 连接级那份。
    expect(
      effectiveContextWindowOf({ model: "谁也不知道的模型", connectionContextWindow: 65536 })
    ).toBe(65536);
  });

  it("都没有时返回 undefined：调用方自己回退默认值，界面要能看出「这是默认值」", () => {
    expect(effectiveContextWindowOf({ model: "谁也不知道的模型" })).toBeUndefined();
  });
});
