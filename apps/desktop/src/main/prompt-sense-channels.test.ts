import { describe, expect, it } from "vitest";
import { defaultProfile, type DocRef } from "@mochen/contracts";
import { defaultPromptFor } from "./prompt-assembly.js";
import { SENSE_CHANNEL_TERMS, senseChannelSentence } from "./prompt-sense-channels.js";

/**
 * 感官通道读数（2026-10-21，十段）：只注入生成端、不进任何闸。
 * 用例钉的是**计数口径与边界**，不是「嗅觉多少算病」（那要真人语料分位，本仓不编）。
 */
const CHAPTER: DocRef = { relPath: "chapters/01-开局.md", kind: "chapter", title: "开局" };

const build = (context: Parameters<typeof defaultPromptFor>[0]["context"]) =>
  defaultPromptFor({
    title: "雾港",
    stageName: "正文",
    chapter: CHAPTER,
    permissionLabel: "全开",
    workModeLabel: "直接动手",
    profile: defaultProfile(),
    context,
    webSearchEnabled: false
  });

const finished = (text: string, active = false) => ({
  kind: "chapter" as const,
  relPath: "chapters/01.md",
  title: "开局",
  text,
  chars: text.length,
  active
});
const withItems = (...items: ReturnType<typeof finished>[]) => {
  const chars = items.reduce((sum, one) => sum + one.chars, 0);
  return { items, chars, approxTokens: chars };
};

// 手算夹具：12 字 + 换行 + 6 字 = 19 字。
// 视觉命中：看／见／亮／色 = 4 ⇒ 4/19×1000 = 210.5；听觉命中：响／声 = 2 ⇒ 105.3。
const TEXT = ["他看见灯亮着，脸色发白。", "外面有响声。"].join("\n");

describe("感官通道读数（2026-10-21 十段：五通道每千字密度，只摆不判）", () => {
  it("逐通道读数与「命中数 ÷ 字数 × 1000」逐位相等", () => {
    expect(TEXT.length).toBe(19);
    const text = build(withItems(finished(TEXT)));
    expect(text).toContain("本书感官通道读数");
    expect(text).toContain("视觉 210.5");
    expect(text).toContain("听觉 105.3");
  });

  it("五枚恒定全列：零命中也写 0.0，不按大小裁剪、不排序", () => {
    const text = build(withItems(finished("屋里只剩一盏灯。")));
    for (const { channel } of SENSE_CHANNEL_TERMS) {
      expect(text).toContain(`${channel} `);
    }
    expect(text).toContain("嗅觉 0.0");
    expect(text).toContain("体内感 0.0");
    // 通道顺序＝清单顺序（不按读数重排）。
    const order = SENSE_CHANNEL_TERMS.map(({ channel }) => text.indexOf(`${channel} `));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("清单是定义：五通道互不重叠（同一处细节不被两条通道各算一次）", () => {
    expect(SENSE_CHANNEL_TERMS.map(({ channel }) => channel)).toEqual([
      "视觉",
      "听觉",
      "触觉",
      "嗅觉",
      "体内感"
    ]);
    const seen = new Set<string>();
    for (const { channel, chars } of SENSE_CHANNEL_TERMS) {
      expect(chars.length).toBeGreaterThan(0);
      for (const char of chars) {
        expect(seen.has(char), `「${char}」在 ${channel} 重复出现`).toBe(false);
        seen.add(char);
      }
    }
  });

  it("空正文 ⇒ 不注入空段", () => {
    expect(build(withItems(finished("")))).not.toContain("本书感官通道读数");
    expect(senseChannelSentence("")).toBe("");
  });

  it("当前章（半截草稿）与非 chapter 条目都不进分母、不计数", () => {
    expect(build(withItems(finished("他看见灯亮着。", true)))).not.toContain("本书感官通道读数");
    const card = {
      kind: "character" as const,
      relPath: "characters/陈砚.md",
      title: "陈砚",
      text: "他看见灯亮着。",
      chars: 8,
      active: false
    };
    expect(build({ items: [card], chars: 8, approxTokens: 8 })).not.toContain("本书感官通道读数");
  });

  it("分母是同一份已完稿正文（含标点与换行）——多一个字读数就变", () => {
    const longer = build(withItems(finished(`${TEXT}风。`)));
    expect(longer).not.toContain("视觉 210.5");
    // 21 字：4/21×1000 = 190.476… ⇒ 190.5
    expect(longer).toContain("视觉 190.5");
  });
});
