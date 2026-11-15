import { describe, expect, it } from "vitest";
import {
  BOOK_PROJECT_FIELDS,
  BOOK_PROJECT_LABELS,
  bookConventionBody,
  bookProjectBrief,
  normalizeBookProject,
  parseBookMeta
} from "../src/index.js";

/**
 * 开书立项（W-07）的契约层。
 *
 * 这里钉三件事：
 * ① 六格全空 = 没填（book.json 不出现这一格），老书解析照样过；
 * ② 提示词摘要只列填过的格子，按固定顺序，一句说完；
 * ③ 「创作约定」初稿不替作者补设定——没填的格子如实写「（未填）」。
 */

const BASE_META = {
  id: "b-1",
  title: "测试之书",
  schemaVersion: 1 as const,
  stages: [{ id: "draft", name: "正文" }],
  activeStage: "draft",
  permissionMode: "read-only" as const,
  chapterOrder: []
};

describe("normalizeBookProject", () => {
  it("六格全空 ⇒ undefined（跳过立项与新书原流程一致）", () => {
    expect(normalizeBookProject({})).toBeUndefined();
    expect(
      normalizeBookProject({
        genre: "  ",
        platform: "",
        length: "   ",
        cadence: "",
        taboos: "",
        pitch: ""
      })
    ).toBeUndefined();
  });

  it("非字符串丢掉、首尾空白去掉，只留下真填过的格子", () => {
    expect(
      normalizeBookProject({ genre: " 都市异能 ", platform: 42, taboos: "不写虐杀", pitch: "  " })
    ).toEqual({ genre: "都市异能", taboos: "不写虐杀" });
  });

  it("单格截到上限，不让一句设定当正文读", () => {
    const normalized = normalizeBookProject({ pitch: "长".repeat(500) });
    expect(normalized?.pitch).toHaveLength(200);
  });

  it("不是对象一律当没填", () => {
    expect(normalizeBookProject(null)).toBeUndefined();
    expect(normalizeBookProject("都市异能")).toBeUndefined();
    expect(normalizeBookProject([])).toBeUndefined();
  });
});

describe("bookProjectBrief", () => {
  it("按固定顺序只列填过的格子，一句说完", () => {
    expect(
      bookProjectBrief({ pitch: "一个小人物掀翻旧秩序", genre: "都市异能", cadence: "日更 2 章" })
    ).toBe(
      "本书立项：题材 / 频道：都市异能；更新节奏：日更 2 章；一句话卖点：一个小人物掀翻旧秩序。"
    );
  });

  it("没填任何一格就返回空串，调用方整句不加", () => {
    expect(bookProjectBrief(undefined)).toBe("");
    expect(bookProjectBrief({})).toBe("");
  });
});

describe("bookConventionBody", () => {
  it("填过的写值、没填的写「（未填）」，不替作者补设定", () => {
    const body = bookConventionBody({ genre: "都市异能", taboos: "不写虐杀" });
    expect(body).toContain("**题材 / 频道**：都市异能");
    expect(body).toContain("**雷点 / 禁忌**：不写虐杀");
    expect(body).toContain("**目标平台**：（未填）");
    // 六格一枚不少：作者打开这份初稿就知道还缺什么。
    for (const field of BOOK_PROJECT_FIELDS)
      expect(body).toContain(`**${BOOK_PROJECT_LABELS[field]}**`);
  });

  it("卷纲与人物卡是空骨架，不是预生成内容", () => {
    const body = bookConventionBody({ genre: "都市异能" });
    expect(body).toContain("## 卷纲骨架（空模板）");
    expect(body).toContain("## 人物卡骨架（空模板）");
    expect(body).not.toContain("第一章");
  });

  it("没立项 ⇒ 空串，建书不生成这份文稿", () => {
    expect(bookConventionBody(undefined)).toBe("");
    expect(bookConventionBody({})).toBe("");
  });
});

describe("parseBookMeta · 立项是增量不是迁移门槛", () => {
  it("老书没有 project 这一格，照样解析得过", () => {
    expect(parseBookMeta(BASE_META).project).toBeUndefined();
  });

  it("新书的立项原样读回", () => {
    const meta = parseBookMeta({ ...BASE_META, project: { genre: "都市异能", pitch: "卖点" } });
    expect(meta.project).toEqual({ genre: "都市异能", pitch: "卖点" });
  });

  it("超过上限的格子解析不过（写盘前由 normalizeBookProject 截断，这里是最后一道）", () => {
    expect(() => parseBookMeta({ ...BASE_META, project: { genre: "长".repeat(201) } })).toThrow();
  });
});
