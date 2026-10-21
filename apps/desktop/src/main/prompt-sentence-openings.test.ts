import { describe, expect, it } from "vitest";
import { defaultProfile, type DocRef } from "@mochen/contracts";
import {
  defaultPromptFor,
  SENTENCE_OPENING_CHARS,
  SENTENCE_OPENING_MIN_COUNT,
  SENTENCE_OPENING_TOP,
  sentenceOpeningSentence
} from "./prompt-assembly.js";

/**
 * 句首趋同自查（2026-10-21，九段）：单开一文件而不塞进 `agent-service-prompt.test.ts`——
 * 那份已经 673 行，再挂一个 describe 会先撞 800 行预算（同该文件头注释里「分家」的理由）。
 *
 * 本段只注入生成端、不进任何闸：用例钉的是**计数口径与边界**，不是「多少算病」（那要语料分位）。
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

/** 一条已完稿的章节正文（`active` 默认 false = 已收笔）。 */
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

describe("句首趋同自查（2026-10-21 九段：点名本书用滥的句子开头，只摆不判）", () => {
  it("计数逐位相等、按次数降序：多的一次排前面", () => {
    const text = build(
      withItems(
        finished(
          ["他没回头。", "他没应声。", "她站在门口。", "她站了很久。", "他没动。"].join("\n")
        )
      )
    );
    expect(text).toContain("本书句首提醒");
    expect(text).toContain("「他没」（3 次）");
    expect(text).toContain("「她站」（2 次）");
    // 3 次在前、2 次在后。
    expect(text.indexOf("「他没」")).toBeLessThan(text.indexOf("「她站」"));
  });

  it("只出现一次的不算「用滥」（结构性下限 ≥2），全是单次 ⇒ 整段不注入", () => {
    // 「他走」只出现一次：不算重复。
    const once = build(
      withItems(finished(["他走进屋里。", "她站在门口。", "天亮了。"].join("\n")))
    );
    expect(once).not.toContain("本书句首提醒");
  });

  it("句首剥掉前置标点／引号：`「你先…」` 记成「你先」，不数出带引号的串", () => {
    const text = build(
      withItems(finished(["「你先回去。」", "「你先别急。」", "他没回头。"].join("\n")))
    );
    expect(text).toContain(`「你先」（2 次）`);
    expect(text).not.toContain("「「你」");
  });

  it("超过展示额度只列前 5 种（不是把每种都倒出来）", () => {
    const kinds = ["丙丙", "丁丁", "庚庚", "己己", "甲甲", "戊戊", "乙乙"];
    const sentences: string[] = [];
    for (const kind of kinds) {
      sentences.push(`${kind}一来。`, `${kind}二去。`);
    }
    const text = build(withItems(finished(sentences.join("\n"))));
    expect((text.match(new RegExp(`（${SENTENCE_OPENING_MIN_COUNT} 次）`, "g")) ?? []).length).toBe(
      SENTENCE_OPENING_TOP
    );
    expect(SENTENCE_OPENING_TOP).toBeLessThan(kinds.length);
  });

  it("当前章（半截草稿）与非 chapter 条目都不进统计", () => {
    const repeated = ["他没回头。", "他没应声。"].join("\n");
    expect(build(withItems(finished(repeated, true)))).not.toContain("本书句首提醒");
    const card = {
      kind: "character" as const,
      relPath: "characters/陈砚.md",
      title: "陈砚",
      text: repeated,
      chars: repeated.length,
      active: false
    };
    expect(
      build({ items: [card], chars: repeated.length, approxTokens: repeated.length })
    ).not.toContain("本书句首提醒");
  });

  it("「句首」刻度是 2 个实字：函数直接调用时读数对得上", () => {
    expect(SENTENCE_OPENING_CHARS).toBe(2);
    const text = sentenceOpeningSentence(
      withItems(finished(["「你先回去。」", "「你先别急。」"].join("\n")))
    );
    expect(text).toContain("「你先」（2 次）");
  });
});
