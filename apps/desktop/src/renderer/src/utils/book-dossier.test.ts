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

function doc(relPath: string, kind: DocRef["kind"], title: string, chars?: number): DocRef {
  // 不写 `chars: undefined`：那要依赖 exactOptionalPropertyTypes 关着才合法，老数据模拟靠「这个字段根本不存在」。
  return chars === undefined ? { relPath, kind, title } : { relPath, kind, title, chars };
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

  // #103a：书卡那句「正文 M 字」与打开同一篇时页脚的 N 同源（都取 scan 带出的 DocRef.chars），
  // 这里只钉求和口径：只加章节，人物/大纲/素材一个字都不算进来。
  it("正文字数只加章节：人物、大纲、素材都不算", () => {
    const summary = dossierSummary(meta, [
      doc("chapters/01.md", "chapter", "一", 1200),
      doc("chapters/02.md", "chapter", "二", 300),
      doc("characters/李深.md", "character", "李深", 9999),
      doc("outline/a.md", "outline", "大纲A", 8888),
      doc("materials/雾.md", "material", "雾", 7777)
    ]);
    expect(summary?.chapterChars).toBe(1500);
  });

  // 旧扫描结果（或读盘失败的那一篇）没有 chars ⇒ 当 0，不许把 NaN 端给用户。
  it("缺 chars 的那一篇按 0 计入：不出现 NaN", () => {
    const summary = dossierSummary(meta, [
      doc("chapters/01.md", "chapter", "一", 500),
      doc("chapters/02.md", "chapter", "二")
    ]);
    expect(summary?.chapterChars).toBe(500);
    expect(Number.isNaN(summary?.chapterChars)).toBe(false);
  });

  it("一篇章节都没有 ⇒ 0 字，和「0 篇」说同一句话", () => {
    const summary = dossierSummary(meta, [doc("materials/雾.md", "material", "雾", 40)]);
    expect(summary?.chapterChars).toBe(0);
  });
});
