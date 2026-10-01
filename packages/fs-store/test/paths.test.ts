import { describe, expect, it } from "vitest";
import { assertSafeRelPath, toPosixRelPath } from "../src/paths.js";

describe("assertSafeRelPath", () => {
  it.each(["chapters/01-开局.md", "characters/李深.md", ".mochen/skills/三幕/SKILL.md"])(
    "接受书内相对路径 %s",
    (p) => {
      expect(assertSafeRelPath(p)).toBe(p);
    }
  );

  it("拒绝空串", () => expect(() => assertSafeRelPath("")).toThrow(/invalid-path/));
  it("拒绝绝对路径", () =>
    expect(() => assertSafeRelPath("C:/Windows/x.md")).toThrow(/invalid-path/));
  it("拒绝 .. 穿越", () => expect(() => assertSafeRelPath("../secret.md")).toThrow(/outside-book/));
  it("拒绝穿越中段的 ..", () =>
    expect(() => assertSafeRelPath("chapters/../../secret.md")).toThrow(/outside-book/));
  it("拒绝反斜杠穿越", () =>
    expect(() => assertSafeRelPath("chapters\\..\\..\\secret.md")).toThrow(/outside-book/));

  it("把 Windows 分隔符归一成 POSIX", () =>
    expect(toPosixRelPath("chapters\\01-a.md")).toBe("chapters/01-a.md"));
});
