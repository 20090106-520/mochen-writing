/**
 * 「空」的判据只有一份（2026-10-25 · §173）。
 *
 * 真机复验在这本书的真实历史里翻出**两条空正文的助手消息**
 * （2026-10-08 / 10-09 落盘的那两轮，`text: ""`）。它们在屏上是一个空泡，
 * 而原先动作条照挂 ⇒ 一枚「复制」钮点下去必然失败，只给用户一句「复制失败」。
 *
 * ⇒ 同一个「空」在这条链上有两处要用（动作条挂不挂 / 剪贴板写不写），
 *   两处各判一次就会漂 ⇒ 收成这一份，两边都引它。
 */
import { describe, expect, it } from "vitest";
import { hasMessageText } from "./message-text";
import { typeScriptSource } from "./vue-source-reader";

describe("hasMessageText · 有没有东西可拿", () => {
  it("空串与纯空白都算没有东西", () => {
    expect(hasMessageText("")).toBe(false);
    expect(hasMessageText("   ")).toBe(false);
    expect(hasMessageText("\n\t ")).toBe(false);
  });

  it("有字就成立（哪怕只有一个字）", () => {
    expect(hasMessageText("好")).toBe(true);
    expect(hasMessageText(" 在，怎么了？ ")).toBe(true);
  });

  it("两边的用法引的是同一份（复制那道闸不许自己再写一遍 trim 判据）", () => {
    // 这里量的是「判据只有一份」这件事本身：写剪贴板那处必须引本文件那份，
    // 而不是自己写一遍 `text.trim() === ""`。
    // 读的是**剥掉注释的代码本体**——注释里解释「为什么不写空」的那句话
    // 里写着同样的字面量，不剥会把自己咬住。
    const clipboard = typeScriptSource("utils/clipboard.ts");
    expect(clipboard).toContain('from "./message-text"');
    expect(clipboard).toContain("hasMessageText(text)");
    expect(clipboard, "写剪贴板那处自己判了一遍空 ⇒ 与消息动作条那道闸会漂").not.toMatch(
      /text\.trim\(\)\s*===\s*""/
    );
  });
});
