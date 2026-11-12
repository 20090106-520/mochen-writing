import { describe, expect, it } from "vitest";
import { defaultProfile, type DocRef } from "@mochen/contracts";
// 七段从**真身**（prompt-craft.ts）引：这里守的是那几张正文，不是装配层的转出。
// defaultPromptFor 仍从装配层引——作用域前言要在一份真的系统提示里数出现次数。
import { defaultPromptFor } from "./prompt-assembly.js";
import {
  AI_FLAVOR_INSTRUCTION,
  DE_AI_FLAVOR_STRUCTURE_INSTRUCTION,
  DETAIL_AND_BEAT_INSTRUCTION,
  HUMAN_CRAFT_INSTRUCTION,
  HUMAN_DIALOGUE_INSTRUCTION,
  NARRATIVE_CRAFT_INSTRUCTION,
  QUALITY_INSTRUCTION,
  WRITING_CRAFT_LEAD
} from "./prompt-craft.js";

/**
 * 写正文那七段的**形态**守卫（2026-11-12）。
 *
 * 起因是量出来的两个数：七段合计 3919 字，占整份系统提示七成；而「（写小说正文时遵守）」
 * 这句限定语在五段标题里各出现一遍。它们是历轮按用户抱怨一条条加上来的，
 * 每条单独看都有据可查——问题是没人管总量与重复，于是提示词本身长成了「一本教材」：
 * 四十来条编号规矩。模型拿到这样一份提示词，回复的形态就会被它带偏
 * （连「这个人物动机我拿不准」也端着写小说的架子），这正是用户说的「AI 味」在
 * 提示词这一侧的来源。
 *
 * 这里钉四件事：① 段与段之间不许再有逐字重复的句子；② 作用域只说一次；
 * ③ 段头不再复述限定语；④ 每段与合计都有字数预算，以后加规矩得先删旧的。
 */
const SECTIONS: Record<string, string> = {
  文风硬约束: AI_FLAVOR_INSTRUCTION,
  结构级去味: DE_AI_FLAVOR_STRUCTURE_INSTRUCTION,
  细腻度要求: QUALITY_INSTRUCTION,
  叙事手法要求: NARRATIVE_CRAFT_INSTRUCTION,
  人性化创作: HUMAN_CRAFT_INSTRUCTION,
  对话写法要求: HUMAN_DIALOGUE_INSTRUCTION,
  用笔处置: DETAIL_AND_BEAT_INSTRUCTION
};

/** 两段之间最长的逐字重合。中文没有词边界，只能按字比；600 字的段两两比也只有几十万次。 */
function longestSharedRun(a: string, b: string): string {
  let best = "";
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k += 1;
      if (k > best.length) best = a.slice(i, i + k);
    }
  }
  return best;
}

/**
 * 比之前先把段名抹掉：段与段之间点名引用是**对的**（「见对话写法第 1 条」），
 * 那是交叉引用不是复述。抹成同一个占位符后，剩下的重合才是真复述。
 */
const SECTION_NAMES = [
  "文风硬约束",
  "结构级去味",
  "细腻度要求",
  "叙事手法要求",
  "人性化创作",
  "对话写法要求",
  "用笔处置",
  "对话回复口径"
];

function withoutNames(text: string): string {
  return SECTION_NAMES.reduce((acc, name) => acc.split(name).join("§"), text);
}

describe("写正文七段 · 段间不许逐字复述", () => {
  const names = Object.keys(SECTIONS);

  it("任意两段之间，逐字重合不超过 12 字", () => {
    for (let i = 0; i < names.length; i += 1) {
      for (let j = i + 1; j < names.length; j += 1) {
        const run = longestSharedRun(
          withoutNames(SECTIONS[names[i]!]!),
          withoutNames(SECTIONS[names[j]!]!)
        );
        expect(run.length, `${names[i]} 与 ${names[j]} 逐字重合：「${run}」`).toBeLessThan(13);
      }
    }
  });

  it("三个曾经各写两遍的例子只剩一处", () => {
    const all = Object.values(SECTIONS).join("\n");
    // 「她把茶杯推过去。『喝吧。』」原在细腻度第 3 条与对话写法第 1 条同时出现。
    expect(all.split("她把茶杯推过去").length - 1).toBe(1);
    // 「夜色深沉」在文风段的**词表**里有一份（那是禁用词清单，该有），
    // 但它不该再同时当结构级去味 ⑦ 的开篇反例、叙事手法 3 的环境反例——两处例句合成一处。
    expect(DE_AI_FLAVOR_STRUCTURE_INSTRUCTION).not.toContain("夜色深沉");
    expect(NARRATIVE_CRAFT_INSTRUCTION).toContain("夜色深沉");
    // 章末该落在什么上：结构级去味 ⑥ 与用笔处置 2 原各写一遍完整说法。
    expect(all.split("一件没接完的物件").length - 1).toBe(1);
  });
});

/**
 * 同一件事说过三四遍，模型就学成模板（2026-11-12）。
 *
 * 前一轮清的是**逐字**重复（上面那一组）。这一组守的是**换个说法说同一件事**——
 * 逐字比对抓不到，但它们对模型的效果一样：同一件事读四遍，写出来就是照着那个句式填。
 * 三处都是真数出来的：
 * ①「句子长短」原来在文风硬约束（「要有长有短」）与人性化创作第 4 条（「紧张处短、舒缓处长」）各一份，
 *    泛的那份删了，具体的留一处；
 * ②「该慢的多写两拍」原在人性化创作第 3 条与用笔处置第 1 条的「展」各一份——删前者的后半句，
 *    改成交叉引用（详略三测本来就归用笔处置管）；
 * ③ 结构级去味原 ⑧「引号加戏」与 ⑨「反差模板」分两条，其实都是「替读者划重点」，并成一条。
 *
 * 腾出来的位置补了叙事手法第 6 条「视角」——翻遍整份提示词，「视角」原本一次都没出现过。
 */
describe("写正文七段 · 同一件事只说一处", () => {
  it("句子长短只在一处说（跟着情绪那条）", () => {
    expect(AI_FLAVOR_INSTRUCTION).not.toContain("句长要有长有短");
    expect(HUMAN_CRAFT_INSTRUCTION).toContain("紧张处用短句");
    // 叙事手法第 5 条管的是**篇幅**（哪里放慢、哪里收紧），不许再管句式长短。
    expect(NARRATIVE_CRAFT_INSTRUCTION).not.toContain("用短句");
  });

  it("详略的「展」只归用笔处置，人性化创作只留一句交叉引用", () => {
    expect(HUMAN_CRAFT_INSTRUCTION).not.toContain("多写两拍");
    expect(HUMAN_CRAFT_INSTRUCTION).toContain("「用笔处置」第 1 条");
    expect(DETAIL_AND_BEAT_INSTRUCTION).toContain("多写两拍");
  });

  it("结构级去味的条数从十条落到九条（⑧⑨ 并条）", () => {
    // 九条编号一个不多一个不少：并条时最容易漏改的是末条编号（⑩ 留在原地，前面却只剩 ⑧）。
    const marks = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
    const used = marks.filter((m) => DE_AI_FLAVOR_STRUCTURE_INSTRUCTION.includes(m));
    expect(used).toEqual(marks.slice(0, 9));
    expect(DE_AI_FLAVOR_STRUCTURE_INSTRUCTION).not.toContain("⑩");
  });

  it("「视角」只在叙事手法一段里说，且落在第 6 条", () => {
    // 同段里「视角」出现三次是对的（视角不越界 / 一个视角人物 / 全知视角），
    // 要守的是**别的段不许再开一份口径**：两处讲同一件事，模型就只记得住措辞最短那份。
    const sectionsWithPov = Object.entries(SECTIONS)
      .filter(([, text]) => text.includes("视角"))
      .map(([name]) => name);
    expect(sectionsWithPov).toEqual(["叙事手法要求"]);
    expect(NARRATIVE_CRAFT_INSTRUCTION).toContain("6. 视角不越界");
    // 三个判据缺一不可：能写谁的（别人的心理不写）、叙述者不许越权（不替他把话挑明）、
    // 信息按人物此刻该知道的给（他还不知道的事只写看不见的那一面）。
    expect(NARRATIVE_CRAFT_INSTRUCTION).toContain("别人的心理一概不写");
    expect(NARRATIVE_CRAFT_INSTRUCTION).toContain("也不替他把话挑明");
    expect(NARRATIVE_CRAFT_INSTRUCTION).toContain("只写他看不见的那一面");
  });
});

describe("写正文七段 · 作用域只说一次", () => {
  it("段头不再各带一个「（写小说正文时遵守）」", () => {
    for (const [name, text] of Object.entries(SECTIONS)) {
      expect(text, `${name} 的段头还在复述限定语`).not.toContain("写小说正文时遵守");
    }
  });

  it("公共前言恰好出现一次，且在七段之前", () => {
    const text = defaultPromptFor({
      title: "雾港",
      stageName: "正文",
      chapter: { relPath: "chapters/01-开局.md", kind: "chapter", title: "开局" } as DocRef,
      permissionLabel: "全开",
      workModeLabel: "直接动手",
      profile: defaultProfile(),
      context: { items: [], chars: 0, approxTokens: 0 },
      webSearchEnabled: false
    });
    expect(text.split(WRITING_CRAFT_LEAD).length - 1).toBe(1);
    expect(text.indexOf(WRITING_CRAFT_LEAD)).toBeLessThan(text.indexOf(AI_FLAVOR_INSTRUCTION));
    expect(text.indexOf(WRITING_CRAFT_LEAD)).toBeLessThan(text.indexOf(QUALITY_INSTRUCTION));
    // 前言必须把边界说清：写正文时过，别的时候不必套。少了后半句，它只是又一句口头话。
    expect(WRITING_CRAFT_LEAD).toContain("不必套");
  });

  it("聊天那半句留在对话口径里，文风段只管正文", () => {
    // AI_FLAVOR 原以「这条对你在对话里的回复同样生效」收尾，与段头作用域自相矛盾。
    expect(AI_FLAVOR_INSTRUCTION).not.toContain("对你在对话里的回复同样生效");
    expect(AI_FLAVOR_INSTRUCTION).toContain("AI 味闸");
  });
});

describe("写正文七段 · 字数预算", () => {
  const BUDGET_PER_SECTION = 760;
  const BUDGET_TOTAL = 3800;

  it("每段都有自己的上限：加规矩得先删旧的", () => {
    for (const [name, text] of Object.entries(SECTIONS)) {
      expect([...text].length, `${name} 超预算`).toBeLessThanOrEqual(BUDGET_PER_SECTION);
    }
  });

  it("七段合计不超过 3800 字（2026-11-12 实测 3786）", () => {
    // 3774 → 3786 是「并三条泛话、补一条视角」之后的净账：加进来的第 6 条「视角」163 字，
    // 靠删重复腾出 151 字。以后再加规矩，仍得先删旧的——这条预算就是那根尺。
    const total = Object.values(SECTIONS).reduce((sum, text) => sum + [...text].length, 0);
    expect(total).toBeLessThanOrEqual(BUDGET_TOTAL);
  });
});
