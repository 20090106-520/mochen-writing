import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERMISSION_MODE,
  PATCH_MODES,
  PERMISSION_LABELS,
  PERMISSION_MODES,
  PROPOSAL_MODE_LABELS,
  PROPOSAL_STATUSES,
  PROPOSAL_STATUS_LABELS,
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

describe("权限档与提案模式的文案表（铁律 6：一张表，穷尽键）", () => {
  it("PERMISSION_LABELS 的键与 PERMISSION_MODES 完全一致，中文逐字钉死", () => {
    expect(Object.keys(PERMISSION_LABELS).sort()).toEqual([...PERMISSION_MODES].sort());
    expect(PERMISSION_LABELS["read-only"]).toBe("只读参考");
    expect(PERMISSION_LABELS["chapter-write"]).toBe("可改当前章");
    expect(PERMISSION_LABELS["full-access"]).toBe("全开");
  });

  it("PROPOSAL_MODE_LABELS 覆盖 PATCH_MODES，中文逐字钉死", () => {
    expect(Object.keys(PROPOSAL_MODE_LABELS).sort()).toEqual([...PATCH_MODES].sort());
    expect(PROPOSAL_MODE_LABELS["anchor-replace"]).toBe("锚点替换");
    expect(PROPOSAL_MODE_LABELS["doc-overwrite"]).toBe("整篇替换");
  });

  it("提案状态表含 expired，中文是「上次会话未处理」", () => {
    expect(PROPOSAL_STATUSES).toContain("expired");
    expect(PROPOSAL_STATUS_LABELS.expired).toBe("上次会话未处理");
  });
});
