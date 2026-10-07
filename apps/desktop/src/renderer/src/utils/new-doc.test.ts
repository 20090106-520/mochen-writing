import { describe, expect, it } from "vitest";
import { newDocPlan } from "./new-doc";
import type { DocRef } from "@mochen/contracts";

const doc = (relPath: string): DocRef => ({ relPath, kind: "chapter", title: relPath });

describe("newDocPlan", () => {
  it("正常名字：给出规划好的书内路径", () => {
    expect(newDocPlan("chapter", "第三章 雾夜", [])).toEqual({
      ok: true,
      relPath: "chapters/第三章 雾夜.md"
    });
    expect(newDocPlan("material", "设定-灯塔", [])).toEqual({
      ok: true,
      relPath: "materials/设定-灯塔.md"
    });
    expect(newDocPlan("plot", "三幕", [])).toEqual({ ok: true, relPath: "plot/三幕.md" });
  });

  it("空标题与纯空格：不给路径，只说要起名", () => {
    expect(newDocPlan("chapter", "   ", [])).toEqual({
      ok: false,
      reason: "empty",
      message: "先起个名字。"
    });
  });

  it("标题起不了文件名（全为点）：拒绝", () => {
    expect(newDocPlan("chapter", "...", [])).toEqual({
      ok: false,
      reason: "invalid",
      message: "这个标题起不了文件名（不能只含空格或点），换一个名字。"
    });
  });

  it("与现有文档撞名（sanitize 后相同也算）：拒绝并报出现有路径", () => {
    const docs = [doc("chapters/第一章.md")];
    expect(newDocPlan("chapter", "第一章", docs)).toEqual({
      ok: false,
      reason: "duplicate",
      message: "已经有同名的了：chapters/第一章.md。换一个名字。"
    });
    // 同名不同分组不冲突：章节与素材各走各的目录。
    expect(newDocPlan("material", "第一章", docs)).toEqual({
      ok: true,
      relPath: "materials/第一章.md"
    });
  });

  it("文件名非法字符被 sanitize 后仍能建：路径里不带 Windows 禁用字符", () => {
    const plan = newDocPlan("chapter", "第二章:归港", []);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.relPath).toBe("chapters/第二章-归港.md");
  });
});
