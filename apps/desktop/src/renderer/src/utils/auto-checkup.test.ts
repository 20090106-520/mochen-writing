import { describe, expect, it } from "vitest";
import { autoCheckupOf } from "./auto-checkup";

/**
 * 写后自动体检的判据（2026-11-17）：只报真有命中的篇，口径全部来自既有真身。
 * 断言只钉「范围」与「分类」，不重算词表里的具体条数——那些数字归 contracts 的测试管。
 */
describe("autoCheckupOf · 写后自动体检", () => {
  it("空内容不报：空白章还没有可查的东西", () => {
    expect(autoCheckupOf([{ relPath: "ch1.md", title: "第一章", content: "   \n" }])).toEqual([]);
  });

  it("干净正文不报", () => {
    const findings = autoCheckupOf([
      { relPath: "ch1.md", title: "第一章", content: "他推门进来，把伞靠在墙边。\n屋里没人。" }
    ]);
    expect(findings).toEqual([]);
  });

  it("AI 味命中会进 aiFlavor，并计入 total", () => {
    const findings = autoCheckupOf([
      {
        relPath: "ch1.md",
        title: "第一章",
        // 套话类起报线是 2 次（AI_FLAVOR_MIN_COUNT.cliche），写一次不报是既有口径。
        content: "他嘴角勾起一抹笑意。她也嘴角勾起一抹笑意。"
      }
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.aiFlavor.length).toBeGreaterThan(0);
    expect(findings[0]!.total).toBeGreaterThan(0);
  });

  it("标点硬伤会进 punctuation", () => {
    const findings = autoCheckupOf([
      { relPath: "ch1.md", title: "第一章", content: "他走了。。屋里静下来。" }
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.punctuation.length).toBeGreaterThan(0);
  });

  it("只保留有问题的篇，并按合计条数降序", () => {
    const findings = autoCheckupOf([
      { relPath: "clean.md", title: "干净章", content: "他推门进来，把伞靠在墙边。" },
      { relPath: "few.md", title: "一处", content: "他走了。。屋里静下来。" },
      {
        relPath: "many.md",
        title: "多处",
        content: "他嘴角勾起一抹笑意。她也嘴角勾起一抹笑意。。"
      }
    ]);
    expect(findings.map((one) => one.docRelPath)).toEqual(["many.md", "few.md"]);
  });
});
