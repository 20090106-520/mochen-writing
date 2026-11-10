import { describe, expect, it } from "vitest";
import { isMostlyChinese } from "./text-script";

describe("isMostlyChinese", () => {
  it("整段中文 ⇒ 是", () => {
    expect(isMostlyChinese("他把灯吹灭了，屋里只剩油烟味。")).toBe(true);
  });

  it("真机上那条英文推理 ⇒ 不是（它决定了折叠态露不露那一行）", () => {
    expect(isMostlyChinese('The user is greeting me with "你好" (Hello in Chinese).')).toBe(false);
  });

  it("中文里夹路径与英文术语 ⇒ 仍然算中文（阈值不能卡太死）", () => {
    expect(isMostlyChinese("我点开 outline/大纲.md 看了一眼，里面只有三行。")).toBe(true);
  });

  it("纯标点与空白 ⇒ 不是（没有可读内容就不该占那一行）", () => {
    expect(isMostlyChinese("   ")).toBe(false);
    expect(isMostlyChinese("……——")).toBe(false);
  });

  it("英文为主、末尾带一句中文 ⇒ 不是", () => {
    expect(isMostlyChinese("I should be casual and brief here. 好的。")).toBe(false);
  });
});
