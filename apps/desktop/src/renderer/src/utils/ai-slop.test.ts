import { describe, expect, it } from "vitest";
import { aiFlavorGate } from "@mochen/contracts";
import { findAiSlop, slopChecklistPrompt, slopGateOf, slopVerdict, STRONG_TERMS } from "./ai-slop";

/**
 * 去 AI 味检查器的判定层（2026-10-05）。
 *
 * 它必须是**纯本地规则**：左栏那三项「一致性 / 剧情 / 逻辑」都要调 AI（烧 token、要等），
 * 而「这句像不像 AI 写的」是查表能答的——查表就是零成本、零延迟、不联网。
 * 这条边界是本功能存在的理由，别后来人把它改成调模型。
 *
 * 分两档是刻意的：
 * - `strong` 几乎不可能是作者主动写的（套话、成语堆砌）；
 * - `suspect` 是常见句式，**作者完全可能是故意的**（网文里「缓缓地」并不罕见），
 *   报出来是提醒不是判决。UI 上不许把它们说成「错误」。
 */

describe("findAiSlop · 强信号", () => {
  it("命中套话并说清为什么可疑", () => {
    const hits = findAiSlop("值得注意的是，这件事远没有那么简单。");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.matched).toBe("值得注意的是");
    expect(hits[0]?.strength).toBe("strong");
    expect(hits[0]?.why).not.toBe("");
  });

  it("行号从 1 起算（跟编辑器对得上），并带上所在那一行", () => {
    const text = "第一行没有毛病。\n\n值得注意的是，雾从海面涌上来。";
    const hit = findAiSlop(text).find((h) => h.matched === "值得注意的是");
    expect(hit?.line).toBe(3);
    expect(hit?.excerpt).toContain("雾从海面涌上来");
  });

  it("同一行多处命中都报出来，不合并成一条", () => {
    const hits = findAiSlop("总而言之，这是一次令人深思的旅程。");
    const words = hits.map((h) => h.matched);
    expect(words).toContain("总而言之");
    expect(words).toContain("令人深思");
    expect(hits.every((h) => h.line === 1)).toBe(true);
  });
});

describe("findAiSlop · 不误伤", () => {
  it("干净的网文句子一条都不报", () => {
    const text = [
      "雾从海面涌上来。",
      "船灯在雾里晃了一下，像随时会灭。",
      "他把缆绳绕上桩子，搓了搓手心的绳子。",
      "“再等等。”他说。",
      "潮水退了半里，石头上留下一道白痕。"
    ].join("\n");
    expect(findAiSlop(text)).toEqual([]);
  });

  it("正文为空或只有空白时给空表，不抛错", () => {
    expect(findAiSlop("")).toEqual([]);
    expect(findAiSlop("   \n\n  \t ")).toEqual([]);
  });

  it("同一个输入跑两次结果逐字相同（不掺随机、不掺时间）", () => {
    const text = "值得注意的是。总而言之，无可奈何。";
    expect(JSON.stringify(findAiSlop(text))).toBe(JSON.stringify(findAiSlop(text)));
  });
});

describe("findAiSlop · 弱信号只提醒不判决", () => {
  it("常见句式报 suspect，不报 strong", () => {
    const hits = findAiSlop("他缓缓地转过身，静静地看了很久。");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.strength === "suspect")).toBe(true);
  });

  it("词表里没有的词永远不会被报出来（表是唯一来源）", () => {
    const hits = findAiSlop("他说了句怪话，气氛当时挺怪的。");
    expect(hits).toEqual([]);
    for (const h of findAiSlop("值得注意的是，总而言之。")) {
      expect(STRONG_TERMS.some((t) => t.term === h.matched)).toBe(true);
    }
  });
});

describe("slopVerdict · 总体评价", () => {
  it("零命中 = 清爽，且密度是 0", () => {
    const v = slopVerdict([], "短句。\n再有短句。");
    expect(v.level).toBe("clean");
    expect(v.perThousand).toBe(0);
    expect(v.label).not.toBe("");
  });

  it("强信号一整屏 = AI 味重；零星几处 = 轻", () => {
    const heavy = "值得注意的是。\n总而言之。\n令人深思。\n毫无疑问。";
    const mild = "值得注意的是。";
    expect(slopVerdict(findAiSlop(heavy), heavy).level).toBe("heavy");
    expect(slopVerdict(findAiSlop(mild), mild).level).toBe("mild");
  });

  it("密度按每千字算，短文里一处也不许报成满屏命中", () => {
    const short = "值得注意的是。";
    const v = slopVerdict(findAiSlop(short), short);
    expect(v.hits).toBe(1);
    expect(v.perThousand).toBeGreaterThan(0);
  });
});

describe("slopChecklistPrompt · 交给 AI 的改写指令", () => {
  it("零命中也给得出一句可用的话（而不是空串）", () => {
    const prompt = slopChecklistPrompt([], "开局");
    expect(prompt).not.toBe("");
    expect(prompt).toContain("开局");
  });

  it("有命中时逐条列出行号与原词，AI 才知道改哪儿", () => {
    const text = "值得注意的是，这件事远没有那么简单。\n他缓缓地点头。";
    const prompt = slopChecklistPrompt(findAiSlop(text), "开局");
    expect(prompt).toContain("第 1 行");
    expect(prompt).toContain("值得注意的是");
    expect(prompt).toContain("第 2 行");
  });

  it("强信号与弱信号在指令里被分开说，不许让 AI 把作者故意的写法也改掉", () => {
    const text = "值得注意的是，他缓缓地点头。";
    const prompt = slopChecklistPrompt(findAiSlop(text), "开局");
    expect(prompt).toContain("疑似 AI 腔");
    expect(prompt).toMatch(/保留|别改|不要改/);
  });
});

/**
 * 退稿闸预演（2026-11-12）。
 *
 * 这一格的判据**不在本仓渲染层**：它是 `aiFlavorGate` 的结论翻成人话。
 * 所以这里的用例分两种：① 翻得对不对（病根说清了没有）；② 有没有偷偷另判一遍
 * （同一段文本，`slopGateOf` 的 pass 必须与闸逐字一致）。
 */
const PAD = [
  "雾从海面上来，船灯在里面晃，对岸一点影都没有。",
  "他搓了搓手。",
  "潮水退了半里，石头上留下一道弯弯的白痕。",
  "灶间飘出油烟。",
  "风掀开棚布一角，绳子绷紧又松开，打在木杆上。",
  "铁皮响了一声。",
  "浪打上来，把脚印抹平，又退回去。",
  "他没说话。",
  "远处有人在收网，绳结一颗一颗地过手。",
  "灯芯短了。",
  "石阶上积着水，脚踩上去打滑，得扶着墙走。",
  "天快亮了。",
  "船老大蹲在船头抽烟，烟锅一明一暗，照着他半张脸。",
  "潮声低了下去。",
  "缆绳在桩子上磨出毛边，手摸上去扎人。",
  "该走了。"
].join("\n");

describe("slopGateOf · 退稿闸预演", () => {
  it("正文不到闸的起判字数时只说「不判」，不编一个合格证", () => {
    const readout = slopGateOf("他把灯吹了。");
    expect(readout.pass).toBe(true);
    expect(readout.headline).toContain("不判");
    expect(readout.reasons).toEqual([]);
  });

  it("干净的长正文：能过，且只给一行话", () => {
    const readout = slopGateOf(PAD);
    expect(readout.pass).toBe(true);
    expect(readout.headline).toContain("能过");
    expect(readout.reasons).toEqual([]);
  });

  it("套话超标时把条数与闸线都写出来（用户才知道差多少）", () => {
    const text = `${PAD}\n值得注意的是，他嘴角勾起。眼底闪过一线光，心中一凛，五味杂陈，总而言之。`;
    const readout = slopGateOf(text);
    expect(readout.pass).toBe(false);
    expect(readout.headline).toBe("");
    expect(readout.reasons.some((reason) => reason.includes("套话"))).toBe(true);
    expect(readout.reasons.some((reason) => reason.includes("闸线"))).toBe(true);
  });

  it("句式超限报的是「哪一条 + 上限几处」，数字与 contracts 那张表同源", () => {
    const text = `${PAD}\n水面仿佛凝住了。\n灯光仿佛远了。\n他的背影仿佛一堵墙。\n脚步声仿佛从水底传来。`;
    const readout = slopGateOf(text);
    expect(readout.pass).toBe(false);
    const line = readout.reasons.find((reason) => reason.includes("句式超限"));
    expect(line).toBeDefined();
    expect(line).toContain("明喻");
    expect(line).toContain("上限 3 处");
  });

  it("复读句整句重复时点名原句，不是只说「有重复」", () => {
    const repeated = "他把缆绳绕上桩子搓了搓手心的绳子。";
    const text = `${PAD}\n${repeated}\n${repeated}\n${repeated}`;
    const readout = slopGateOf(text);
    const line = readout.reasons.find((reason) => reason.includes("复读句"));
    expect(line).toBeDefined();
    expect(line).toContain(repeated);
    expect(line).toContain("3 次");
  });

  it("pass 与闸逐字一致——渲染层不许另判一遍", () => {
    const samples = [
      PAD,
      `${PAD}\n值得注意的是，他嘴角勾起。眼底闪过一线光，心中一凛，五味杂陈，总而言之。`,
      `${PAD}\n水面仿佛凝住了。\n灯光仿佛远了。\n他的背影仿佛一堵墙。\n脚步声仿佛从水底传来。`,
      "短句。"
    ];
    for (const sample of samples) {
      expect(slopGateOf(sample).pass).toBe(aiFlavorGate(sample).pass);
    }
  });
});

describe("slopChecklistPrompt · 闸的理由并进清单", () => {
  it("闸判退时，那几条整篇的问题一起交给 AI（否则改完词还会被拦一轮）", () => {
    const text = `${PAD}\n水面仿佛凝住了。\n灯光仿佛远了。\n他的背影仿佛一堵墙。\n脚步声仿佛从水底传来。`;
    const prompt = slopChecklistPrompt(findAiSlop(text), "开局", slopGateOf(text));
    expect(prompt).toContain("退稿闸");
    expect(prompt).toContain("明喻");
  });

  it("闸能过时不加这一段（少一句废话）", () => {
    const prompt = slopChecklistPrompt(findAiSlop(PAD), "开局", slopGateOf(PAD));
    expect(prompt).not.toContain("退稿闸");
  });
});
