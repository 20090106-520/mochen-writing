import { describe, expect, it } from "vitest";
import { defaultProfile, type DocRef } from "@mochen/contracts";
import { defaultPromptFor } from "./prompt-assembly.js";
import { dialogueRepeatSentence } from "./prompt-dialogue-repeat.js";

/**
 * 对白复读（2026-11-16）：把书里已经反复出现的台词原话摆给这一轮。
 * 用例钉注入条件与措辞；计数口径在 contracts 的单测里钉。
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

describe("对白复读（2026-11-16）", () => {
  it("有复读 ⇒ 点名原话与次数，并区分有意/无意两种处理", () => {
    const text = ["「知道了。」他点头。", "「知道了。」她没抬头。"].join("\n");
    const prompt = build(text);
    expect(prompt).toContain("本书对白复读");
    expect(prompt).toContain("「知道了。」（2 次）");
    expect(prompt).toContain("有意的口头禅或回声");
    expect(prompt).toContain("换一种说法");
  });

  it("没有复读 ⇒ 不注入空段", () => {
    const text = ["「知道了。」他点头。", "「随你。」她没抬头。"].join("\n");
    expect(build(text)).not.toContain("本书对白复读");
    expect(dialogueRepeatSentence(text)).toBe("");
  });
});
