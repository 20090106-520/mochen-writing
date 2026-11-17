import { describe, expect, it } from "vitest";
import {
  DIALOGUE_BALANCE,
  dialogueBalance,
  dialogueVerdict,
  endsInsideQuote,
  narrationOf
} from "../src/dialogue.js";

/**
 * 对话占比的**唯一测量真身**（2026-10-11 下沉；2026-10-19 配对补齐）。
 *
 * 这一份用例守两件事：
 * ① 旧口径不回归——`「」『』` 稿的读数与补齐前逐字一致（体检第六类与生成端第五段都吃它）；
 * ② 新口径真落地——出厂主笔实际用的是**半角直引号 `"`**（§一百三十一 真机复验查明），
 *    原名目只认全角，会把一本对白充裕的书读成 0%，故本次把弯引号 `“”` 与半角 `"` 一并收进配对。
 */

describe("dialogueBalance · 全角引号（旧口径，一字不动）", () => {
  it("「」内的字算对白，非空白字算总量：3 / 11", () => {
    const balance = dialogueBalance("「喝吧。」他把杯子推过去。");
    expect(balance.quoted).toBe(3);
    expect(balance.total).toBe(11);
  });

  it("『』内层与外层各算各的，不串味（depth 防嵌套）", () => {
    // 外层「他说『走』时没回头」：非引号字共 7 个，全在引号内——内层不多算、外层不漏算。
    const balance = dialogueBalance("「他说『走』时没回头」");
    expect(balance.quoted).toBe(7);
    expect(balance.total).toBe(7);
  });

  it("空白不稀释占比（换行与缩进不进分母）", () => {
    expect(dialogueBalance("「喝吧。」\n\n  他把杯子推过去。").total).toBe(11);
  });

  it("判读阈值不变：不足 500 字不判定", () => {
    expect(dialogueVerdict(dialogueBalance("「喝吧。」"))).toBe("thin-sample");
    expect(DIALOGUE_BALANCE.minChars).toBe(500);
  });
});

describe("dialogueBalance · 弯引号与半角直引号（2026-10-19 召回补齐）", () => {
  it("弯引号 “” 与全角同读：3 / 11", () => {
    const balance = dialogueBalance("“喝吧。”他把杯子推过去。");
    expect(balance.quoted).toBe(3);
    expect(balance.total).toBe(11);
  });

  it("半角直引号按行内奇偶配对（开闭同形，奇数个为开）：3 / 11", () => {
    // 出厂主笔的正文长这样——不改这一条，本仓会把它的对白占比读成 0。
    const balance = dialogueBalance('"喝吧。"他把杯子推过去。');
    expect(balance.quoted).toBe(3);
    expect(balance.total).toBe(11);
  });

  it("行末回落：一行里落单的半角引号不把后面的叙述吞成对白", () => {
    // 第一行只有一个 `"`（开），若深度一路带下去，第二行整句会被误读成对白。
    const balance = dialogueBalance('"他没说话\n他把杯子推过去。');
    expect(balance.quoted).toBe(4);
    expect(balance.total).toBe(12);
  });
});

describe("endsInsideQuote · 段末收法的一枚判据（2026-10-19）", () => {
  it("段末仍在引号内 ⇒ true（全角、弯引号、半角三种引号都认）", () => {
    expect(endsInsideQuote("「喝吧。")).toBe(true);
    expect(endsInsideQuote("“喝吧。")).toBe(true);
    expect(endsInsideQuote('"喝吧。')).toBe(true);
  });

  it("引号已闭合、段末落在叙述上 ⇒ false", () => {
    expect(endsInsideQuote("「喝吧。」他把杯子推过去。")).toBe(false);
    expect(endsInsideQuote('"喝吧。"他把杯子推过去。')).toBe(false);
  });

  it("整段没有引号 ⇒ false（不是「收在台词上」）", () => {
    expect(endsInsideQuote("他把杯子推过去。")).toBe(false);
  });
});

/**
 * `narrationOf`（2026-11-15）：只留引号外的叙述，行界保留。
 * 用途是叙述人称统计——人物说的话里的「我」不能算进叙述。
 */
describe("narrationOf · 剥掉对话、留下叙述（2026-11-15）", () => {
  it("全角引号内的话被剔除，引号外的叙述原样留下", () => {
    expect(narrationOf("「喝吧。」他把杯子推过去。")).toBe("他把杯子推过去。");
  });

  it("弯引号与半角直引号同样剔除（配对只走 scanQuotes 一处）", () => {
    expect(narrationOf("“喝吧。”他把杯子推过去。")).toBe("他把杯子推过去。");
    expect(narrationOf('"喝吧。"他把杯子推过去。')).toBe("他把杯子推过去。");
  });

  it("行界保留：三行正文剥完仍是三行（三个换行里留下两个行间换行）", () => {
    const narration = narrationOf("他说：「走。」\n她没动。\n风停了。");
    expect(narration).toBe("他说：\n她没动。\n风停了。");
    expect(narration.split("\n")).toHaveLength(3);
  });

  it("行末回落的半角引号不吞下一行（与占比同一份配对规则）", () => {
    expect(narrationOf('"他没说话\n他把杯子推过去。')).toBe("\n他把杯子推过去。");
  });
});
