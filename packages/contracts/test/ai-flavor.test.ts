import { describe, expect, it } from "vitest";
import {
  AI_FLAVOR_ANTITHESIS_LABEL,
  AI_FLAVOR_CATEGORY_LABELS,
  AI_FLAVOR_COGNITIVE_LABEL,
  AI_FLAVOR_CONTRAST_LABEL,
  AI_FLAVOR_DIALOGUE_TAG_LABEL,
  AI_FLAVOR_EMOTION_LABEL,
  AI_FLAVOR_GATE,
  AI_FLAVOR_REPEAT,
  AI_FLAVOR_STRUCTURE_GATED_LABELS,
  AI_FLAVOR_TAILCLAUSE_LABEL,
  AI_FLAVOR_TERMS,
  aiFlavorGate,
  repeatedSentences,
  textSimilarity,
  sentenceStartRepeat,
  sentenceRhythmOf,
  SENTENCE_SPREAD_MIN_SENTENCES,
  aiFlavorPromptList,
  analyzeAiFlavor
} from "../src/ai-flavor.js";

describe("ai-flavor · 词库", () => {
  it("词表非空、无重复、类别合法，展示名四类齐全", () => {
    expect(AI_FLAVOR_TERMS.length).toBeGreaterThan(50);
    const terms = AI_FLAVOR_TERMS.map(({ term }) => term);
    expect(new Set(terms).size).toBe(terms.length);
    const categories = new Set(AI_FLAVOR_TERMS.map(({ category }) => category));
    // cognitive 是句式判定（正则），不占词表项——词表只有三类。
    expect([...categories].sort()).toEqual(["adverb", "cliche", "essay"]);
    // 每个类别都有界面展示名（含句式那类）。
    expect(Object.keys(AI_FLAVOR_CATEGORY_LABELS).sort()).toEqual([
      "adverb",
      "cliche",
      "cognitive",
      "essay"
    ]);
  });

  it("提示词词表只收描写套话 + 议论腔，顿号连接且与体检同一份", () => {
    const list = aiFlavorPromptList();
    expect(list).toContain("嘴角勾起");
    expect(list).toContain("众所周知");
    // 副词不进提示词点名单（提示词里另口叮嘱）。
    expect(list).not.toContain("缓缓");
    expect(list.split("、").length).toBe(
      AI_FLAVOR_TERMS.filter(({ category }) => category === "cliche" || category === "essay").length
    );
  });

  it("概括情绪与空泛环境套话进表（2026-10-18，与生成端叙事手法同一批）", () => {
    // 生成端 NARRATIVE_CRAFT_INSTRUCTION 第 1 条「别给情绪命名」与第 3 条「禁空泛环境套话」，
    // 扫描端此前无可对判据——这两组词接回去，写的时候拦一道、写完扫的同一份。
    const terms = AI_FLAVOR_TERMS.map(({ term }) => term);
    for (const word of ["五味杂陈", "心情复杂", "心如刀割", "夜色深沉", "寒风刺骨", "万籁俱寂"]) {
      expect(terms).toContain(word);
    }
    // 它们是 cliche（阈值 2），照旧走 AI_FLAVOR_MIN_COUNT，不设专项阈值。
    expect(AI_FLAVOR_TERMS.find(({ term }) => term === "五味杂陈")!.category).toBe("cliche");
    expect(AI_FLAVOR_TERMS.find(({ term }) => term === "夜色深沉")!.category).toBe("cliche");
    // 提示词点名单随之带上新词（两头同一份，不各抄）——生成端不许手抄第二份。
    expect(aiFlavorPromptList()).toContain("五味杂陈");
    expect(aiFlavorPromptList()).toContain("夜色深沉");
  });
});

describe("ai-flavor · analyzeAiFlavor", () => {
  it("描写套话 ≥2 次起报，带次数与第一次出现的位置", () => {
    const report = analyzeAiFlavor([
      "他嘴角勾起一抹笑。\n她嘴角勾起，眼底闪过一丝惊讶。\n",
      "别处没有。\n"
    ]);
    const cliche = report.entries.filter((entry) => entry.category === "cliche");
    expect(cliche.map((entry) => entry.term)).toContain("嘴角勾起");
    const hit = cliche.find((entry) => entry.term === "嘴角勾起")!;
    expect(hit.count).toBe(2);
    expect(hit.first).toEqual({ docIndex: 0, line: 1, text: "他嘴角勾起一抹笑。" });
  });

  it("议论腔出现 1 次就报；副词不到 5 次不报、到了才报", () => {
    const report = analyzeAiFlavor([
      "众所周知，北境的冬天来得早。\n他缓缓推门。\n",
      "与此同时，另一路人马出发了。\n"
    ]);
    const terms = report.entries.map((entry) => entry.term);
    expect(terms).toContain("众所周知");
    expect(terms).toContain("与此同时");
    // 「缓缓」只有 1 次，低于副词阈值 5，不报。
    expect(terms).not.toContain("缓缓");

    const dense = analyzeFlavorWithRepeat("他不禁停下脚步。\n", 5);
    expect(dense.entries.map((entry) => entry.term)).toContain("不禁");
    expect(dense.entries.find((entry) => entry.term === "不禁")!.count).toBe(5);
  });

  it("认知转述句式按正则计，报成固定名目；不足 3 次不报", () => {
    const report = analyzeFlavorWithRepeat("他知道，这不是一次普通的遭遇战。\n", 3);
    const cognitive = report.entries.find((entry) => entry.category === "cognitive")!;
    expect(cognitive.term).toBe(AI_FLAVOR_COGNITIVE_LABEL);
    expect(cognitive.count).toBe(3);
    expect(cognitive.first.line).toBe(1);

    const short = analyzeFlavorWithRepeat("他知道，这不是一次普通的遭遇战。\n", 2);
    expect(short.entries.map((entry) => entry.term)).not.toContain(AI_FLAVOR_COGNITIVE_LABEL);
  });

  it("认知转述也认隔了副词的开头：「他终于明白，」「她这才意识到，」（2026-10-16 加宽）", () => {
    // 旧正则只认「代词 + 动词」紧挨着，把「他终于明白，」这类中间插了副词的写法漏掉了——
    // 样章实测就漏了一处（AI 味报告 0 命中，稿子却带着这股腔）。加宽后这几类都得抓得住。
    const a = analyzeFlavorWithRepeat("他终于明白，那三个词不是威胁。\n", 3);
    expect(a.entries.find((entry) => entry.category === "cognitive")?.count).toBe(3);
    const b = analyzeFlavorWithRepeat("她这才意识到，门一直没关。\n", 3);
    expect(b.entries.find((entry) => entry.category === "cognitive")?.count).toBe(3);
    // 代词后直接跟动词的旧写法照旧抓得住（加宽不是替换）。
    const c = analyzeFlavorWithRepeat("他知道，这不是巧合。\n", 3);
    expect(c.entries.find((entry) => entry.category === "cognitive")?.count).toBe(3);
    // 反例：「他忽然想起」不是认知转述词表里的动词，不该被误伤。
    const d = analyzeFlavorWithRepeat("他忽然想起白天那句闲话。\n", 3);
    expect(d.entries.map((entry) => entry.term)).not.toContain(AI_FLAVOR_COGNITIVE_LABEL);
  });

  it("结构级两类：『不是A，是B 式升华对偶』2 次起报（一章最多一处），「章末总结体」1 次起报（2026-10-16／10-18）", () => {
    // 生成端 DE_AI_FLAVOR_STRUCTURE_INSTRUCTION 写了「禁不是A，是B 式升华对偶」与「章末四禁」，
    // 扫描端此前没有对应判据——写的时候拦一道、写完扫的却是另一份。这两条把它接回来。
    const antithesis = analyzeFlavorWithRepeat("他不是来偷东西的，是来灭灯的。\n", 3);
    const antithesisEntry = antithesis.entries.find(
      (entry) => entry.term === AI_FLAVOR_ANTITHESIS_LABEL
    )!;
    expect(antithesisEntry.count).toBe(3);
    // 类别沿用「议论腔」（替读者下结论的同一族毛病），显示名自成一目。
    expect(antithesisEntry.category).toBe("essay");
    expect(antithesisEntry.first.line).toBe(1);
    // 阈值不跟 essay 的 1 次走，也不跟旧版「3 次」走（2026-10-18 收紧）：起报线 = 生成端 ③
    // 写明的上限（一章最多一处）＋1。偶一用是修辞，放行；第 2 处就是机器味。
    const one = analyzeFlavorWithRepeat("他不是来偷东西的，是来灭灯的。\n", 1);
    expect(one.entries.map((entry) => entry.term)).not.toContain(AI_FLAVOR_ANTITHESIS_LABEL);
    const two = analyzeFlavorWithRepeat("他不是来偷东西的，是来灭灯的。\n", 2);
    expect(two.entries.find((entry) => entry.term === AI_FLAVOR_ANTITHESIS_LABEL)?.count).toBe(2);

    // 章末总结体：一章一个结尾，出现 1 次就已经是章末那股腔。
    const tail = analyzeAiFlavor(["他关上门。这一夜，注定无人入眠。\n"]);
    const tailEntry = tail.entries.find((entry) => entry.term === AI_FLAVOR_TAILCLAUSE_LABEL)!;
    expect(tailEntry.count).toBe(1);
    expect(tailEntry.category).toBe("essay");
    // 反例：正常的「他忽然想起」不是章末总结体，不误伤。
    const clean = analyzeAiFlavor(["他忽然想起白天那句闲话。\n"]);
    expect(clean.entries.map((entry) => entry.term)).not.toContain(AI_FLAVOR_TAILCLAUSE_LABEL);
  });

  it("反差模板：『声音不大，却』2 次起报（2026-10-16，补 deslop 未融合的那一条）", () => {
    // §一百零四 折了 deslop 五条里的四条，把它自己写着「几乎是 AI 的指纹」的
    // 「声音不大，却……」反差模板漏在外面；本刀补上。
    const a = analyzeFlavorWithRepeat("他声音不大，却压住了整个屋子。\n", 2);
    const entry = a.entries.find((e) => e.term === AI_FLAVOR_CONTRAST_LABEL)!;
    expect(entry.count).toBe(2);
    expect(entry.category).toBe("essay");
    expect(entry.first.line).toBe(1);
    // 偶一用是修辞，不到 2 次不报。
    const once = analyzeFlavorWithRepeat("他声音不大，却压住了整个屋子。\n", 1);
    expect(once.entries.map((e) => e.term)).not.toContain(AI_FLAVOR_CONTRAST_LABEL);
    // 反例：没有「却」的反差写法不该被误伤。
    const plain = analyzeFlavorWithRepeat("他声音不大，压住了整个屋子。\n", 3);
    expect(plain.entries.map((e) => e.term)).not.toContain(AI_FLAVOR_CONTRAST_LABEL);
  });

  it("升华对偶判据的召回边界：带主语的「不是X。他是Y」不抓（2026-10-16，§一百零八 实跑核过）", () => {
    // 证据来自真实样章 scratch/flavor-probe/sample-before.md——那句
    // 「老周不是来偷东西的。他是来灭灯的。」是教科书式的升华对偶，但判据要求转折落在
    // 紧挨着「是」的位置上，中间插主语（他）就整条落空。
    // 按 §一百零五 的取舍**不放宽**：放宽（允许中间插代词）会碰上正文里常态的合法构句
    // 「不是A。他是B」，误伤面比召回收益大。这条钉住的是「边界是有意的」，不是「忘了抓」。
    const boundary = analyzeFlavorWithRepeat("老周不是来偷东西的。他是来灭灯的。\n", 3);
    expect(boundary.entries.map((e) => e.term)).not.toContain(AI_FLAVOR_ANTITHESIS_LABEL);
    // 它该抓的那一支确实抓得住，判据不是空的。
    const hit = analyzeFlavorWithRepeat("他不是来偷东西的，是来灭灯的。\n", 3);
    const entry = hit.entries.find((e) => e.term === AI_FLAVOR_ANTITHESIS_LABEL)!;
    expect(entry.count).toBe(3);
  });

  it("密度按千字计；句长均值与波动要够 10 句才算，样本不足回 null 不编数", () => {
    const body = "他嘴角勾起一抹笑。".repeat(6); // 每句 9 字（含句号），共 6 句
    const report = analyzeAiFlavor([body]);
    expect(report.charCount).toBe(body.length);
    expect(report.perThousand).toBeGreaterThan(0);
    expect(report.meanSentenceLength).toBeNull();
    expect(report.sentenceSpread).toBeNull();

    const rich = analyzeAiFlavor([
      "他嘴角勾起一抹令人不易察觉的弧度，眼底闪过一丝复杂的情绪。她跑得飞快。天黑了。风很大。灯灭了。\n门开了。猫叫了。雨停了。他走了。她笑了。\n"
    ]);
    expect(rich.meanSentenceLength).not.toBeNull();
    expect(rich.sentenceSpread).not.toBeNull();
    // 一句长的混一堆短的，波动应该明显大于 0。
    expect(rich.sentenceSpread!).toBeGreaterThan(0.3);
  });

  it("报告封顶不倾倒；空书回空报告", () => {
    const empty = analyzeAiFlavor([]);
    expect(empty.entries).toEqual([]);
    expect(empty.totalHits).toBe(0);
    expect(empty.perThousand).toBe(0);
    expect(empty.meanSentenceLength).toBeNull();
  });
});

describe("ai-flavor · 情绪直陈句式（2026-10-18，与生成端叙事手法同一批）", () => {
  it("「感到／涌起＋情绪词」按句式计，3 次起报，报固定名目、类别沿用议论腔", () => {
    const a = analyzeFlavorWithRepeat("他感到一阵愤怒。\n", 3);
    const entry = a.entries.find((e) => e.term === AI_FLAVOR_EMOTION_LABEL)!;
    expect(entry.count).toBe(3);
    expect(entry.category).toBe("essay");
    expect(entry.first.line).toBe(1);
    // 偶发一处是正常行文，不到 3 次不报（同认知转述）。
    const once = analyzeFlavorWithRepeat("他感到一阵愤怒。\n", 1);
    expect(once.entries.map((e) => e.term)).not.toContain(AI_FLAVOR_EMOTION_LABEL);
  });

  it("认多种构式：涌起／泛起／充满 ＋ 情绪词", () => {
    const b = analyzeFlavorWithRepeat("心中涌起一股酸楚。\n", 3);
    expect(b.entries.find((e) => e.term === AI_FLAVOR_EMOTION_LABEL)?.count).toBe(3);
    const c = analyzeFlavorWithRepeat("内心充满愧疚。\n", 3);
    expect(c.entries.find((e) => e.term === AI_FLAVOR_EMOTION_LABEL)?.count).toBe(3);
  });

  it("反例：演出来的情绪不误伤（情绪词不带「感到／涌起」构式不报）", () => {
    // 「他不安地攥紧了手」是演情绪，不是直陈；「他很愤怒」要读句子主语才判得准，留给人工判读。
    const a = analyzeFlavorWithRepeat("他不安地攥紧了手。\n", 4);
    expect(a.entries.map((e) => e.term)).not.toContain(AI_FLAVOR_EMOTION_LABEL);
    const b = analyzeFlavorWithRepeat("他很愤怒。\n", 4);
    expect(b.entries.map((e) => e.term)).not.toContain(AI_FLAVOR_EMOTION_LABEL);
  });

  it("退稿闸同批认这条（不抄第二份判据）", () => {
    const text = ("他感到一阵愤怒。" + "船在雾里靠岸，缆绳松了。").repeat(8);
    const verdict = aiFlavorGate(text);
    expect(verdict.topTerms.join("、")).toContain(AI_FLAVOR_EMOTION_LABEL);
  });
});

/** 造「同一行重复 n 遍」的书稿——阈值类用例的公共脚手架。 */
function analyzeFlavorWithRepeat(line: string, n: number) {
  return analyzeAiFlavor([Array.from({ length: n }, () => line).join("")]);
}

/**
 * 干净铺底（15 句 / 206 字，过 `AI_FLAVOR_GATE.minChars`）：句首逐句轮换、句长错落、零词命中。
 * 结构上限类的用例得先有一条「密度/句首/句长三条老理由都不成立」的底稿，
 * 才能证明那一发是**新那条**拦的，不是老三条顺手拦下来的。
 */
const CLEAN_FILLER =
  "山醒了。溪水涨了，哗哗地漫过河滩上的青石，一路往下游赶。" +
  "月出来了。风停了，吹得檐下那串干辣椒打着转。" +
  "雪落在蓑衣上，积了薄薄一层。屋檐下挂着两串干辣椒。" +
  "狗在门边卧着。灶膛里的火星噼啪响了两声又暗下去。" +
  "灯芯挑亮了。夜还很长，长得像一条没有尽头的河。" +
  "窗纸透进一线凉气。井台上的水桶结了一层薄冰。" +
  "墙根下堆着去年的柴，一直码到齐腰高。" +
  "门后的蓑衣还滴着水，滴在青石板上，一声一声。" +
  "檐角挂着的铜铃被风碰了一下，又没了动静。";

describe("ai-flavor · 对话标签句式（2026-10-19，与生成端对话写法同一批）", () => {
  // 四稿实测：把贴着引号的「××说」从 10+ 处压到 3 处，外部检测器的人工创作特征就从 59% 拉到 100%。
  // 生成端因此写死上限「一章最多三处」；这条判据与退稿闸同吃同一枚数字（起报线 = 上限＋1 = 4）。

  it("贴着引号的「××说／说道」按句式计，4 次起报（上限三处＋1），报固定名目、类别沿用议论腔", () => {
    const entry = analyzeFlavorWithRepeat("「喝吧。」她说。\n", 4).entries.find(
      (e) => e.term === AI_FLAVOR_DIALOGUE_TAG_LABEL
    )!;
    expect(entry.count).toBe(4);
    expect(entry.category).toBe("essay");
    expect(entry.first.line).toBe(1);
    // 上限之内（3 处）不报——那是生成端写明的合法额度。
    const three = analyzeFlavorWithRepeat("「喝吧。」她说。\n", 3);
    expect(three.entries.map((e) => e.term)).not.toContain(AI_FLAVOR_DIALOGUE_TAG_LABEL);
  });

  it("另一种贴身构式：说：后紧跟引号（他说：「……」）照样计", () => {
    const b = analyzeFlavorWithRepeat("他说：「你先喝。」\n", 4);
    expect(b.entries.find((e) => e.term === AI_FLAVOR_DIALOGUE_TAG_LABEL)?.count).toBe(4);
  });

  it("召回边界（有意留的）：不贴引号的「说」一概不抓——说明／他这么一说／听说", () => {
    // 放宽到「任意 ××说」会把正文里常态的合法构句连同「他这么一说，」一起咬进来，
    // 误伤面比召回收益大（同 §一百零五 取舍）。这条钉的是「边界是有意的」，不是「忘了抓」。
    for (const line of [
      "他说明了来意，然后转身走了。\n",
      "他这么一说，满屋人都笑了。\n",
      "听说城南的渡口要封了。\n"
    ]) {
      const report = analyzeFlavorWithRepeat(line, 5);
      expect(report.entries.map((e) => e.term)).not.toContain(AI_FLAVOR_DIALOGUE_TAG_LABEL);
    }
  });

  it("退稿闸同批认这条并进闸：一行 3 处放行，第 4 处退稿（干净铺底证明是新条拦的）", () => {
    const threeTags = "「喝吧。」她说。「你不喝？」他说道。「随你。」她说。";
    const three = aiFlavorGate(CLEAN_FILLER + threeTags);
    expect(three.structureOver).toEqual([]);
    expect(three.pass).toBe(true);
    const four = aiFlavorGate(CLEAN_FILLER + threeTags + "「我去添壶水。」她说。");
    expect(four.structureOver).toEqual([AI_FLAVOR_DIALOGUE_TAG_LABEL]);
    expect(four.pass).toBe(false);
    // 证明是结构上限拦的，不是老四条：重罪数不到密度门槛，句首轮换、句长错落、无复读。
    expect(four.hits).toBeLessThan(AI_FLAVOR_GATE.minHits);
    expect(four.startRepeat).toBeNull();
    expect(four.flatRhythm).toBeNull();
    expect(four.repeatOver).toEqual([]);
  });
});

describe("ai-flavor · aiFlavorGate 自动退稿闸", () => {
  it("重度超标拦下：pass=false，topTerms 按次数排序给前 5", () => {
    const heavy = "他嘴角勾起，眼底闪过一丝复杂的情绪。他知道，这不是巧合。".repeat(15);
    const verdict = aiFlavorGate(heavy);
    expect(verdict.pass).toBe(false);
    expect(verdict.hits).toBeGreaterThanOrEqual(30);
    expect(verdict.perThousand).toBeGreaterThan(5);
    expect(verdict.topTerms[0]).toContain("嘴角勾起");
    expect(verdict.topTerms.length).toBeLessThanOrEqual(5);
  });

  it("轻度 / 短文本放行：闸是质量下限，不是文风警察", () => {
    // 轻度：长短句错落的正常叙述里偶发一处套话——密度到不了阈值，
    // 句长波动也远够不着「句句等长」的判线（六段加的那条）。
    const mild =
      "他推开院门，把锄头靠在墙边。灶间的火苗窜起来，锅里的粥咕嘟作响。天黑了。" +
      "风从篱笆的缺口灌进来，吹得那串干辣椒轻轻打转，像谁在数一串旧年的念珠。" +
      "他把碗摆上桌。粥还烫。隔壁的狗叫了两声，又安静下去。" +
      "他忽然想起白天在集市上听见的那句闲话——城南的渡口要封了，官船三日不发。" +
      "夜里的更声远远传来。他睡了。" +
      "第二天鸡还没叫，他就已经在田里了，露水打湿了裤脚也没察觉。" +
      "巷口的磨刀人又吆喝起来，一声长一声短，跟去年冬天一模一样。" +
      "他嘴角勾起。\n";
    expect(aiFlavorGate(mild).pass).toBe(true);
    // 短文本：样本太少密度失真，直接放。
    expect(aiFlavorGate("他嘴角勾起，眼底闪过一丝惊讶。他知道，这不是巧合。").pass).toBe(true);
    // 空串放行。
    expect(aiFlavorGate("").pass).toBe(true);
  });

  it("副词不算重罪：只堆副词不拦（与体检口径分工）", () => {
    // 样本开头字必须轮换（五段起「开头复读」是独立拦稿理由），句长也必须错落
    // （六段起「句长过匀」是另一条独立理由），句子还必须句句不同（2026-10-18 起「复读」
    // 又是一条独立理由）——三条老样本都踩过：旧版「五句一循环 ×6 遍」零词命中也会被节奏条拦下，
    // 那不是本用例要测的事（本用例只测「副词不进重罪」）。
    const adverbsOnly = [
      "山缓缓退进雾里。",
      "路尽头静静立着块界石，字迹被风雨磨平了，谁也认不出上面刻的是哪一年立的。",
      "灯微微晃着。",
      "茶凉了，他不由得又添了一勺热水，端起来抿了一口，又放下。",
      "他默默把锄头靠在墙角。",
      "她把针线收进木匣，深深叹了口气，把匣子推到桌角。",
      "风穿过篱笆。",
      "雨下了半夜，檐下的水缸渐渐满了，水面浮着几片被打落的叶子。",
      "霜落在瓦上。",
      "雪静静地压在柴垛上，压出一道弯弯的弧，像谁搁在那里的白毡。",
      "桥下的水缓缓流着。",
      "船不由得偏向岸边，橹声乱了，船夫把篙伸进水里撑了撑。",
      "井台的石板结了冰，滑得很。",
      "墙根堆着柴。",
      "门后挂着的蓑衣还滴着水，滴答滴答，滴在青石板上，一声一声。",
      "窗纸透进一线凉气。",
      "檐角的铜铃被风碰了一下，又没了动静。",
      "灶膛里的火星噼啪响了两声。",
      "锅里的粥咕嘟作响，冒着白气。",
      "狗卧在门边。",
      "鸡叫了头遍，天边还是一片灰。",
      "夜很长，长得像一条没有尽头的河，一直流到天亮。",
      "月出来了。",
      "星子稀稀落落，像是没挂稳。",
      "云压得很低。",
      "江水静静地涨上来，漫过石阶，又退回去一点，来回几趟。",
      "石板路上积了水。",
      "竹林里的风一停，整片林子就静了。",
      "松针落了一地，踩上去软软的。",
      "藤蔓爬满了半面墙，把窗子遮去一角。"
    ].join("");
    const verdict = aiFlavorGate(adverbsOnly);
    expect(verdict.hits).toBe(0);
    expect(verdict.startRepeat).toBeNull();
    expect(verdict.flatRhythm).toBeNull();
    expect(verdict.repeatOver).toEqual([]);
    expect(verdict.pass).toBe(true);
  });

  it("结构级两类也进闸：『不是A，是B 升华对偶』与『章末总结体』（2026-10-16，与体检同一批正则）", () => {
    // 与 analyzeAiFlavor 同一份正则、同一批 label——闸不抄第二份判据。
    const text = (
      "他不是来偷东西的，是来灭灯的。" +
      "船在雾里靠岸。" +
      "这一夜，注定无人入眠。"
    ).repeat(8);
    const verdict = aiFlavorGate(text);
    const terms = verdict.topTerms.join("、");
    expect(terms).toContain(AI_FLAVOR_ANTITHESIS_LABEL);
    expect(terms).toContain(AI_FLAVOR_TAILCLAUSE_LABEL);
    expect(verdict.pass).toBe(false);
  });

  it("反差模板也进闸（与体检同一批正则，2026-10-16）", () => {
    const text = ("他声音不大，却压住了整个屋子。" + "船在雾里靠岸，缆绳松了。").repeat(8);
    const verdict = aiFlavorGate(text);
    expect(verdict.topTerms.join("、")).toContain(AI_FLAVOR_CONTRAST_LABEL);
  });

  it("对偶一章最多一处：1 处放行，第 2 处退稿（2026-10-18 收紧，兜住生成端 ③ 的上限）", () => {
    // 底稿是干净 200+ 字（见 CLEAN_FILLER）——这一发只可能是结构上限拦的。
    const once = aiFlavorGate(CLEAN_FILLER + "他不是来偷东西的，是来灭灯的。");
    expect(once.structureOver).toEqual([]);
    expect(once.pass).toBe(true);

    const twice = aiFlavorGate(
      CLEAN_FILLER + "他不是来偷东西的，是来灭灯的。这船不是来送货的，是来接人的。"
    );
    expect(twice.structureOver).toEqual([AI_FLAVOR_ANTITHESIS_LABEL]);
    expect(twice.pass).toBe(false);
    // 证明是结构上限拦的，不是老三条：重罪数不到密度闸门槛，句首轮换、句长错落都正常。
    expect(twice.hits).toBeLessThan(AI_FLAVOR_GATE.minHits);
    expect(twice.startRepeat).toBeNull();
    expect(twice.flatRhythm).toBeNull();
  });

  it("结构上限只咬生成端写明数值上限的那几条：章末体 1 处仍放行（闸不越界当文风警察）", () => {
    // 章末体的体检起报线是 1（一章一个结尾就会出现那股腔），但那条线是给报告看的：
    // 搬进闸会把「人生就是这样」这类正常对话句也退稿。所以它只报不拦——进闸清单只有
    // 生成端写死数值上限的那两条（对偶「一章最多一处」、对话标签「一章最多三处」）。
    expect(AI_FLAVOR_STRUCTURE_GATED_LABELS).toEqual([
      AI_FLAVOR_ANTITHESIS_LABEL,
      AI_FLAVOR_DIALOGUE_TAG_LABEL
    ]);
    const verdict = aiFlavorGate(CLEAN_FILLER + "他关上门。这一夜，注定无人入眠。");
    expect(verdict.topTerms.join("、")).toContain(AI_FLAVOR_TAILCLAUSE_LABEL);
    expect(verdict.structureOver).toEqual([]);
    expect(verdict.pass).toBe(true);
  });
});

describe("ai-flavor · sentenceRhythmOf（句长节奏，六段）", () => {
  const HEADS = "山水风月云星雪夜晨昏江河湖海春秋烟霞灯桥船笛";

  it("不足 10 句回 null，不编数", () => {
    expect(sentenceRhythmOf("山后有座青石桥。桥下流水不息。")).toBeNull();
    expect(SENTENCE_SPREAD_MIN_SENTENCES).toBe(10);
  });

  it("句句等长 → spread 为 0；长短错落 → spread 明显大于 0", () => {
    const uniform = Array.from(
      { length: 12 },
      (_, i) => `${HEADS[i]}村的少年天不亮就起了床。`
    ).join("");
    const rhythm = sentenceRhythmOf(uniform)!;
    expect(rhythm.mean).toBe(13);
    expect(rhythm.spread).toBe(0);

    const mixed =
      "山醒了。溪水涨了，哗哗地漫过河滩上的青石，一路往下游赶。" +
      "月出来了。风停了。雪落在昨夜还没来得及收进屋的那件蓑衣上，积了薄薄一层。" +
      "屋檐下挂着两串干辣椒。狗在门边卧着。灶膛里的火星噼啪响了两声又暗下去。灯芯挑亮了。夜还很长。";
    const varied = sentenceRhythmOf(mixed)!;
    expect(varied.spread).toBeGreaterThan(0.3);
  });

  it("退稿闸第三条独立理由：词命中为零、起手轮换，句句等长照样拦", () => {
    const uniform = Array.from(
      { length: 20 },
      (_, i) => `${HEADS[i]}村的少年天不亮就起了床。`
    ).join("");
    const verdict = aiFlavorGate(uniform);
    expect(verdict.hits).toBe(0);
    expect(verdict.startRepeat).toBeNull();
    expect(verdict.flatRhythm).toEqual({ mean: 13, spread: 0 });
    expect(verdict.pass).toBe(false);
  });

  it("长短错落的干净稿子放行：flatRhythm 为 null", () => {
    const heads = "山水风月云星雪夜晨昏江河湖海春秋烟霞灯桥船笛";
    const mixed = Array.from({ length: 10 }, (_, i) => {
      const head = heads[i * 2]!;
      return `${head}村在雨里睡了。${heads[i * 2 + 1]}村的少年们踏着露水爬上了后山的茶园。`;
    }).join("");
    const verdict = aiFlavorGate(mixed);
    expect(verdict.hits).toBe(0);
    expect(verdict.startRepeat).toBeNull();
    expect(verdict.flatRhythm).toBeNull();
    expect(verdict.pass).toBe(true);
  });

  it("短文本不吃句长条：minChars 内直接放行（样本太少失真）", () => {
    const uniform = Array.from(
      { length: 12 },
      (_, i) => `${HEADS[i]}村的少年天不亮就起了床。`
    ).join("");
    expect(uniform.length).toBeLessThan(200);
    const verdict = aiFlavorGate(uniform);
    expect(verdict.pass).toBe(true);
    expect(verdict.flatRhythm).toBeNull();
  });
});

describe("ai-flavor · textSimilarity（换汤不换药检测）", () => {
  it("同串 1；换几个词仍极高；真重写明显低", () => {
    const base = "他嘴角勾起，眼底闪过一丝复杂的情绪。他知道，这不是巧合。".repeat(10);
    expect(textSimilarity(base, base)).toBe(1);
    // 只换了两个词的重写（26 字句换 2 处）：bigram 大半保留 ⇒ 实测约 0.80。
    // 「换汤不换药」判线取 0.75（阈值由调用方定），不是 0.9——那要一个字都没动才够得着。
    const cosmetic = base.replace(/嘴角勾起/g, "嘴角扬起").replace(/这不是巧合/g, "并非巧合");
    expect(textSimilarity(base, cosmetic)).toBeGreaterThan(0.75);
    // 真换了写法：动作与对话主导的新段。
    const rewritten = '他把刀拍在桌上。"别绕弯子。"她说："你先喝。"两个人都没碰杯子。'.repeat(12);
    expect(textSimilarity(base, rewritten)).toBeLessThan(0.3);
  });

  it("空串返回 0；单字同串是 1（同串判定在前）、异字是 0", () => {
    expect(textSimilarity("", "anything")).toBe(0);
    expect(textSimilarity("字", "字")).toBe(1);
    expect(textSimilarity("字", "词")).toBe(0);
  });
});

describe("ai-flavor · sentenceStartRepeat（句式开头复读）", () => {
  it("十句九句「他」开头 → 触发，带字/次数/占比；对话行不算进判定", () => {
    // 8 句叙述全「他」开头（达标），混 3 句对话行（排除在分母外）。
    const text =
      "他推开院门。他放下锄头。他灶间生火。他看了眼米缸。他添了半瓢水。他坐下等开锅。他听见雨声。他想起了白天的事。".replace(
        /他/g,
        (m, i) => (i === 0 ? "他" : m)
      ) + "「喝吧。」她把碗推过去。「你不喝？」他摇头。「随你。」";
    const repeat = sentenceStartRepeat(text);
    expect(repeat).not.toBeNull();
    expect(repeat!.char).toBe("他");
    expect(repeat!.total).toBe(8);
    expect(repeat!.ratio).toBe(1);
  });

  it("开头字正常轮换 / 样本不足 / 短文本 → 不触发", () => {
    const mixed = "他推门。灶上坐了水。雨还没停。她没说话。锅先响了。他坐下。门缝里灌风。夜还长。";
    expect(sentenceStartRepeat(mixed)).toBeNull();
    // 只有 4 句叙述：不到 minSentences。
    expect(sentenceStartRepeat("他走。他停。他回头。他笑了。他坐下。他等。")).toBeNull();
    expect(sentenceStartRepeat("")).toBeNull();
  });
});

describe("ai-flavor · repeatedSentences ＋ 复读闸（2026-10-18）", () => {
  // 真机取证里那份 3201 行、3199 行同句的产物，就是这一条要收的病：
  // 「林潮生沿着码头往深处走，咸雾一层层漫上来，灯影在水里碎成金箔。」原样写了三千遍。
  const REPEAT_LINE = "林潮生沿着码头往深处走，咸雾一层层漫上来，灯影在水里碎成金箔。";
  const OTHER_LINE = "船在雾里靠了岸，缆绳松开又绷紧，甲板上全是湿的。";

  it("同一句出现 ≥2 次入表，带次数与篇序；短句重复与孤句不入", () => {
    const rows = repeatedSentences([
      `${REPEAT_LINE}别的句子。\n`,
      `${REPEAT_LINE}${REPEAT_LINE}\n`
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sentence: REPEAT_LINE, count: 3, docIndexes: [0, 1] });
    // 短句重复（「他点了点头」级口头禅）与只出现一次的长句都不入表。
    expect(repeatedSentences(["他点了点头，笑了笑。\n他点了点头，笑了笑。\n"])).toHaveLength(0);
    expect(repeatedSentences([`${REPEAT_LINE}\n`])).toHaveLength(0);
  });

  it("按次数降序；minChars 可下调（巡检面板与退稿闸同吃这一份切句）", () => {
    const rows = repeatedSentences([
      `${REPEAT_LINE}${REPEAT_LINE}${REPEAT_LINE}${OTHER_LINE}${OTHER_LINE}\n`,
      `${REPEAT_LINE}${OTHER_LINE}\n`
    ]);
    expect(rows.map((row) => row.count)).toEqual([4, 3]);
    // 默认 12 字以下的短句不收；下调阈值才收。
    const short = "他笑了。他笑了。";
    expect(repeatedSentences([short])).toHaveLength(0);
    expect(repeatedSentences([short], 4).map((row) => row.count)).toEqual([2]);
  });

  it("退稿闸第五条独立理由：同一句原样写三遍 → 拦（干净铺底证明是新条拦的）", () => {
    const three = aiFlavorGate(CLEAN_FILLER + REPEAT_LINE + REPEAT_LINE + REPEAT_LINE);
    expect(three.repeatOver.map((row) => row.sentence)).toEqual([REPEAT_LINE]);
    expect(three.repeatOver[0]!.count).toBe(3);
    expect(three.pass).toBe(false);
    // 证明是复读条拦的，不是老四条：重罪数不到密度门槛，句首轮换、句长错落、无结构超限。
    expect(three.hits).toBeLessThan(AI_FLAVOR_GATE.minHits);
    expect(three.startRepeat).toBeNull();
    expect(three.flatRhythm).toBeNull();
    expect(three.structureOver).toEqual([]);
  });

  it("有意复沓的余地：同一句两次放行（判退线 3 次 = 生成端上限 2 ＋1）", () => {
    const twice = aiFlavorGate(CLEAN_FILLER + REPEAT_LINE + REPEAT_LINE);
    expect(twice.repeatOver).toEqual([]);
    expect(twice.pass).toBe(true);
    expect(AI_FLAVOR_REPEAT.gateMinCount).toBe(3);
  });

  it("两种句式 A B 交替打转（句首占比约 0.5 逃逸 startRepeat）→ 复读条照样拦", () => {
    // 洞 1 的回归：各句开头字轮换、长短也错落，老四条全不成立，只有「同一句反复出现」看得出来。
    const a = "船在雾里慢慢地靠了岸，缆绳松开又绷紧。";
    const b = "灯影在水面碎成一片一片的金箔，风把咸腥气送过来。";
    const verdict = aiFlavorGate(CLEAN_FILLER + [a, b, a, b, a, b].join(""));
    expect(verdict.repeatOver.map((row) => row.count)).toEqual([3, 3]);
    expect(verdict.pass).toBe(false);
    expect(verdict.startRepeat).toBeNull();
    expect(verdict.flatRhythm).toBeNull();
  });
});

describe("ai-flavor · 对话标签的引号覆盖面（2026-10-19 真机复验暴露的召回裂缝）", () => {
  // 真机复验拿到的那章正文用半角直引号 `"`（66 个）、`「」『』` 一个没有——旧判据
  // （`AI_FLAVOR_DIALOGUE_TAG_PATTERN` 第 1 支只认 `」』` 收尾）对真实正文**召回为 0**：
  // 是判据匹配不到，不是模型真避开。本组按真机实证补上引号覆盖面。
  //
  // 半角 `"` 开闭同形，**不能裸并进收尾类**：`"他说过不会来。"` 里第一个 `"` 是**开**引号，
  // 裸并会把引号内的转述误判成标签。故按**行内奇偶**归一（`"` 奇 → `“` 开、偶 → `”` 闭），
  // 正则再收弯引号 `“”`；归一与正则只此一份，analyzeAiFlavor / aiFlavorGate 共用。

  it("半角直引号：闭引号后的「××说」计得到（一处不报、4 处起报）", () => {
    const line = '"喝吧。"他说。\n';
    const four = analyzeFlavorWithRepeat(line, 4);
    expect(four.entries.find((e) => e.term === AI_FLAVOR_DIALOGUE_TAG_LABEL)?.count).toBe(4);
    // 归一是逐行做的：第 1 个 `"` → `“`、第 2 个 → `”`，`”他说` 才落进第 1 支。
    const one = analyzeFlavorWithRepeat(line, 1);
    expect(one.entries.map((e) => e.term)).not.toContain(AI_FLAVOR_DIALOGUE_TAG_LABEL);
  });

  it('开引号内的转述不误报：`"他说过不会来。"` 一处都不算（奇偶归一正是为挡这一刀）', () => {
    const line = '"他说过不会来。"\n';
    const report = analyzeFlavorWithRepeat(line, 5);
    expect(report.entries.map((e) => e.term)).not.toContain(AI_FLAVOR_DIALOGUE_TAG_LABEL);
  });

  it("弯引号 `“”` 同计（旧判据只认 `」』`，弯引号正文同样整条落空）", () => {
    const line = "“喝吧。”他说。\n";
    const four = analyzeFlavorWithRepeat(line, 4);
    expect(four.entries.find((e) => e.term === AI_FLAVOR_DIALOGUE_TAG_LABEL)?.count).toBe(4);
  });

  it('半角直引号的另一种贴身构式照样计：说：后紧跟 `"`（`他说："你先喝。"`）', () => {
    const line = '他说："你先喝。"\n';
    const four = analyzeFlavorWithRepeat(line, 4);
    expect(four.entries.find((e) => e.term === AI_FLAVOR_DIALOGUE_TAG_LABEL)?.count).toBe(4);
  });

  it("退稿闸同口径（同一枚数字）：半角直引号一行 3 处放行，第 4 处退稿", () => {
    const threeTags = '"喝吧。"她说。"你不喝？"他说道。"随你。"她说。';
    const three = aiFlavorGate(CLEAN_FILLER + threeTags);
    expect(three.structureOver).toEqual([]);
    expect(three.pass).toBe(true);
    const four = aiFlavorGate(CLEAN_FILLER + threeTags + '"我去添壶水。"她说。');
    expect(four.structureOver).toEqual([AI_FLAVOR_DIALOGUE_TAG_LABEL]);
    expect(four.pass).toBe(false);
    // 证明是新条拦的，不是老四条：重罪数不到密度门槛，句首轮换、句长错落、无复读。
    expect(four.hits).toBeLessThan(AI_FLAVOR_GATE.minHits);
    expect(four.startRepeat).toBeNull();
    expect(four.flatRhythm).toBeNull();
    expect(four.repeatOver).toEqual([]);
  });
});
