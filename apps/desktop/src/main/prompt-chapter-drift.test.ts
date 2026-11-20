import { describe, expect, it } from "vitest";
import { defaultProfile, type DocRef } from "@mochen/contracts";
import { chapterDriftSentence } from "./prompt-chapter-drift.js";
import { defaultPromptFor } from "./prompt-assembly.js";

/**
 * 本章腔调偏离（2026-11-17）：拿这一章已写的部分与已完稿正文的常态比一次。
 *
 * 用例只钉**注入边界与读数方向**，不钉「多少算病」——判线是 `styleDriftOf` 早已校准的，
 * 本段不新编一个数。
 */

/** 50 句 × 11 字 = 550 字：句长均值 11、波动 0、没有对白与标点脾气。 */
const BASELINE = "他推开门，屋里没有人。".repeat(50);

/** 12 句 × 50 字 = 600 字：句子被拉长到常态的 4 倍多。 */
const LONG_DRAFT =
  "他在傍晚的时候推开那扇已经旧了的木门，屋子里一个人也没有，风从窗缝里挤进来，吹得桌上的纸页翻了一下。".repeat(
    12
  );

describe("chapterDriftSentence", () => {
  it("这一章比本书常态长得多 ⇒ 报出偏离项与具体改法", () => {
    const text = chapterDriftSentence(BASELINE, LONG_DRAFT);
    expect(text).toContain("本章腔调偏离");
    expect(text).toContain("句长均值");
    expect(text).toContain("本书常态");
    expect(text).toContain("句子被你拉长了");
    expect(text).toContain("例外");
  });

  it("与常态一致 ⇒ 返回空串，不注入空段", () => {
    expect(chapterDriftSentence(BASELINE, BASELINE)).toBe("");
  });

  it("这一章不足 300 字 ⇒ 短样本量不准，不说", () => {
    expect(chapterDriftSentence(BASELINE, "他推开门。")).toBe("");
  });

  it("本书常态不足 500 字 ⇒ 没有可比基线，不说", () => {
    expect(chapterDriftSentence("他推开门。", LONG_DRAFT)).toBe("");
  });
});

const CHAPTER: DocRef = { relPath: "chapters/01-开局.md", kind: "chapter", title: "开局" };

describe("defaultPromptFor 接线", () => {
  it("有当前章时把偏离段接在提示词里", () => {
    const finished = {
      kind: "chapter" as const,
      relPath: "chapters/00.md",
      title: "前章",
      text: BASELINE,
      chars: BASELINE.length,
      active: false
    };
    const active = {
      kind: "chapter" as const,
      relPath: CHAPTER.relPath,
      title: CHAPTER.title,
      text: LONG_DRAFT,
      chars: LONG_DRAFT.length,
      active: true
    };
    const text = defaultPromptFor({
      title: "雾港",
      stageName: "正文",
      chapter: CHAPTER,
      permissionLabel: "全开",
      workModeLabel: "直接动手",
      profile: defaultProfile(),
      context: {
        items: [finished, active],
        chars: finished.chars + active.chars,
        approxTokens: finished.chars + active.chars
      },
      webSearchEnabled: false
    });
    expect(text).toContain("本章腔调偏离");
  });
});
