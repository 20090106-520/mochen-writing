import { describe, expect, it } from "vitest";
import { PERMISSION_LABELS, type BookMeta, type DocRef } from "@mochen/contracts";
import { dossierSummary, groupDocsForDossier } from "./book-dossier";

const meta: BookMeta = {
  id: "b1",
  title: "深渊之下",
  schemaVersion: 1,
  stages: [
    { id: "draft", name: "正文" },
    { id: "revise", name: "修订" }
  ],
  activeStage: "draft",
  permissionMode: "chapter-write",
  chapterOrder: ["chapters/01.md", "chapters/02.md"]
};

function doc(relPath: string, kind: DocRef["kind"], title: string): DocRef {
  return { relPath, kind, title };
}

describe("groupDocsForDossier · 空组不出现", () => {
  it("五类里只出现的两类按固定顺序归组，缺的类绝不冒出来（W6 靶）", () => {
    const groups = groupDocsForDossier([
      doc("chapters/01.md", "chapter", "第一章"),
      doc("outline/a.md", "outline", "大纲A")
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["chapter", "outline"]);
  });

  it("没有人物文档时绝不出现人物组", () => {
    const groups = groupDocsForDossier([doc("chapters/01.md", "chapter", "第一章")]);
    expect(groups.some((g) => g.kind === "character")).toBe(false);
  });

  it("标签取自 book-kinds 唯一表", () => {
    const groups = groupDocsForDossier([doc("characters/李深.md", "character", "李深")]);
    expect(groups[0]?.label).toBe("人物");
  });

  it("同组内多篇按传入顺序收齐", () => {
    const groups = groupDocsForDossier([
      doc("chapters/01.md", "chapter", "一"),
      doc("chapters/02.md", "chapter", "二")
    ]);
    expect(groups[0]?.docs.map((d) => d.relPath)).toEqual(["chapters/01.md", "chapters/02.md"]);
  });

  it("空数组 ⇒ 零组（一张卡都不出）", () => {
    expect(groupDocsForDossier([])).toEqual([]);
  });
});

describe("dossierSummary", () => {
  it("没开书（meta 为 null）⇒ null，不捏造任何字段", () => {
    expect(dossierSummary(null, [])).toBeNull();
  });

  it("章节数只数 chapter，档位取 PERMISSION_LABELS，阶段取活动阶段名", () => {
    const summary = dossierSummary(meta, [
      doc("chapters/01.md", "chapter", "一"),
      doc("chapters/02.md", "chapter", "二"),
      doc("materials/雾.md", "material", "雾")
    ]);
    expect(summary?.chapterCount).toBe(2);
    expect(summary?.permissionLabel).toBe(PERMISSION_LABELS["chapter-write"]);
    expect(summary?.stageName).toBe("正文");
    expect(summary?.title).toBe("深渊之下");
  });
});
