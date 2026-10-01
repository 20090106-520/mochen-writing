import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODES,
  bookMetaSchema,
  parseBookMeta
} from "../src/index.js";

const valid = {
  id: "book_1",
  title: "深渊之下",
  schemaVersion: 1,
  stages: [{ id: "draft", name: "正文" }],
  activeStage: "draft",
  permissionMode: "read-only",
  chapterOrder: ["chapters/01-开局.md"]
};

describe("bookMetaSchema", () => {
  it("接受合法 book.json", () => {
    expect(parseBookMeta(valid)).toEqual(valid);
  });

  it("缺 activeStage 时拒绝", () => {
    const rest: Record<string, unknown> = { ...valid };
    delete rest.activeStage;
    expect(() => parseBookMeta(rest)).toThrow(/activeStage/);
  });

  it("未知权限档时拒绝", () => {
    expect(() => parseBookMeta({ ...valid, permissionMode: "yolo" })).toThrow();
  });

  it("stage id 重复时拒绝", () => {
    expect(() =>
      parseBookMeta({
        ...valid,
        stages: [
          { id: "draft", name: "正文" },
          { id: "draft", name: "修订" }
        ]
      })
    ).toThrow(/重复/);
  });

  it("activeStage 指向不存在的阶段时拒绝", () => {
    expect(() => parseBookMeta({ ...valid, activeStage: "ghost" })).toThrow(
      /activeStage 不在 stages 中/
    );
  });

  it("默认权限档是最保守的一档", () => {
    expect(DEFAULT_PERMISSION_MODE).toBe("read-only");
    expect(PERMISSION_MODES[0]).toBe("read-only");
    expect(bookMetaSchema.safeParse({ ...valid, permissionMode: "full-access" }).success).toBe(
      true
    );
  });
});
