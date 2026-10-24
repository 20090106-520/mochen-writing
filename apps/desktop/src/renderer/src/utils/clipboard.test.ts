import { describe, expect, it } from "vitest";
import { copyText } from "./clipboard";

/**
 * 写剪贴板（2026-10-25 · §173）。
 *
 * **为什么单测它**：这一族的痛点是「说假话」——复制失败时界面说「已复制」，
 * 而剪贴板里什么都没有（导出对话框 2026-10-09 那一刀就是这么查出来的）。
 * ⇒ 判据是**成没成**，不是一个 try/catch 的副作用。
 */
describe("copyText · 成没成要说得出来", () => {
  it("写成了：返回 true，且写进去的就是那段字", async () => {
    const written: string[] = [];
    const ok = await copyText("海雾涌上来。", async (text) => {
      written.push(text);
    });
    expect(ok).toBe(true);
    expect(written).toEqual(["海雾涌上来。"]);
  });

  it("系统拒绝了：返回 false（调用方据此说「复制失败」，不许说「已复制」）", async () => {
    const ok = await copyText("海雾涌上来。", async () => {
      throw new Error("denied");
    });
    expect(ok).toBe(false);
  });

  it("空文本不写：返回 false，而且**一个字都不许写进剪贴板**", async () => {
    // 写空串等于把上一条内容留在那儿——用户粘出来会拿到不相干的东西。
    for (const empty of ["", "   ", "\n\n"]) {
      const written: string[] = [];
      const ok = await copyText(empty, async (text) => {
        written.push(text);
      });
      expect(ok, `空文本（${JSON.stringify(empty)}）不该被写进剪贴板`).toBe(false);
      expect(written).toEqual([]);
    }
  });

  it("写失败时也不许留下半个结果（写入是一次性的）", async () => {
    const written: string[] = [];
    const ok = await copyText("甲", async (text) => {
      written.push(text);
      throw new Error("denied");
    });
    expect(ok).toBe(false);
    expect(written).toEqual(["甲"]);
  });
});
