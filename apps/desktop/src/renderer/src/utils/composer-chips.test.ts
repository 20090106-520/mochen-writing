import { describe, expect, it } from "vitest";
import { USER_TEXT_MAX_LEN, WORK_MODE_LABELS } from "@mochen/contracts";
import { NO_BOOK_CHIP_LABEL, permissionChipView } from "./permission-chip";
import {
  CHIP_EMIT,
  composerChips,
  composerCounter,
  WORK_MODE_NO_BOOK_LABEL
} from "./composer-chips";

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

const CHIP_ORDER = [
  "model",
  "web-search",
  "draft",
  "tools",
  "palette",
  "auto-skills",
  "work-mode",
  "permission"
];

describe("composer-chips · 入口与分区", () => {
  it("模型与推理合并为一枚入口，其余控件顺序保持稳定", () => {
    expect(composerChips(input()).map((c) => c.id)).toEqual(CHIP_ORDER);
    expect(chip("thinking")).toBeUndefined();
  });

  it("工作模式读共享标签并有真实开关态", () => {
    expect(chip("work-mode", { workMode: "plan" })?.text).toBe(WORK_MODE_LABELS.plan);
    expect(chip("work-mode", { workMode: "act" })?.text).toBe(WORK_MODE_LABELS.act);
    expect(chip("work-mode", { workMode: "plan" })?.active).toBe(true);
    expect(chip("work-mode")?.slot).toBe("more");
    expect(chip("work-mode")?.caret).toBe(true);
    expect(CHIP_EMIT["work-mode"]).toBe("toggle-work-mode");
  });

  it("无书时工作模式禁用，且不借用权限档文案", () => {
    const current = chip("work-mode", { hasBook: false, mode: null });
    expect(current?.disabled).toBe(true);
    expect(current?.active).toBe(false);
    expect(current?.text).toBe(WORK_MODE_NO_BOOK_LABEL);
    expect(current?.text).not.toBe(NO_BOOK_CHIP_LABEL);
    expect(current?.title).toContain("作品目录");
  });

  it("权限 chip 与 permissionChipView 同源", () => {
    for (const item of [
      input({ mode: "chapter-write" }),
      input({ mode: "full-access", saving: true }),
      input({ hasBook: false, mode: null })
    ]) {
      const view = permissionChipView(item);
      expect(composerChips(item).find((c) => c.id === "permission")).toMatchObject({
        id: "permission",
        text: view.text,
        disabled: view.disabled,
        title: view.title,
        icon: view.icon
      });
    }
  });

  it("每枚 chip 保持相同视图字段", () => {
    for (const current of composerChips(input())) {
      expect(Object.keys(current).sort()).toEqual([
        "active",
        "caret",
        "disabled",
        "icon",
        "id",
        "slot",
        "text",
        "title"
      ]);
    }
  });

  it("分区为左端联网与技能、右端模型与权限，其余进入更多", () => {
    const chips = composerChips(input());
    expect(chips.filter((c) => c.slot === "left").map((c) => c.id)).toEqual([
      "web-search",
      "auto-skills"
    ]);
    expect(chips.filter((c) => c.slot === "right").map((c) => c.id)).toEqual([
      "model",
      "permission"
    ]);
    expect(chips.filter((c) => c.slot === "more").map((c) => c.id)).toEqual([
      "draft",
      "tools",
      "palette",
      "work-mode"
    ]);
  });
});

describe("composer-chips · 模型与推理强度", () => {
  it("模型 chip 同步显示紧凑档位名", () => {
    expect(chip("model")?.text).toBe("mochen-mock 关闭");
    expect(chip("model", { thinkingLevel: "low" })?.text).toBe("mochen-mock 低");
    expect(chip("model", { thinkingLevel: "medium" })?.text).toBe("mochen-mock 中");
    expect(chip("model", { thinkingLevel: "high" })?.text).toBe("mochen-mock 高");
  });

  it("模型名缺省时只显示未配置模型", () => {
    expect(chip("model", { modelLabel: "" })?.text).toBe("未配置模型");
  });

  it("不支持推理字段的模型仍保留设置入口，但明确显示不适用", () => {
    const current = chip("model", {
      modelLabel: "gpt-4o",
      thinkingCapability: { contextWindow: 128000, thinkingLevels: [] }
    });
    expect(current?.text).toBe("gpt-4o 不适用");
    expect(current?.disabled).toBe(false);
    expect(current?.title).toContain("不认 reasoning_effort");
  });

  it("提示报出真实线格式，而不是把档位名直接拼进出站字段", () => {
    const current = chip("model", {
      thinkingLevel: "xhigh",
      thinkingCapability: {
        contextWindow: 1_000_000,
        thinkingLevels: ["low", "medium", "high", "xhigh", "max"]
      }
    });
    expect(current?.title).toContain("reasoning_effort=xhigh");
    expect(chip("model")?.title).toContain("不发 reasoning_effort 字段");
    expect(chip("model", { thinkingLevel: "medium" })?.title).toContain("reasoning_effort=medium");
  });

  it("title 报出真实名单通道与地址", () => {
    const title = chip("model")?.title ?? "";
    expect(title).toContain("provider:list-models");
    expect(title).toContain("http://127.0.0.1:8787/v1/models");
    expect(title).toContain("当前模型 mochen-mock");
    expect(title).toContain("模型设置");
  });

  it("无地址时不谎称能拉名单，也不拼半截地址", () => {
    const current = chip("model", { modelLabel: "", baseURL: "" });
    expect(current?.disabled).toBe(false);
    expect(current?.title).toContain("还没有 API 地址");
    expect(current?.title).not.toContain("/models");
  });

  it("模型是入口而非开关，active 恒假且带下拉三角", () => {
    expect(chip("model")?.active).toBe(false);
    expect(chip("model")?.caret).toBe(true);
    expect(chip("model")?.icon).toBe("model");
  });
});

describe("composer-chips · 联网搜索与工具", () => {
  it("联网文案固定，开关只体现在 active 与 title", () => {
    expect(chip("web-search")?.text).toBe("联网搜索");
    expect(chip("web-search")?.active).toBe(false);
    expect(chip("web-search", { webSearchEnabled: true })?.active).toBe(true);
    expect(chip("web-search")?.title).toContain("web_search");
    expect(chip("web-search")?.title).toContain("web_read");
    expect(chip("web-search")?.caret).toBe(false);
  });

  it("工具枚数随联网开关联动", () => {
    expect(chip("tools")?.title).toContain("7 枚");
    expect(chip("tools", { webSearchEnabled: true })?.title).toContain("9 枚");
    expect(chip("tools")?.disabled).toBe(false);
  });

  it("palette 不宣传不存在的 Ctrl+K", () => {
    expect(chip("palette")?.title).not.toContain("Ctrl");
  });

  it("入口型 chip 不依赖是否开书", () => {
    const chips = composerChips(input({ hasBook: false, mode: null }));
    for (const id of ["web-search", "draft", "tools", "model"]) {
      expect(chips.find((c) => c.id === id)?.disabled).toBe(false);
    }
  });
});

describe("composer-chips · CHIP_EMIT 与组件 id 同集", () => {
  it("八枚 chip 各有唯一事件", () => {
    expect(Object.keys(CHIP_EMIT).sort()).toEqual([...CHIP_ORDER].sort());
    expect(new Set(Object.values(CHIP_EMIT)).size).toBe(8);
    expect(CHIP_EMIT.model).toBe("open-model-select");
    expect(CHIP_EMIT.palette).toBe("open-palette");
    expect(CHIP_EMIT["auto-skills"]).toBe("open-auto-skills");
    for (const current of composerChips(input())) {
      expect(CHIP_EMIT[current.id]).toBeTypeOf("string");
    }
  });
});

describe("composer-chips · 多稿", () => {
  it("三档文案与开关态正确", () => {
    expect(chip("draft", { sampleCount: 1 })?.text).toBe("多稿关");
    expect(chip("draft", { sampleCount: 2 })?.text).toBe("多稿 ×2");
    expect(chip("draft", { sampleCount: 3 })?.text).toBe("多稿 ×3");
    expect(chip("draft", { sampleCount: 1 })?.active).toBe(false);
    expect(chip("draft", { sampleCount: 2 })?.active).toBe(true);
  });

  it("提示报出真实 sampleCount 与 token 成本", () => {
    expect(chip("draft", { sampleCount: 1 })?.title).toContain("sampleCount=1");
    expect(chip("draft", { sampleCount: 2 })?.title).toContain("sampleCount=2");
    expect(chip("draft", { sampleCount: 3 })?.title).toContain("3 倍");
    expect(chip("draft")?.title).toContain("关 → ×2 → ×3 → 关");
  });
});

describe("composerCounter", () => {
  it("空串与码点计数正确", () => {
    expect(composerCounter("")).toEqual({
      text: `0/${USER_TEXT_MAX_LEN}`,
      over: false,
      near: false
    });
    expect(composerCounter("🌊").text).toBe(`1/${USER_TEXT_MAX_LEN}`);
  });

  it("到上限只提示接近，超过才判超限", () => {
    expect(composerCounter("字".repeat(USER_TEXT_MAX_LEN))).toEqual({
      text: `${USER_TEXT_MAX_LEN}/${USER_TEXT_MAX_LEN}`,
      over: false,
      near: true
    });
    expect(composerCounter("字".repeat(USER_TEXT_MAX_LEN + 1)).over).toBe(true);
  });
});
