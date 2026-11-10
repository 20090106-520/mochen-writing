import { describe, expect, it } from "vitest";
import { welcomeGreeting } from "./welcome-home";

describe("欢迎首页那句问候", () => {
  it("按本地小时分早 / 午 / 晚三档", () => {
    expect(welcomeGreeting(0)).toContain("早上好");
    expect(welcomeGreeting(10)).toContain("早上好");
    expect(welcomeGreeting(11)).toContain("下午好");
    expect(welcomeGreeting(17)).toContain("下午好");
    expect(welcomeGreeting(18)).toContain("晚上好");
    expect(welcomeGreeting(23)).toContain("晚上好");
  });

  it("越界小时与 NaN 都归一到一个真实档位，不落到空白文案", () => {
    expect(welcomeGreeting(24)).toBe(welcomeGreeting(0));
    expect(welcomeGreeting(-1)).toBe(welcomeGreeting(23));
    expect(welcomeGreeting(Number.NaN)).toBe(welcomeGreeting(12));
  });
});
