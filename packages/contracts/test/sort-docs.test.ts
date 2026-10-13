import { describe, expect, it } from "vitest";
import type { DocRef } from "../src/index.js";
import { sortDocs } from "../src/index.js";

/**
 * P1-4 的后半（2026-10-10）：章节次序的判定过去有**两份**，而且它们不等价——
 * 主进程 `fs-store/sortChapters` 对「都不在 chapterOrder 里的两篇」按 `relPath` 名字排，
 * 渲染层 `utils/doc-order/sortDocsByOrder` 对同样两篇返回 0（保持传进来的相对次序）。
 *
 * 后果不是「谁好看一点」而是**增量拼不出等价结果**：渲染层想只把新那篇 `DocRef` 拼进树
 * （省掉一次整本重扫），前提是"本地拼完 = 整本重扫"，而两份判据不同就没有这个前提。
 * 所以判据必须先合并成一份、再动重扫那一刀。
 *
 * 为什么长在 contracts：渲染层不许 import fs-store（包边界守卫，`doc-order.ts:8-10` 那句理由
 * 是成立的），contracts 是唯一两边都能进、又不带 Node 依赖的格子。合并之后
 * fs-store 与渲染层各自那份都只是**转调**，本文件钉的就是这一份唯一判据本身。
 *
 * 取哪一份语义？取主进程那份（名字序）。理由不是"它先存在"，而是它**与输入顺序无关**：
 * 「保持原相对次序」的判据下，同一批文稿换个来路（重扫 / 增量拼接）会得到两种侧栏顺序，
 * 而那正是用户点名要防的那种不一致。
 */
const doc = (relPath: string, title = relPath): DocRef => ({
  relPath,
  kind: relPath.startsWith("chapters/") ? "chapter" : "character",
  title
});

describe("sortDocs：全仓唯一的章节次序判据", () => {
  it("登记在 chapterOrder 里的按次序排在前，未登记的跟在后面", () => {
    const docs = [doc("characters/李深.md"), doc("chapters/02.md"), doc("chapters/01.md")];
    expect(sortDocs(docs, ["chapters/02.md", "chapters/01.md"]).map((d) => d.relPath)).toEqual([
      "chapters/02.md",
      "chapters/01.md",
      "characters/李深.md"
    ]);
  });

  it("已登记的那篇排最前，**哪怕它的名字排在未登记那篇后面**（单边规则的真鉴别力）", () => {
    // 上一条用例其实钉不住单边规则：`chapters/*` 按名字本来就排在 `characters/*` 前面，
    // 把两条单边规则删掉它照样绿——这一档才是那条规则的鉴别力来源（99 名字在后、登记在前）。
    const docs = [doc("chapters/01.md"), doc("chapters/99-终章.md")];
    expect(
      sortDocs(docs, ["chapters/99-终章.md"]).map((d) => d.relPath),
      "删掉「已登记的排在前」那两条单边规则就会红：名字序把 01 顶到前面，chapterOrder 说了不算"
    ).toEqual(["chapters/99-终章.md", "chapters/01.md"]);
  });

  it("未登记的几篇按 relPath 名字序，**与它们从哪条通路来无关**", () => {
    const 增量拼接 = [doc("chapters/01.md"), doc("materials/设定.md"), doc("chapters/09-新章.md")];
    const 整本重扫 = [...增量拼接].reverse();
    const 期望 = ["chapters/01.md", "chapters/09-新章.md", "materials/设定.md"];
    expect(sortDocs(增量拼接, ["chapters/01.md"]).map((d) => d.relPath)).toEqual(期望);
    // 反向鉴别：渲染层旧判据（未登记的两篇返回 0、保持原序）在这一档会给出不一样的一条。
    expect(sortDocs(整本重扫, ["chapters/01.md"]).map((d) => d.relPath)).toEqual(期望);
  });

  it("名字序是 zh-CN 拼音序而不是码点序：写成 `<` 比较当场红", () => {
    // 李 U+674E < 阿 U+963F（码点序），但拼音 ā < lǐ（zh-CN 序）——两判据在这对名字上相反。
    const docs = [doc("characters/李深.md"), doc("characters/阿雾.md")];
    expect(sortDocs(docs, []).map((d) => d.relPath)).toEqual([
      "characters/阿雾.md",
      "characters/李深.md"
    ]);
  });

  it("空 chapterOrder 也按名字排（渲染层旧口径的「一字不动」在这里不成立）", () => {
    const docs = [doc("chapters/02.md"), doc("chapters/01.md")];
    expect(sortDocs(docs, []).map((d) => d.relPath)).toEqual(["chapters/01.md", "chapters/02.md"]);
  });

  it("绝不就地改动传入的数组：渲染层那份 docs 被响应式包着，就地 sort 会绕过变更追踪", () => {
    const docs = [doc("chapters/b.md"), doc("chapters/a.md")];
    const sorted = sortDocs(docs, []);
    expect(sorted.map((d) => d.relPath)).toEqual(["chapters/a.md", "chapters/b.md"]);
    expect(docs.map((d) => d.relPath)).toEqual(["chapters/b.md", "chapters/a.md"]);
    expect(sorted).not.toBe(docs);
  });

  it("次序表里登记了盘上没有的条目：不凭空造稿，也不报错", () => {
    const docs = [doc("chapters/02.md"), doc("chapters/01.md")];
    expect(
      sortDocs(docs, ["chapters/99-删掉的.md", "chapters/02.md"]).map((d) => d.relPath)
    ).toEqual(["chapters/02.md", "chapters/01.md"]);
  });
});
