/**
 * AI 味词库与判定（2026-10-10）：中文小说里「一眼机器味」的写法清单 + 全书扫描。
 *
 * 两端同吃这一份（单一真身）：
 * - 检测端：书稿体检的第五类「AI 味扫描」，逐处报数、点条目直达原文；
 * - 生成端：AI 智能体系统提示词的「文风硬约束」段——写的时候就拦一道，
 *   词表从这份清单拼出来，提示词里禁的词和体检里报的词永远对得上。
 *
 * 四类口径（阈值都是启发式：宁可标「疑似」，最终判断交给人）：
 * - cliche    描写套话——「嘴角勾起」「眼底闪过」这类模板化神态动作，出现 2 次起报；
 * - essay     议论腔——「众所周知」「与此同时」这类报告腔，小说里出现 1 次就报；
 * - adverb    副词滥用——「缓缓」「微微」不是错词，堆多了才是机器味，5 次起报；
 * - cognitive 认知转述——「他知道，……」「她明白，这不是……」句式，3 次起报；
 * - 结构级三类（复用 essay 类别、阈值另设）——不是A，是B 式升华对偶 3 次起报、章末总结体 1 次起报、
 *   「声音不大，却……」反差模板 2 次起报。
 * - 情绪直陈（同上按句式计，2026-10-18）——「感到／涌起＋情绪词」3 次起报。
 *
 * 已知重叠：套话里含副词（「嘴角微微上扬」同时命中「微微」）会各计一次，
 * 是可接受的启发式误差——两处都值得作者看一眼。
 */

export type AiFlavorCategory = "cliche" | "essay" | "adverb" | "cognitive";

export interface AiFlavorTerm {
  term: string;
  category: AiFlavorCategory;
}

export const AI_FLAVOR_TERMS: readonly AiFlavorTerm[] = [
  // ── 描写套话（cliche）──
  { term: "嘴角勾起", category: "cliche" },
  { term: "勾起一抹", category: "cliche" },
  { term: "露出一抹", category: "cliche" },
  { term: "浮现一抹", category: "cliche" },
  { term: "浮起一抹", category: "cliche" },
  { term: "绽放一抹", category: "cliche" },
  { term: "嘴角微微上扬", category: "cliche" },
  { term: "唇角微扬", category: "cliche" },
  { term: "眼底闪过", category: "cliche" },
  { term: "眼中闪过", category: "cliche" },
  { term: "眼里闪过", category: "cliche" },
  { term: "闪过一丝", category: "cliche" },
  { term: "闪过一抹", category: "cliche" },
  { term: "掠过一丝", category: "cliche" },
  { term: "掠过一抹", category: "cliche" },
  { term: "划过一丝", category: "cliche" },
  { term: "涌起一股", category: "cliche" },
  { term: "涌上一股", category: "cliche" },
  { term: "泛起一丝", category: "cliche" },
  { term: "泛起一阵", category: "cliche" },
  { term: "心头一紧", category: "cliche" },
  { term: "心中一凛", category: "cliche" },
  { term: "心中一动", category: "cliche" },
  { term: "心头一震", category: "cliche" },
  { term: "心头一暖", category: "cliche" },
  { term: "心头微沉", category: "cliche" },
  { term: "深吸一口气", category: "cliche" },
  { term: "吸了一口气", category: "cliche" },
  { term: "呼出一口气", category: "cliche" },
  { term: "空气仿佛凝固", category: "cliche" },
  { term: "空气瞬间凝固", category: "cliche" },
  { term: "气氛瞬间凝固", category: "cliche" },
  { term: "目光深邃", category: "cliche" },
  { term: "眼神复杂", category: "cliche" },
  { term: "目光复杂", category: "cliche" },
  { term: "眼神交汇", category: "cliche" },
  { term: "意味深长", category: "cliche" },
  { term: "眸光闪烁", category: "cliche" },
  { term: "眸光一暗", category: "cliche" },
  { term: "眸色微沉", category: "cliche" },
  { term: "眸光微动", category: "cliche" },
  { term: "不易察觉", category: "cliche" },
  // ── 概括情绪（cliche，2026-10-18）：把人物的情绪直接命名出来，替代「演情绪」的懒写法 ——
  { term: "百感交集", category: "cliche" },
  { term: "五味杂陈", category: "cliche" },
  { term: "心情复杂", category: "cliche" },
  { term: "心潮澎湃", category: "cliche" },
  { term: "思绪万千", category: "cliche" },
  { term: "感慨万千", category: "cliche" },
  { term: "心如刀割", category: "cliche" },
  { term: "热泪盈眶", category: "cliche" },
  // ── 空泛环境套话（cliche，2026-10-18）：写的是作者的心情，不是这个地方的样子 ——
  { term: "夜色深沉", category: "cliche" },
  { term: "夜色如墨", category: "cliche" },
  { term: "寒风刺骨", category: "cliche" },
  { term: "寒风凛冽", category: "cliche" },
  { term: "灯火阑珊", category: "cliche" },
  { term: "月光如水", category: "cliche" },
  { term: "万籁俱寂", category: "cliche" },
  // ── 议论腔（essay）──
  { term: "众所周知", category: "essay" },
  { term: "值得注意的是", category: "essay" },
  { term: "值得一提的是", category: "essay" },
  { term: "总而言之", category: "essay" },
  { term: "综上所述", category: "essay" },
  { term: "换句话说", category: "essay" },
  { term: "与此同时", category: "essay" },
  { term: "从某种意义上", category: "essay" },
  { term: "在某种程度上", category: "essay" },
  { term: "归根结底", category: "essay" },
  { term: "毋庸置疑", category: "essay" },
  { term: "不难发现", category: "essay" },
  { term: "由此可见", category: "essay" },
  { term: "说到底", category: "essay" },
  { term: "这或许就是", category: "essay" },
  { term: "仿佛在诉说", category: "essay" },
  { term: "像是在诉说", category: "essay" },
  { term: "似乎在诉说", category: "essay" },
  // ── 副词滥用（adverb）──
  { term: "不禁", category: "adverb" },
  { term: "不由得", category: "adverb" },
  { term: "不由自主", category: "adverb" },
  { term: "缓缓", category: "adverb" },
  { term: "轻轻", category: "adverb" },
  { term: "静静", category: "adverb" },
  { term: "默默", category: "adverb" },
  { term: "深深", category: "adverb" },
  { term: "淡淡", category: "adverb" },
  { term: "微微", category: "adverb" },
  { term: "悄然", category: "adverb" }
];

/**
 * 认知转述句式（词表外的第五类，按正则计）：「他知道，」「她明白，」这类开头。
 * 2026-10-16 加宽：中间可以插副词——「他终于明白，」是同一种毛病，旧正则却漏掉：
 * 它只认「代词 + 动词」紧挨着，中间插一个「终于」就整条落空。加宽只放中间那截副词，
 * 动词表仍是原样那几个，免得把「他忽然想起」这类正常心理描写也一并咬进来。
 *
 * 这一版仍按**代词**起头，所以「阿栈终于明白，」这种主语是人名的转述它抓不到——
 * 那是这条判据本身的边界，不是这次没修干净；写在这里免得下一个人误以为已经全覆盖。
 */
export const AI_FLAVOR_COGNITIVE_PATTERN =
  /(他|她)(?:终于|这才|忽然|突然|方才|此刻|随即){0,2}(知道|明白|清楚|意识到|察觉)，/g;

/** 界面与报告里认知转述条目的显示名（它不是一个固定词，报的是句式）。 */
export const AI_FLAVOR_COGNITIVE_LABEL = "他知道，/她明白，式转述";

/**
 * 结构级机器味的三类（2026-10-16，与生成端 DE_AI_FLAVOR_STRUCTURE_INSTRUCTION 同一批）：
 * 词库管「用词」、认知转述管「句式」，这三类管**结构**——生成端那一节的 ③（不是A，是B 升华对偶）、
 * ⑥（章末四禁）与 ⑨（反差模板）在扫描端此前没有判据，写的时候拦一道、写完扫的却是另一份，这条不变量被拉开了。
 * 补这三条把它接回去；破折号、否定排比、明喻密度那些要读整章上下文才判得准的，
 * 留给体检的人工判读，不硬上正则。
 *
 * 类别沿用 "essay"（议论腔）：它们是「替读者下结论」的同一族毛病；单开类别会牵动
 * 体检分类标签与界面筛选，收益不抵票据。条目的**显示名**自成一目（见下面三个 LABEL），
 * 报告里一眼分得清是哪一类结构问题。
 */
export const AI_FLAVOR_ANTITHESIS_PATTERN = /不是[^，。！？；]{1,24}[，。；]?\s*(?:而)?是/g;
/** 升华对偶的显示名（它不是一个固定词，报的是句式）。 */
export const AI_FLAVOR_ANTITHESIS_LABEL = "不是A，是B 式升华对偶";
export const AI_FLAVOR_TAILCLAUSE_PATTERN =
  /(?:他终于(?:明白|懂了|想通)|这一夜[，,]?\s*注定|人生就是这样|人生就是如此|注定无人入眠|他不知道的是|更大的风暴)/g;
/** 章末总结体／升华／伏笔预告的显示名（同上，按句式计）。 */
export const AI_FLAVOR_TAILCLAUSE_LABEL = "章末总结体／升华／伏笔预告";
/**
 * 「声音不大，却……」反差模板（2026-10-16 §一百零七）：deslop 技能自己写着
 * 「这一句几乎是 AI 的指纹」，§一百零四 折了它五条里的四条却没折到这一条。
 * 反差本身是好手法，露馅的是「某属性不显著 → 却做出显著结果」这个固定转折句式。
 */
export const AI_FLAVOR_CONTRAST_PATTERN =
  /(?:声音|语气|语调|嗓音|口气)(?:不大|不高|不重|很轻|很低|平静|平淡)[，,]?\s*却/g;
/** 反差模板的显示名（同上，按句式计）。 */
export const AI_FLAVOR_CONTRAST_LABEL = "「声音不大，却……」反差模板";

/**
 * 情绪直陈（2026-10-18，与生成端 `NARRATIVE_CRAFT_INSTRUCTION` 第 1 条同一批）：
 * 「他感到一阵愤怒」「心中涌起一股酸楚」这类**给情绪命名**的写法——本该用身体反应、
 * 动作、视线的落点演出来（生成端第 1 条「别给情绪命名」）。扫描端此前只有认知转述句式，
 * 没有这条判据，写的时候拦一道、写完扫的却是另一份（同 §一百零五 的教训），本刀接回去。
 *
 * 只认「感到/涌起/… ＋ [程度·量词] ＋ 情绪词」这个**构式**，不是见到情绪词就报：
 * 「他感到不安」是直陈、「不安地攥紧了手」不是；情绪词单独出现（「他很愤怒」）也不进——
 * 那要读句子主语才判得准，留给体检人工判读。所以它是句式判据，不占词表项。
 */
export const AI_FLAVOR_EMOTION_PATTERN =
  /(?:感到|觉出|生出|涌起|泛起|涌上|掠过|充满)(?:一阵|一股|一丝|一种|莫名|无比|十分|非常)?[^，。！？；\s]{0,4}(?:愤怒|悲伤|悲痛|凄凉|失落|绝望|恐惧|害怕|愧疚|委屈|惆怅|烦躁|激动|痛苦|不安|欣慰|酸楚|心酸|羞耻|孤独|无力)/g;
/** 情绪直陈的显示名（同上，按句式计）。 */
export const AI_FLAVOR_EMOTION_LABEL = "情绪直陈（感到／涌起＋情绪词）";

/**
 * 结构级三类与句式类（情绪直陈）的起报阈值：只对这几个模式的条目生效——升华对偶偶一用是修辞、
 * 3 次起才是机器味，章末总结体一章就一个结尾、出现 1 次已经是章末那股腔，反差模板翻两句就露馅、
 * 2 次起，情绪直陈同认知转述、反复用才是机器味、3 次起；
 * 其余条目照旧走 MIN_COUNT[category]。
 * 阈值只有体检（analyzeAiFlavor）用；退稿闸不计阈值，全量计入，但**名目与体检同一批**。
 */
export const AI_FLAVOR_STRUCTURE_MIN_COUNT: Record<string, number> = {
  [AI_FLAVOR_ANTITHESIS_LABEL]: 3,
  [AI_FLAVOR_TAILCLAUSE_LABEL]: 1,
  [AI_FLAVOR_CONTRAST_LABEL]: 2,
  [AI_FLAVOR_EMOTION_LABEL]: 3
};

export const AI_FLAVOR_CATEGORY_LABELS: Record<AiFlavorCategory, string> = {
  cliche: "描写套话",
  essay: "议论腔",
  adverb: "副词滥用",
  cognitive: "认知转述"
};

/** 各类起报阈值：不到阈值的词不算嫌疑——孤例多半是正常行文，刷屏的是词表不是报告。 */
const MIN_COUNT: Record<AiFlavorCategory, number> = {
  cliche: 2,
  essay: 1,
  adverb: 5,
  cognitive: 3
};

/** 报告上限：这是给人看的体检报告，不是数据倾倒。 */
export const AI_FLAVOR_ENTRY_LIMIT = 30;

export interface AiFlavorEntry {
  term: string;
  category: AiFlavorCategory;
  count: number;
  /** 全书第一次出现的位置——体检条目点击直达用（contents 下标 + 1 起算行号）。 */
  first: { docIndex: number; line: number; text: string };
}

export interface AiFlavorReport {
  entries: AiFlavorEntry[];
  /** 报告内条目的命中总数。 */
  totalHits: number;
  charCount: number;
  /** 每千字命中数（报告内，2 位小数）——比绝对次数更公平：短篇长篇一个口径。 */
  perThousand: number;
  /** 平均句长（字）；不足 10 句为 null——样本太少不编数。 */
  meanSentenceLength: number | null;
  /** 句长波动 = 标准差 ÷ 平均值（2 位小数）；连续句子长短雷同是机器味的特征之一。 */
  sentenceSpread: number | null;
}

/** 句长节奏的样本门槛：不足这么多句不编数——三五句的段落算不出可信的波动。 */
export const SENTENCE_SPREAD_MIN_SENTENCES = 10;

export interface SentenceRhythm {
  /** 平均句长（字，1 位小数）。 */
  mean: number;
  /** 句长波动 = 标准差 ÷ 平均值（2 位小数）。0 = 句句等长。 */
  spread: number;
}

/**
 * 句长节奏的**唯一计算**：体检报告（analyzeAiFlavor）与退稿闸（aiFlavorGate）都从这里拿数，
 * 不许各算一遍——两处口径一旦走岔，「体检说正常、闸却拦稿」这种自相矛盾就来了。
 * 不足 SENTENCE_SPREAD_MIN_SENTENCES 句返回 null。
 */
export function sentenceRhythmOf(text: string): SentenceRhythm | null {
  const sentences = sentencesOf(text);
  if (sentences.length < SENTENCE_SPREAD_MIN_SENTENCES) return null;
  const lengths = sentences.map((sentence) => sentence.length);
  const mean = lengths.reduce((sum, length) => sum + length, 0) / lengths.length;
  if (mean <= 0) return null;
  const variance = lengths.reduce((sum, length) => sum + (length - mean) ** 2, 0) / lengths.length;
  return {
    mean: Math.round(mean * 10) / 10,
    spread: Math.round((Math.sqrt(variance) / mean) * 100) / 100
  };
}

/** 单句切分：句末标点留句尾（与重复句同一套 lookbehind 口径）。 */
function sentencesOf(content: string): string[] {
  const out: string[] = [];
  for (const line of content.split("\n")) {
    for (const raw of line.split(/(?<=[。！？…；])/)) {
      const sentence = raw.trim();
      if (sentence !== "") out.push(sentence);
    }
  }
  return out;
}

/**
 * 全书 AI 味扫描。contents 是全书各篇正文（按文档顺序，docIndex 语义与其对齐）。
 * 词命中用 indexOf 数遍（词都是纯中文短串，逐行扫足够快）；认知转述与结构级三类按正则计；
 * 每个词第一次命中时顺手记下位置——体检条目要能点回原文。
 */
export function analyzeAiFlavor(contents: string[]): AiFlavorReport {
  const counts = new Map<string, number>();
  const categories = new Map<string, AiFlavorCategory>();
  const firsts = new Map<string, { docIndex: number; line: number; text: string }>();

  /** 记 n 次命中；首遇时把这篇这行存下来（first 只记第一次，后面覆盖不了它）。 */
  const record = (
    term: string,
    category: AiFlavorCategory,
    hits: number,
    where: { docIndex: number; line: number; text: string }
  ): void => {
    counts.set(term, (counts.get(term) ?? 0) + hits);
    categories.set(term, category);
    if (!firsts.has(term)) firsts.set(term, where);
  };

  for (const [docIndex, content] of contents.entries()) {
    const lines = content.split("\n");
    for (const [idx, line] of lines.entries()) {
      const where = { docIndex, line: idx + 1, text: line.trim() };
      for (const { term, category } of AI_FLAVOR_TERMS) {
        let hits = 0;
        let from = 0;
        for (;;) {
          const at = line.indexOf(term, from);
          if (at === -1) break;
          hits += 1;
          from = at + term.length;
        }
        if (hits > 0) record(term, category, hits, where);
      }
      // 认知转述与结构级两类：String.match(带 g) 每次调用都是全新状态，没有 lastIndex 串行坑。
      const cognitiveHits = line.match(AI_FLAVOR_COGNITIVE_PATTERN);
      if (cognitiveHits !== null) {
        record(AI_FLAVOR_COGNITIVE_LABEL, "cognitive", cognitiveHits.length, where);
      }
      const antithesisHits = line.match(AI_FLAVOR_ANTITHESIS_PATTERN);
      if (antithesisHits !== null) {
        record(AI_FLAVOR_ANTITHESIS_LABEL, "essay", antithesisHits.length, where);
      }
      const tailHits = line.match(AI_FLAVOR_TAILCLAUSE_PATTERN);
      if (tailHits !== null) {
        record(AI_FLAVOR_TAILCLAUSE_LABEL, "essay", tailHits.length, where);
      }
      const contrastHits = line.match(AI_FLAVOR_CONTRAST_PATTERN);
      if (contrastHits !== null) {
        record(AI_FLAVOR_CONTRAST_LABEL, "essay", contrastHits.length, where);
      }
      const emotionHits = line.match(AI_FLAVOR_EMOTION_PATTERN);
      if (emotionHits !== null) {
        record(AI_FLAVOR_EMOTION_LABEL, "essay", emotionHits.length, where);
      }
    }
  }

  const entries: AiFlavorEntry[] = [];
  for (const [term, count] of counts) {
    const category = categories.get(term) ?? "cliche";
    // 阈值走结构级专项表：这两类结构味的起报线不跟 essay 的 1 次走；其余照旧 MIN_COUNT。
    const threshold = AI_FLAVOR_STRUCTURE_MIN_COUNT[term] ?? MIN_COUNT[category];
    if (count < threshold) continue;
    entries.push({
      term,
      category,
      count,
      first: firsts.get(term) ?? { docIndex: 0, line: 0, text: "" }
    });
  }
  entries.sort((x, y) => y.count - x.count || x.term.localeCompare(y.term, "zh"));
  const capped = entries.slice(0, AI_FLAVOR_ENTRY_LIMIT);

  const charCount = contents.reduce((sum, content) => sum + content.length, 0);
  const totalHits = capped.reduce((sum, entry) => sum + entry.count, 0);

  // 句长节奏走单一真身 sentenceRhythmOf（与退稿闸同一份计算），这里只负责拆回两个报告字段。
  const rhythm = sentenceRhythmOf(contents.join("\n"));

  return {
    entries: capped,
    totalHits,
    charCount,
    perThousand: charCount === 0 ? 0 : Math.round((totalHits / charCount) * 1000 * 100) / 100,
    meanSentenceLength: rhythm?.mean ?? null,
    sentenceSpread: rhythm?.spread ?? null
  };
}

/**
 * 生成端词表：提示词「文风硬约束」里点名禁用的词（描写套话 + 议论腔全量，顿号连接）。
 * 从 AI_FLAVOR_TERMS 拼出来，保证「提示词禁的词」与「体检报的词」永远同一份。
 */
export function aiFlavorPromptList(): string {
  return AI_FLAVOR_TERMS.filter(({ category }) => category === "cliche" || category === "essay")
    .map(({ term }) => term)
    .join("、");
}

/* ────────────────────────── 自动退稿闸（2026-10-10 二段） ────────────────────────── */

/**
 * 底层自动运行的 AI 味闸：智能体交 write_doc / propose_patch 的瞬间，工具执行层对
 * **新增正文**跑一遍判定，超标就自动退稿（ok:false），模型拿着退稿信自己重写——
 * 用户全程无感，不需要点任何检查。阈值刻意宽松：只拦重度 AI 味，宁可放过轻度，
 * 不可拦住正常文——闸是质量下限，不是文风警察。
 *
 * maxSpread 是**句长过匀**的判线（六段）：比体检的「0.5 算偏均匀」保守得多——
 * 闸只拦「句句几乎等长」的机器稿（等长稿实测 ≤0.25），正常文一句三字一句二十字，
 * 波动远在 0.4 以上。对话密集的章节天然波动大，不会被这条误伤。
 */
export const AI_FLAVOR_GATE = {
  perThousand: 5,
  minHits: 5,
  minChars: 200,
  maxSpread: 0.3
} as const;

export interface AiFlavorGateVerdict {
  pass: boolean;
  /** 重罪命中数（描写套话 + 议论腔 + 认知转述 + 结构级三类 + 情绪直陈；副词不算——太常见，不是死罪）。 */
  hits: number;
  perThousand: number;
  charCount: number;
  /** 命中最多的前 5 个写法——退稿信里给模型看，它才知道往哪儿改。 */
  topTerms: string[];
  /**
   * 句式开头复读（五段）：非 null 即「十句九句他开头」级别的机器节奏，
   * 与词命中**各自独立**成拦稿理由——模型可以一个套话不用却烂在节奏上。
   */
  startRepeat: SentenceStartRepeat | null;
  /**
   * 句长过匀（六段）：非 null 即「开头错落但句句等长」的另一种机器节奏。
   * 开头复读管**起手**，这条管**长短**——两台机器写出来的稿子病在不同的地方，
   * 三条拦稿理由（词 / 起手 / 长短）各拦各的，谁也替不了谁。
   */
  flatRhythm: SentenceRhythm | null;
}

/**
 * 对一篇（或一段）新增正文做退稿判定。与 analyzeAiFlavor 同一份判据
 * （AI_FLAVOR_TERMS + 认知转述/结构级/情绪直陈正则），不抄第二份；不计入报告上限——闸要看全量。
 * 短于 minChars 的文本直接放行：样本太少，密度失真。
 */
export function aiFlavorGate(text: string): AiFlavorGateVerdict {
  const counts = new Map<string, number>();
  const bump = (term: string, n: number): void => {
    if (n > 0) counts.set(term, (counts.get(term) ?? 0) + n);
  };
  for (const { term, category } of AI_FLAVOR_TERMS) {
    if (category === "adverb") continue;
    let hits = 0;
    let from = 0;
    for (;;) {
      const at = text.indexOf(term, from);
      if (at === -1) break;
      hits += 1;
      from = at + term.length;
    }
    bump(term, hits);
  }
  // 认知转述与结构级两类：String.match(带 g) 每次调用都是全新状态，没有 lastIndex 串行坑。
  const cognitive = text.match(AI_FLAVOR_COGNITIVE_PATTERN);
  bump(AI_FLAVOR_COGNITIVE_LABEL, cognitive?.length ?? 0);
  const antithesis = text.match(AI_FLAVOR_ANTITHESIS_PATTERN);
  bump(AI_FLAVOR_ANTITHESIS_LABEL, antithesis?.length ?? 0);
  const tail = text.match(AI_FLAVOR_TAILCLAUSE_PATTERN);
  bump(AI_FLAVOR_TAILCLAUSE_LABEL, tail?.length ?? 0);
  const contrast = text.match(AI_FLAVOR_CONTRAST_PATTERN);
  bump(AI_FLAVOR_CONTRAST_LABEL, contrast?.length ?? 0);
  const emotion = text.match(AI_FLAVOR_EMOTION_PATTERN);
  bump(AI_FLAVOR_EMOTION_LABEL, emotion?.length ?? 0);

  const charCount = text.length;
  const hits = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const perThousand = charCount === 0 ? 0 : Math.round((hits / charCount) * 1000 * 100) / 100;
  const topTerms = [...counts.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 5)
    .map(([term, n]) => `${term} ×${n}`);
  // 三条独立的拦稿理由：短文本一律放行（样本太少都失真）；
  // 长文本三条里任意一条爆了就拦——词干净、起手轮换但句句等长的稿子同样是机器稿。
  const startRepeat = charCount < AI_FLAVOR_GATE.minChars ? null : sentenceStartRepeat(text);
  const flatRhythm = charCount < AI_FLAVOR_GATE.minChars ? null : sentenceRhythmOf(text);
  const flat =
    flatRhythm !== null && flatRhythm.spread < AI_FLAVOR_GATE.maxSpread ? flatRhythm : null;
  const wordPass = hits < AI_FLAVOR_GATE.minHits || perThousand < AI_FLAVOR_GATE.perThousand;
  const pass =
    charCount < AI_FLAVOR_GATE.minChars || (wordPass && startRepeat === null && flat === null);
  return { pass, hits, perThousand, charCount, topTerms, startRepeat, flatRhythm: flat };
}

/* ────────────────────────── 句式开头重复检测（2026-10-10 五段） ────────────────────────── */

/**
 * 句子开头复读的判定阈值——比词库闸更保守的三重门槛：
 * 非对话句 ≥8 句（样本够）、同一字开头 ≥6 句（绝对量）、占比 ≥0.6（ rhythm 真烂）。
 * 0.5 是「他一句、火一句」的正常交替，不拦；0.6 起才是「十句九句他开头」的机器节奏。
 */
export const SENTENCE_START_REPEAT = { minSentences: 8, minCount: 6, minRatio: 0.6 } as const;

export interface SentenceStartRepeat {
  /** 复读的那个开头字。 */
  char: string;
  count: number;
  /** 参与判定的非对话句总数。 */
  total: number;
  ratio: number;
}

/**
 * 检测「每句都用同一个字开头」的机器节奏（他…。他…。他…。）。
 * 词库管**用词**，这段管**节奏**——模型可以一个套话词都不用，却把二十句全写成
 * 「他 + 动词」起手，读起来照样是流水线。对话行（「『" 开头）排除在外：
 * 对话密集的章节开头全是引号，那是节拍选择，不是机器腔。不触发返回 null。
 */
export function sentenceStartRepeat(text: string): SentenceStartRepeat | null {
  // 注意 sentencesOf 的 lookbehind 会切进引号内部（「喝吧。→」她把碗推过去。），
  // 产生以收尾引号开头的碎片——开头的引号字（含收尾引号）一律排除，对话邻句不进节奏判定。
  const sentences = sentencesOf(text).filter((sentence) => !/^["「『」』]/.test(sentence));
  if (sentences.length < SENTENCE_START_REPEAT.minSentences) return null;
  const starts = new Map<string, number>();
  for (const sentence of sentences) {
    const head = sentence[0]!;
    starts.set(head, (starts.get(head) ?? 0) + 1);
  }
  const [char, count] = [...starts.entries()].sort((x, y) => y[1] - x[1])[0]!;
  if (count < SENTENCE_START_REPEAT.minCount) return null;
  const ratio = count / sentences.length;
  if (ratio < SENTENCE_START_REPEAT.minRatio) return null;
  return { char, count, total: sentences.length, ratio: Math.round(ratio * 100) / 100 };
}

/* ────────────────────────── 「换汤不换药」检测（2026-10-10 四段） ────────────────────────── */

/**
 * 两段文字的相似度（字符 bigram 的 Dice 系数，0~1）。
 *
 * 为什么用 bigram 不用编辑距离：退稿闸只关心「这版重写是不是基本没动」，
 * bigram 重叠率对「换几个词」极敏感（其余字对全保留），又不用 O(n²) 的 DP——
 * 章节动辄几千字，编辑距离在主进程里跑一节就是性能事故。
 * 退稿信里点破「你这版和上一版几乎一样」，比让模型连吃三次同款退稿好得多。
 */
export function textSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i += 1) {
    const gram = a.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  let overlap = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    const gram = b.slice(i, i + 2);
    const left = grams.get(gram) ?? 0;
    if (left > 0) {
      overlap += 1;
      grams.set(gram, left - 1);
    }
  }
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}
