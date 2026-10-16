import { describe, expect, it } from "vitest";
import {
  AI_FLAVOR_ANTITHESIS_LABEL,
  AI_FLAVOR_CATEGORY_LABELS,
  AI_FLAVOR_COGNITIVE_LABEL,
  AI_FLAVOR_CONTRAST_LABEL,
  AI_FLAVOR_TAILCLAUSE_LABEL,
  AI_FLAVOR_TERMS,
  aiFlavorGate,
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

  it("结构级两类：『不是A，是B 式升华对偶』3 次起报，「章末总结体」1 次起报（2026-10-16，与生成端同一批）", () => {
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
    // 阈值不跟 essay 的 1 次走：偶一用是修辞，3 次起才是机器味。
    const short = analyzeFlavorWithRepeat("他不是来偷东西的，是来灭灯的。\n", 2);
    expect(short.entries.map((entry) => entry.term)).not.toContain(AI_FLAVOR_ANTITHESIS_LABEL);

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

/** 造「同一行重复 n 遍」的书稿——阈值类用例的公共脚手架。 */
function analyzeFlavorWithRepeat(line: string, n: number) {
  return analyzeAiFlavor([Array.from({ length: n }, () => line).join("")]);
}

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
    // 样本开头字必须轮换（五段起「开头复读」是独立拦稿理由），
    // 句长也必须错落（六段起「句长过匀」是另一条独立理由）——
    // 旧样本五句一组循环复读，零词命中也会被两条节奏条拦下，那不是本用例要测的事。
    const adverbsOnly = [
      "他缓缓地走。",
      "路静静延伸，一直延伸到看不见的地方。",
      "她淡淡应了一声，不禁皱眉。",
      "灯微微晃动，悄然熄了。",
      "茶不由得凉透了。"
    ]
      .join("")
      .repeat(6);
    const verdict = aiFlavorGate(adverbsOnly);
    expect(verdict.hits).toBe(0);
    expect(verdict.startRepeat).toBeNull();
    expect(verdict.flatRhythm).toBeNull();
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
