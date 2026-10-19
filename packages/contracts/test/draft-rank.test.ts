import { describe, expect, it } from "vitest";
import {
  aiFlavorGate,
  DRAFT_SAMPLE_COUNTS,
  DRAFT_SAMPLE_COUNT_REJECT,
  draftSampleCountSchema,
  draftTextOf,
  rankDrafts,
  readDraft
} from "../src/index.js";

/**
 * 多稿择优的契约根（P0-②）。
 *
 * 这里钉两件事：① 档位集合与拒绝句只有一处真身；② 读数与排序**就是**退稿闸那一份判据
 * （改 gate 不改这里就红），且排序是全确定性的。
 */

/**
 * 造 n 句**互不相同**、且**起手字各不相同**的填充句。
 * 两条都是刻意的：句句相同会撞上复读判据、起手字雷同会撞上句首复读判据，
 * 那样用例测的就不是它点名的那一条键了。
 */
const HEAD_CHARS = [
  "甲",
  "乙",
  "丙",
  "丁",
  "戊",
  "己",
  "庚",
  "辛",
  "壬",
  "癸",
  "子",
  "丑",
  "寅",
  "卯"
];
function filler(tag: string, count: number): string {
  return Array.from(
    { length: count },
    (_, index) =>
      `${HEAD_CHARS[index % HEAD_CHARS.length]!}${tag}第${index}件小事，说完也就过去了，谁也没往心里去。`
  ).join("");
}

/**
 * 长短交错的一组句子（偶数句短、奇数句长）：句数够算波动、spread 又比纯等长的那组大，
 * 用来测第五级键——同样都因为句长过匀被判退时，波动大的该排在前面。
 */
function mixed(tag: string, count: number): string {
  return Array.from({ length: count }, (_, index) => {
    const head = HEAD_CHARS[index % HEAD_CHARS.length]!;
    return index % 2 === 0
      ? `${head}${tag}第${index}件小事，说完也就过去了。`
      : `${head}${tag}第${index}件小事，说完也就过去了，谁也没进去看。`;
  }).join("");
}

/** 两句「不是A，是B」式升华对偶（撞结构上限 ⇒ pass=false），词命中各算一次，共 2 次。 */
const ANTITHESIS_LONG = [
  "他不是不想把这句话说完，而是说到一半就没了力气，只能把剩下那半截咽回嗓子眼里，谁也没能听见。",
  "她不是不肯原谅他，而是那些话说出口的时候就已经不像原来那句话了，往后再补也补不回原来的样子。"
].join("");
/** 凑够 200 字（不短于闸的样本门槛）、但整篇只有 6 句——句数不够，波动算不出来。 */
const LONG_TAIL =
  "院子里的老槐树落了一地的叶子，风从墙头上卷过去带着凉意，谁也没有抬头看一眼。" +
  "他把碗端起来又放下，来回折腾了三次，最后还是没有喝。" +
  "窗外的雨声一阵紧过一阵，屋檐下那条水线越拉越细，像要断掉似的。" +
  "他把手在裤子上擦了两下，没说话。";
/** 一句带两枚词表命中项（共 2 次命中）的收尾句，接在等长句堆后面。 */
const TWO_HITS_TAIL = "齐嘴角勾起眼底闪过一件小事，说完也就过去了，谁也没往心里去。";

describe("draftSampleCountSchema", () => {
  it("档位就是 1/2/3 三档，顺序逐字钉死（chip 的循环顺序就是它）", () => {
    expect([...DRAFT_SAMPLE_COUNTS]).toEqual([1, 2, 3]);
  });

  it("三档各自能过，值原样保留", () => {
    for (const count of DRAFT_SAMPLE_COUNTS)
      expect(draftSampleCountSchema.safeParse(count).success).toBe(true);
    expect(draftSampleCountSchema.parse(3)).toBe(3);
  });

  // 反向用例：0（比「关」还小）、4（超上限）、字符串 "2"、缺字段——都必须在边界上炸中文。
  it("0 / 4 / 字符串 / 缺字段一律被拒，且拒绝句是那一份常量", () => {
    for (const bad of [0, 4, -1, 1.5, "2", null, undefined, {}, true]) {
      const result = draftSampleCountSchema.safeParse(bad);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(DRAFT_SAMPLE_COUNT_REJECT);
    }
  });
});

describe("readDraft · 读数就是退稿闸那一份判据", () => {
  it("逐项等于同一份 aiFlavorGate(text) 的对应字段（含 index 是外加的位次）", () => {
    const text =
      "嘴角勾起一抹弧度，他站在原地没有立刻说话。" +
      "眼底闪过一点迟疑，随后又被压了下去。" +
      "他站了很久，才慢慢转过身来，朝门口走过去。" +
      filler("甲", 8);
    const verdict = aiFlavorGate(text);
    const reading = readDraft(2, text);
    expect(reading.index).toBe(2);
    expect(reading.charCount).toBe(verdict.charCount);
    expect(reading.pass).toBe(verdict.pass);
    expect(reading.hits).toBe(verdict.hits);
    expect(reading.perThousand).toBe(verdict.perThousand);
    expect(reading.topTerms).toEqual(verdict.topTerms);
    expect(reading.startRepeat).toEqual(verdict.startRepeat);
    expect(reading.flatRhythm).toEqual(verdict.flatRhythm);
    expect(reading.structureOver).toEqual(verdict.structureOver);
    // repeatOverCount 是「有几处在打转」（条数），不是摊的总次数。
    expect(reading.repeatOverCount).toBe(verdict.repeatOver.length);
  });

  it("读数只读不改：改返回值不影响下一次判定", () => {
    const text = "嘴角勾起。" + filler("乙", 6);
    const first = readDraft(0, text);
    first.topTerms.push("塞进去的");
    first.structureOver.push("塞进去的");
    const second = readDraft(0, text);
    expect(second.topTerms).not.toContain("塞进去的");
    expect(second.structureOver).not.toContain("塞进去的");
  });
});

describe("rankDrafts · 只给序不给总分", () => {
  const repeated = "他把手里的碗轻轻放在桌沿上。";

  it("复读句多的排后（同一句原样摊三遍以上）", () => {
    const withRepeat = repeated.repeat(3) + filler("甲", 10);
    const withoutRepeat = filler("乙", 12);
    const ranked = rankDrafts([withRepeat, withoutRepeat]);
    expect(ranked.map((reading) => reading.index)).toEqual([1, 0]);
    expect(ranked[0]?.repeatOverCount).toBe(0);
    expect(ranked[1]?.repeatOverCount).toBe(1);
  });

  it("词命中多的排后", () => {
    const dirty =
      "嘴角勾起的弧度还没收回去。" +
      "眼底闪过一点说不清的东西。" +
      "他深吸一口气，把话咽了回去。" +
      "目光深邃地落在门框上。" +
      "那句话说得意味深长。" +
      "心头一紧，他攥住了袖口。" +
      filler("丙", 8);
    const clean = filler("丁", 14);
    const ranked = rankDrafts([dirty, clean]);
    expect(ranked.map((reading) => reading.index)).toEqual([1, 0]);
    expect(ranked[0]?.hits).toBe(0);
    expect(ranked[1]?.hits).toBeGreaterThan(0);
  });

  it("同分保持原序（稳定）：三稿读数一样时就是 0/1/2，换个写法也是 0/1/2", () => {
    const same = ["甲。", "乙。", "丙。"];
    expect(rankDrafts(same).map((reading) => reading.index)).toEqual([0, 1, 2]);
    expect(rankDrafts([...same].reverse()).map((reading) => reading.index)).toEqual([0, 1, 2]);
  });

  it("返回的条数与输入一样，且每条的 index 恰好覆盖 0..n-1 各一次", () => {
    const ranked = rankDrafts(["甲。", "乙。", "丙。", "丁。"]);
    expect(ranked.length).toBe(4);
    expect([...ranked.map((reading) => reading.index)].sort((x, y) => x - y)).toEqual([0, 1, 2, 3]);
  });

  it("flatRhythm 都非 null 时波动大的排前（越不像机器越推荐）", () => {
    const uniform = filler("戊", 12);
    const varied = mixed("己", 12);
    const ranked = rankDrafts([uniform, varied]);
    expect(ranked[0]?.index).toBe(1);
    expect(ranked[1]?.index).toBe(0);
    expect(ranked[0]?.flatRhythm).not.toBeNull();
    expect(ranked[1]?.flatRhythm).not.toBeNull();
    expect(ranked[0]!.flatRhythm!.spread).toBeGreaterThan(ranked[1]!.flatRhythm!.spread);
  });

  it("flatRhythm 算不出的（null）视为不可比，排在同分有值者之后", () => {
    // 前四级键全部打平：两条都因为别的原因被判退（pass=false）、词命中都是 2、起手都没复读。
    // 这时才轮得到第五级——算不出波动的那条（句子太少）不该被当成「最匀」排到前面。
    const nullRhythm = ANTITHESIS_LONG + LONG_TAIL;
    const flatRhythm = filler("己", 10) + TWO_HITS_TAIL;
    const ranked = rankDrafts([nullRhythm, flatRhythm]);
    expect(readDraft(0, nullRhythm).flatRhythm).toBeNull();
    expect(readDraft(1, flatRhythm).flatRhythm).not.toBeNull();
    expect(readDraft(0, nullRhythm).hits).toBe(readDraft(1, flatRhythm).hits);
    expect(ranked.map((reading) => reading.index)).toEqual([1, 0]);
  });
});

describe("draftTextOf · 一稿的新增正文怎么拼", () => {
  it("正文与提案文本用空行相接；空段不参与拼接", () => {
    expect(draftTextOf(["正文", "提案"])).toBe("正文\n\n提案");
    expect(draftTextOf(["正文", "", "   "])).toBe("正文");
    expect(draftTextOf(["", ""])).toBe("");
    expect(draftTextOf(["  正文  "])).toBe("正文");
  });
});
