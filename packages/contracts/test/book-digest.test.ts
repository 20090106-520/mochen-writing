import { describe, expect, it } from "vitest";
import {
  BOOK_DIGEST_CAST_MAX_CHARS,
  BOOK_DIGEST_SUMMARY_MAX_CHARS,
  bookMetaSchema,
  parseBookDigest
} from "../src/index.js";

/**
 * 全书滚动状态（2026-11-20）。
 *
 * 解析是唯一判据：生成端只拿文本调它，注入端只读结果。这里钉三件事——
 * 两段都能取到、缺摘要就整份作废、超长按码点截断（不把代理对切成半个字）。
 */
describe("parseBookDigest", () => {
  it("按两个小标题取摘要与人物，前后多余的客套不影响", () => {
    const digest = parseBookDigest(
      "好的，下面是更新后的状态：\n" +
        "【全书摘要】林夜带着断桨驶入雾港，被守闸人扣下。\n" +
        "【人物状态】\n- 林夜：左臂骨折，急着找船。\n- 守闸人：收了钱，起了疑。"
    );
    expect(digest).toEqual({
      summary: "林夜带着断桨驶入雾港，被守闸人扣下。",
      cast: "- 林夜：左臂骨折，急着找船。\n- 守闸人：收了钱，起了疑。"
    });
  });

  it("没有摘要标题 ⇒ null（不把前言当摘要）", () => {
    expect(parseBookDigest("【人物状态】\n- 林夜：在雾港。")).toBeNull();
  });

  it("摘要是空的 ⇒ null（空壳不如不注入）", () => {
    expect(parseBookDigest("【全书摘要】\n【人物状态】\n- 林夜：在雾港。")).toBeNull();
  });

  it("人物段允许为空：第一章还没人物也合法", () => {
    expect(parseBookDigest("【全书摘要】林夜登船。")).toEqual({ summary: "林夜登船。", cast: "" });
  });

  it("两段都按上限截断", () => {
    const digest = parseBookDigest(
      `【全书摘要】${"摘".repeat(BOOK_DIGEST_SUMMARY_MAX_CHARS + 20)}` +
        `【人物状态】${"人".repeat(BOOK_DIGEST_CAST_MAX_CHARS + 20)}`
    );
    expect(digest?.summary).toHaveLength(BOOK_DIGEST_SUMMARY_MAX_CHARS);
    expect(digest?.cast).toHaveLength(BOOK_DIGEST_CAST_MAX_CHARS);
  });

  it("按码点截断，不切坏代理对", () => {
    const emoji = "😀";
    const digest = parseBookDigest(
      `【全书摘要】${emoji.repeat(BOOK_DIGEST_SUMMARY_MAX_CHARS + 5)}`
    );
    const chars = Array.from(digest?.summary ?? "");
    expect(chars).toHaveLength(BOOK_DIGEST_SUMMARY_MAX_CHARS);
    expect(chars.every((one) => one === emoji)).toBe(true);
  });
});

describe("bookMetaSchema 的 digest 可选格", () => {
  const base = {
    id: "b1",
    title: "雾港",
    schemaVersion: 1 as const,
    stages: [{ id: "draft", name: "正文" }],
    activeStage: "draft",
    permissionMode: "full-access" as const,
    chapterOrder: []
  };

  it("老书没有 digest 照样解析", () => {
    expect(bookMetaSchema.parse(base).digest).toBeUndefined();
  });

  it("带 digest 时原样保留", () => {
    const parsed = bookMetaSchema.parse({
      ...base,
      digest: { summary: "林夜在雾港。", cast: "- 林夜：找船。" }
    });
    expect(parsed.digest).toEqual({ summary: "林夜在雾港。", cast: "- 林夜：找船。" });
  });

  it("超上限的 digest 解析不过（生成端必须自己截）", () => {
    const result = bookMetaSchema.safeParse({
      ...base,
      digest: { summary: "摘".repeat(BOOK_DIGEST_SUMMARY_MAX_CHARS + 1), cast: "" }
    });
    expect(result.success).toBe(false);
  });
});
