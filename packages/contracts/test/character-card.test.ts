import { describe, expect, it } from "vitest";
import {
  CAST_BLIND_SPOT,
  castLevelLabel,
  castMention,
  castNames,
  checkCast,
  parseCharacterCard,
  type CastCardInput,
  type CastChapterInput
} from "../src/character-card.js";

const CARD = "characters/李深.md";

function card(raw: string, title = "李深", relPath = CARD): CastCardInput {
  return { relPath, title, meta: parseCharacterCard(raw) };
}

function chapter(relPath: string, text: string): CastChapterInput {
  return { relPath, text };
}

const CH1 = "chapters/01-开局.md";
const CH2 = "chapters/02-潮信.md";
const CH5 = "chapters/05-归港.md";

describe("parseCharacterCard", () => {
  it("方括号加引号：切成别名与专属说法", () => {
    const meta = parseCharacterCard(
      [
        "---",
        "title: 李深",
        'aliases: [老李, "深爷"]',
        "voice: [少废话, 闸上不许跑]",
        "exit: chapters/21-沉船.md",
        "---",
        "正文"
      ].join("\n")
    );
    expect(meta.aliases).toEqual(["老李", "深爷"]);
    expect(meta.voice).toEqual(["少废话", "闸上不许跑"]);
    expect(meta.exit).toBe("chapters/21-沉船.md");
  });

  it("顿号与逗号分隔的裸列表也认", () => {
    const meta = parseCharacterCard(
      ["---", "aliases: 老李、深爷", "voice: 少废话，闸上不许跑", "---"].join("\n")
    );
    expect(meta.aliases).toEqual(["老李", "深爷"]);
    expect(meta.voice).toEqual(["少废话", "闸上不许跑"]);
    expect(meta.exit).toBe("");
  });

  it("没有这几格就是空表，不编默认值", () => {
    const meta = parseCharacterCard("---\ntitle: 李深\n---\n身份：守闸人\n");
    expect(meta).toEqual({ aliases: [], voice: [], exit: "" });
  });

  it("别名去重", () => {
    expect(parseCharacterCard("---\naliases: 老李, 老李\n---").aliases).toEqual(["老李"]);
  });
});

describe("castNames / castMention（C5 出场判据）", () => {
  it("卡题在前、别名在后，一个字的名字丢掉", () => {
    const meta = parseCharacterCard("---\naliases: 阿深, 七, 老李\n---");
    expect(castNames("李深", meta)).toEqual(["李深", "阿深", "老李"]);
  });

  it("同名只留一次", () => {
    const meta = parseCharacterCard("---\naliases: 李深\n---");
    expect(castNames("李深", meta)).toEqual(["李深"]);
  });

  it("命中别名算在场", () => {
    expect(castMention("老李把闸拉下来。", ["李深", "老李"])).toBe("老李");
    expect(castMention("雾从海面涌上来。", ["李深", "老李"])).toBe("");
  });
});

describe("checkCast · C4 登记完整性", () => {
  it("退场章不在书里报硬伤，原样带回那个路径", () => {
    const got = checkCast(
      [card("---\nexit: chapters/99-没了.md\n---")],
      [chapter(CH1, "李深站着。")],
      [CARD, CH1]
    );
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ level: "defect", code: "C4", quote: "chapters/99-没了.md" });
    expect(got[0]?.message).toContain("找不到");
  });

  it("退场章存在但不是章节（比如人物卡）报数据缺口", () => {
    const other = "characters/王五.md";
    const got = checkCast(
      [card("---\nexit: characters/王五.md\n---")],
      [chapter(CH1, "雾。")],
      [CARD, other, CH1]
    );
    expect(got.map((one) => [one.level, one.code])).toEqual([["gap", "C4"]]);
  });
});

describe("checkCast · C2 口头禅归属", () => {
  it("同一个说法被两张卡声明，报归属冲突硬伤", () => {
    const got = checkCast(
      [
        card("---\nvoice: 闸上不许跑\n---"),
        card("---\nvoice: 闸上不许跑\n---", "王五", "characters/王五.md")
      ],
      [],
      [CARD, "characters/王五.md"]
    );
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ level: "defect", code: "C2" });
    expect(got[0]?.message).toContain("李深");
    expect(got[0]?.message).toContain("王五");
  });

  it("不足三个字的说法进数据缺口", () => {
    const got = checkCast([card("---\nvoice: 行, 好嘞, 闸上不许跑\n---")], [], [CARD]);
    expect(got.map((one) => one.level)).toEqual(["gap"]);
    expect(got[0]?.message).toContain("「行」");
    expect(got[0]?.message).toContain("「好嘞」");
    expect(got[0]?.message).not.toContain("闸上不许跑");
  });

  it("他完全不在场却出现他的说法，报疑似并指到行号", () => {
    const text = "雾从海面涌上来。\n船工说：闸上不许跑。\n";
    const got = checkCast([card("---\nvoice: 闸上不许跑\n---")], [chapter(CH1, text)], [CARD, CH1]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ level: "suspect", code: "C2", chapter: CH1, line: 2 });
    expect(got[0]?.quote).toBe("船工说：闸上不许跑。");
  });

  it("同场出现不判（可能是转述，那要读语义）", () => {
    const text = "李深在。\n有人学他：闸上不许跑。\n";
    const got = checkCast([card("---\nvoice: 闸上不许跑\n---")], [chapter(CH1, text)], [CARD, CH1]);
    expect(got).toEqual([]);
  });

  it("按别名认出在场，同样不判", () => {
    const text = "李深没来，老李来了。\n闸上不许跑。\n";
    const got = checkCast(
      [card("---\naliases: 老李\nvoice: 闸上不许跑\n---")],
      [chapter(CH1, text)],
      [CARD, CH1]
    );
    expect(got).toEqual([]);
  });
});

describe("checkCast · C3 退场之后仍在场", () => {
  const raw = "---\nexit: chapters/02-潮信.md\n---";

  it("退场之后那一章又出现名字，只报疑似", () => {
    const got = checkCast(
      [card(raw)],
      [chapter(CH1, "李深来了。"), chapter(CH2, "李深走了。"), chapter(CH5, "李深又回来了。")],
      [CARD, CH1, CH2, CH5]
    );
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ level: "suspect", code: "C3", chapter: CH5, line: 1 });
    expect(got[0]?.message).toContain("回忆");
  });

  it("退场章当章及之前不报", () => {
    const got = checkCast(
      [card(raw)],
      [chapter(CH1, "李深来了。"), chapter(CH2, "李深走了。")],
      [CARD, CH1, CH2]
    );
    expect(got).toEqual([]);
  });
});

describe("checkCast · 排序与说法", () => {
  it("硬伤排在前、数据缺口排在后", () => {
    const got = checkCast(
      [card("---\nvoice: 行\n---")],
      [chapter(CH1, "雾从海面涌上来。")],
      [CARD, CH1]
    );
    expect(got.map((one) => one.level)).toEqual(["gap"]);
    expect(castLevelLabel("defect")).toBe("硬伤");
    expect(castLevelLabel("suspect")).toBe("疑似");
    expect(castLevelLabel("gap")).toBe("数据缺口");
  });

  it("底部的盲区清单一共三条", () => {
    expect(CAST_BLIND_SPOT).toHaveLength(3);
  });
});
