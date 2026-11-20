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

  it("不许承诺一件不存在的事：欢迎首页只在没打开作品时出现，那时没有稿子可「接着写」", () => {
    // 2026-11-20 真机撞出来的假话：下午那一档写着「接着写那一段吧」，
    // 而这一屏根本没有打开任何作品——那句话承诺了一件不存在的事。
    for (const hour of [0, 8, 11, 14, 17, 18, 23]) {
      expect(welcomeGreeting(hour), `第 ${hour} 点那句在承诺一件不存在的事`).not.toContain(
        "接着写那一段"
      );
    }
  });
});
