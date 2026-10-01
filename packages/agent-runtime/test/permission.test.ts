import { describe, expect, it } from "vitest";
import { WRITABLE_TOP_DIRS, checkWritePermission } from "../src/permission.js";

describe("checkWritePermission", () => {
  it("五目录之外的路径在任何档位都拒绝（book.json 与 .mochen 是天花板）", () => {
    for (const mode of ["read-only", "chapter-write", "full-access"] as const) {
      expect(
        checkWritePermission({ mode, docRelPath: "book.json", currentChapter: "chapters/01.md" })
          .allowed
      ).toBe(false);
      expect(
        checkWritePermission({
          mode,
          docRelPath: ".mochen/sessions/a.jsonl",
          currentChapter: "chapters/01.md"
        }).allowed
      ).toBe(false);
      expect(
        checkWritePermission({ mode, docRelPath: "notes/x.md", currentChapter: "chapters/01.md" })
          .allowed
      ).toBe(false);
    }
    expect([...WRITABLE_TOP_DIRS]).toEqual([
      "chapters",
      "outline",
      "characters",
      "plot",
      "materials"
    ]);
  });

  it("只读参考档一律拒绝，且说明里点名当前档位", () => {
    const out = checkWritePermission({
      mode: "read-only",
      docRelPath: "chapters/01.md",
      currentChapter: "chapters/01.md"
    });
    expect(out.allowed).toBe(false);
    expect(out.reason).toContain("只读参考");
  });

  it("可改当前章只放行当前章", () => {
    expect(
      checkWritePermission({
        mode: "chapter-write",
        docRelPath: "chapters/02.md",
        currentChapter: "chapters/01.md"
      }).allowed
    ).toBe(false);
    expect(
      checkWritePermission({
        mode: "chapter-write",
        docRelPath: "chapters/01.md",
        currentChapter: "chapters/01.md"
      }).allowed
    ).toBe(true);
  });

  it("没选定当前章时 chapter-write 一律拒绝（无锚可写）", () => {
    const out = checkWritePermission({
      mode: "chapter-write",
      docRelPath: "chapters/01.md",
      currentChapter: null
    });
    expect(out.allowed).toBe(false);
    expect(out.reason).toContain("尚未选定");
  });

  it("全开放行五个目录内的文稿", () => {
    expect(
      checkWritePermission({
        mode: "full-access",
        docRelPath: "characters/李深.md",
        currentChapter: null
      }).allowed
    ).toBe(true);
  });
});
