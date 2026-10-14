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
  // 2026-10-14 审计项 5：盘符相对路径不带斜杠，旧的 `^[a-zA-Z]:\//` 抓不到它。
  it("拒绝盘符相对路径 C:foo", () =>
    expect(() => assertSafeRelPath("C:foo/secret.md")).toThrow(/invalid-path/));
  it("拒绝冒号（NTFS 备用数据流的分隔符）", () =>
    expect(() => assertSafeRelPath("chapters/a:stream.md")).toThrow(/invalid-path/));
  it("拒绝空字符（Win32 会把 \0 之后的字节截断）", () =>
    expect(() => assertSafeRelPath("chapters/a\u0000b.md")).toThrow(/invalid-path/));
  it.each(["chapters/笔记.md.", "chapters/草稿 ", "chapters/.../x.md"])(
    "拒绝末尾的点或空格 %s（Windows 落盘时会吞掉）",
    (p) => {
      expect(() => assertSafeRelPath(p)).toThrow(/invalid-path/);
    }
  );
  it("拒绝 .. 穿越", () => expect(() => assertSafeRelPath("../secret.md")).toThrow(/outside-book/));
  it("拒绝穿越中段的 ..", () =>
    expect(() => assertSafeRelPath("chapters/../../secret.md")).toThrow(/outside-book/));
  it("拒绝反斜杠穿越", () =>
    expect(() => assertSafeRelPath("chapters\\..\\..\\secret.md")).toThrow(/outside-book/));

  it("把 Windows 分隔符归一成 POSIX", () =>
    expect(toPosixRelPath("chapters\\01-a.md")).toBe("chapters/01-a.md"));
});
