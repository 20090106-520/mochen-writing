import { describe, expect, it } from "vitest";
import { defaultProfile, type DocRef } from "@mochen/contracts";
import { defaultPromptFor } from "./prompt-assembly.js";
import { dialogueParagraphSentence } from "./prompt-dialogue-paragraph.js";

/**
 * 对白段落形态（2026-11-16）：台词单独成段还是和动作长在同一段里。
 * 用例钉三档措辞与注入门槛；比例本身在 contracts 的单测里钉。
 */
const CHAPTER: DocRef = { relPath: "chapters/01-开局.md", kind: "chapter", title: "开局" };

const build = (text: string) =>
  defaultPromptFor({
    title: "雾港",
    stageName: "正文",
    chapter: CHAPTER,
    permissionLabel: "全开",
    workModeLabel: "直接动手",
    profile: defaultProfile(),
    context: {
      items: [
        {
          kind: "chapter" as const,
          relPath: "chapters/01-开局.md",
          title: "开局",
          text,
          chars: text.length,
          active: false
        }
      ],
      chars: text.length,
      approxTokens: text.length
    },
    webSearchEnabled: false
  });

const repeat = (line: string, times: number): string =>
  Array.from({ length: times }, () => line).join("\n");

describe("对白段落形态（2026-11-16）", () => {
  it("没有一段只有台词 ⇒ 叮嘱台词和动作长在同一段里", () => {
    const text = repeat("「走吧。」他把门推开。", 10);
    expect(build(text)).toContain("本书对白段落形态");
    expect(build(text)).toContain("这本书没有一段只有台词");
  });

  it("台词基本单独成段 ⇒ 叮嘱另起一段放动作，别硬塞节拍", () => {
    const text = repeat("「走吧。」", 10);
    expect(build(text)).toContain("这本书的台词基本单独成段");
  });

  it("两档都有 ⇒ 报出比例，叮嘱照比例分行", () => {
    const text = [
      ...Array.from({ length: 5 }, () => "「走吧。」"),
      ...Array.from({ length: 5 }, () => "「走吧。」他说。")
    ].join("\n");
    const sentence = dialogueParagraphSentence(text);
    expect(sentence).toContain("含对白的段落 10 段");
    expect(sentence).toContain("纯对白段（引号外只有标点）5 段（约 50%）");
    expect(sentence).toContain("台词与动作／神态同段 5 段");
    expect(sentence).toContain("照这个比例分行");
  });

  it("样本不足 ⇒ 不注入空段", () => {
    expect(build(repeat("「走吧。」", 5))).not.toContain("本书对白段落形态");
    expect(dialogueParagraphSentence(repeat("「走吧。」", 5))).toBe("");
  });
});
