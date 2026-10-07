import { describe, expect, it } from "vitest";
import { resolveColorScheme } from "./appearance-scheme";

describe("resolveColorScheme", () => {
  it("system 跟随系统布尔：暗即深、亮即浅", () => {
    expect(resolveColorScheme("system", true)).toBe("dark");
    expect(resolveColorScheme("system", false)).toBe("light");
  });

  it("light/dark 是用户的明选：系统说什么都不听", () => {
    expect(resolveColorScheme("light", true)).toBe("light");
    expect(resolveColorScheme("dark", false)).toBe("dark");
  });
});
