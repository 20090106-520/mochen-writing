/**
 * 书稿体检（2026-10-10，2026-10-11 扩到八类）：一次扫描全书，八类报告——
 * ① 术语疑似：一字之差的高频词对（林潮生/林潮升）。
 * ② 标点硬伤：连续重复的句读（。。、，，）与夹在汉字间的半角标点。
 * ③ 重复句：≥12 字的完全相同句子出现 ≥2 次（自己抄自己的桥段）——统计真身在
 *    @mochen/contracts 的 repeatedSentences（退稿闸的复读理由吃同一份，2026-10-18 下沉）。
 * ④ 角色出场：角色卡上的人在哪些章节出现、最近一次是哪章（失踪人口排查）。
 * ⑤ AI 味扫描：词库级判定「一眼机器味」的写法（判定真身住 @mochen/contracts，
 *    与 AI 智能体提示词的文风硬约束同吃一份词表——写的时候拦一道，写完扫的是同一批词）。
 * ⑥ 对话占比：逐章算引号内字数占比（口径真身住 @mochen/contracts/dialogue，
 *    与提示词端的「话太密/全叙述」提醒同一套阈值）——哪章在开会一眼看到。
 * ⑦ 角色腔调漂移：引语按角色归堆，某章均长偏离角色基线（中位数）就报「疑似」——
 *    人物不塌房的第一道启发式防线。
 * ⑧ 高频词口头禅榜：全书双字组合 TOP 榜——不是「疑似」判定，是给你自己看的镜子：
 *    「瞬间」「当即」「目光」用了多少次，一目了然（判线交给你）。
 * ⑨ 逐章活性／退化读数（2026-10-20）：前八类之外的一张**纯读数表**——逐章摆出尺度无关的
 *    活性／退化四枚读数（突发度／虚词密度／短句占比／平均句长），**不判定、不排序、不设线**
 *    （真身住 contracts 的 text-vitality / text-degeneration，这里只挑长度可比的那几枚）。
 *
 * 全部是启发式判定：报「疑似」，最终判断永远交给人。零依赖——
 * 编辑距离复用 @mochen/contracts 的 isWithinEdits（与检索容错同一份真身，不抄第二份）。
 */
export { analyzeAiFlavor } from "@mochen/contracts";
import {
  AI_FLAVOR_REPEAT,
  isWithinEdits,
  dialogueBalance,
  dialogueVerdict,
  repeatedSentences,
  splitFrontmatter,
  degenerationOf,
  vitalityOf,
  styleProfileOf,
  styleDriftOf,
  STYLE_PROFILE_PUNCTUATION,
  type RepeatedSentence
} from "@mochen/contracts";
import type { BookDoc } from "../types/book-doc";

/* ────────────────────────── ① 术语疑似 ────────────────────────── */

/** 候选术语的字长范围：2 字名（阿月）到 4 字名（云中城）。 */
export const TERM_MIN_CHARS = 2;
export const TERM_MAX_CHARS = 4;
/** 双侧都要出现这么多次才报告：出现一次的孤例多半是正常行文，不是混用。 */
export const TERM_MIN_COUNT = 2;
/** 疑似清单上限：这是给人看的体检报告，不是数据倾倒。 */
export const TERM_SUSPECT_LIMIT = 30;

const CJK_RUN = /[\u4e00-\u9fff]+/g;

/**
 * 常用虚字表：候选词里出现任何一个就不当术语。
 * 「他们」「的时候」「这个时候」这类高频词对是滑窗计次最大的噪声源，
 * 而人名/地名/功法名几乎不含这些字。宁可漏报，不可刷屏。
 */
const FUNCTION_CHARS = new Set(
  "的了着是在和与就都也很呢吧吗啊呀哦嘛之乎者这那哪个时候们被把将对于从向到上下中里外去来过很太又再才只更最".split(
    ""
  )
);

function hasFunctionChar(term: string): boolean {
  for (const char of term) {
    if (FUNCTION_CHARS.has(char)) return true;
  }
  return false;
}

export interface TermVariantSuspect {
  a: string;
  b: string;
  countA: number;
  countB: number;
  /** 含较少见写法的那一行的原文（给判断当上下文；取全书第一次出现）。 */
  sample: string;
  /** 样例行落在哪一篇哪一行（contents 下标 + 1 起算行号）——点条目直达原文用。 */
  sampleDocIndex: number;
  sampleLine: number;
}

/**
 * 找出互为「一字之差」的候选词对。contents 是全书各篇正文（按文档顺序，
 * docIndex 语义与其对齐）。
 */
export function findTermVariants(
  contents: string[],
  minCount = TERM_MIN_COUNT
): TermVariantSuspect[] {
  const counts = new Map<string, number>();
  const samples = new Map<string, { text: string; docIndex: number; line: number }>();
  for (const [docIndex, content] of contents.entries()) {
    const lines = content.split("\n");
    for (const [idx, line] of lines.entries()) {
      const runs = line.match(CJK_RUN);
      if (runs === null) continue;
      for (const run of runs) {
        for (let length = TERM_MIN_CHARS; length <= TERM_MAX_CHARS; length += 1) {
          for (let start = 0; start + length <= run.length; start += 1) {
            const term = run.slice(start, start + length);
            counts.set(term, (counts.get(term) ?? 0) + 1);
            if (!samples.has(term)) {
              samples.set(term, { text: line.trim(), docIndex, line: idx + 1 });
            }
          }
        }
      }
    }
  }

  // 通配键分组：同长度候选各挖掉一位拼键，同键的任意两个词恰差那一字 = 一字之差。
  // 比两两全比对少一个数量级，也天然去重（同长度词对只共享一个键）。
  const byLength = new Map<number, string[]>();
  for (const [term, count] of counts) {
    if (count < minCount || hasFunctionChar(term)) continue;
    const bucket = byLength.get(term.length) ?? [];
    bucket.push(term);
    byLength.set(term.length, bucket);
  }

  const suspects: TermVariantSuspect[] = [];
  // 更长的候选词（≥3 字）：两字词对若两边都嵌在长词里，这对「子串冗余」由长词对代表，
  // 不再单独报（林潮生/林海升 差两字本身不报，但滑窗会拆出 林潮/林海、潮生/海升）。
  const longerTerms = [...counts.keys()].filter(
    (term) => term.length >= TERM_MIN_CHARS + 1 && counts.get(term)! >= minCount
  );
  const embeddedInLonger = (term: string): boolean =>
    longerTerms.some((longer) => longer.includes(term));
  for (const [length, terms] of byLength) {
    const wildcard = new Map<string, string[]>();
    for (const term of terms) {
      for (let k = 0; k < length; k += 1) {
        const key = term.slice(0, k) + "\u0000" + term.slice(k + 1);
        const bucket = wildcard.get(key) ?? [];
        bucket.push(term);
        wildcard.set(key, bucket);
      }
    }
    for (const bucket of wildcard.values()) {
      for (let i = 0; i < bucket.length; i += 1) {
        for (let j = i + 1; j < bucket.length; j += 1) {
          const a = bucket[i]!;
          const b = bucket[j]!;
          // 同键同长已然只差一字；isWithinEdits 是同一份真身的复核，不省。
          if (a === b || !isWithinEdits(a, b, 1)) continue;
          if (length === TERM_MIN_CHARS && embeddedInLonger(a) && embeddedInLonger(b)) continue;
          const countA = counts.get(a) ?? 0;
          const countB = counts.get(b) ?? 0;
          const rare = countA <= countB ? a : b;
          const sample = samples.get(rare) ?? { text: "", docIndex: 0, line: 0 };
          suspects.push({
            a,
            b,
            countA,
            countB,
            sample: sample.text,
            sampleDocIndex: sample.docIndex,
            sampleLine: sample.line
          });
        }
      }
    }
  }

  suspects.sort((x, y) => Math.min(y.countA, y.countB) - Math.min(x.countA, x.countB));
  return suspects.slice(0, TERM_SUSPECT_LIMIT);
}

/* ────────────────────────── ② 标点硬伤 ────────────────────────── */

export interface PunctuationIssue {
  /** 第几篇文档（contents 数组下标），展示层映射回篇名。 */
  docIndex: number;
  /** 1 起算的行号。 */
  line: number;
  /** repeated = 同一句读连写（。。）；halfwidth = 夹在汉字间的半角标点。 */
  kind: "repeated" | "halfwidth";
  /** 该行原文（trim），给判断当上下文。 */
  excerpt: string;
}

export const PUNCTUATION_ISSUE_LIMIT = 50;

/**
 * 「！！」「？？」「……」在小说里是合法的语气写法，不在重复之列；
 * 报的是 `。。` `，，` `、、` 这类明显的手滑。半角规则要求两侧都是汉字，
 * 「3.5」「OK,好」这类数字/英文场景天然不命中。
 * 两条都不带 /g 标志：g 会让 .test() 带着 lastIndex 状态跨行串检（实测隔行漏）。
 *
 * 【半角只放逗号，2026-10-11 真机量的】`沈砚没有回答,,只是把斗篷上的雪抖落。`
 * 这一行两条规则都不命中——`。。` 那条只收全角，下一条要求标点两侧都是汉字而这里
 * 中间是两个逗号。种子书真跑一遍体检，它确实没进「标点硬伤」那张表（`.mochen-tmp/p546/`）。
 * 半角**句点与叹问号刻意不进**：`...` 是合法省略号，`!!` `?!` 是合法语气。
 */
const REPEATED_PUNCT = /([。，、；：,])\1+/;
const HALFWIDTH_IN_CJK = /[\u4e00-\u9fff][,.;:?!][\u4e00-\u9fff]/;

export function findPunctuationIssues(contents: string[]): PunctuationIssue[] {
  const issues: PunctuationIssue[] = [];
  for (const [docIndex, content] of contents.entries()) {
    const lines = content.split("\n");
    for (const [idx, line] of lines.entries()) {
      if (REPEATED_PUNCT.test(line)) {
        issues.push({ docIndex, line: idx + 1, kind: "repeated", excerpt: line.trim() });
      } else if (HALFWIDTH_IN_CJK.test(line)) {
        issues.push({ docIndex, line: idx + 1, kind: "halfwidth", excerpt: line.trim() });
      }
      if (issues.length >= PUNCTUATION_ISSUE_LIMIT) return issues;
    }
  }
  return issues;
}

/* ────────────────────────── ③ 重复句 ────────────────────────── */

/**
 * 比这短的重复多半是「他说」「点了点头」类的正常口头禅，不值得报。
 * 数字真身在 contracts（`AI_FLAVOR_REPEAT.minChars`）——退稿闸那条复读理由吃的是同一枚。
 */
export const DUPLICATE_SENTENCE_MIN_CHARS = AI_FLAVOR_REPEAT.minChars;
export const DUPLICATE_SENTENCE_LIMIT = 30;

/** 重复句的展示行——结构真身复用 contracts 的 `RepeatedSentence`，不另留一份。 */
export type DuplicateSentence = RepeatedSentence;

/**
 * 巡检面板「③ 重复句」：**统计真身在 contracts**（`repeatedSentences`，2026-10-18 下沉），
 * 这里只负责封顶——退稿闸的第五条理由吃的是同一份切句与计数，不再各抄一遍。
 */
export function findDuplicateSentences(
  contents: string[],
  minChars: number = DUPLICATE_SENTENCE_MIN_CHARS
): DuplicateSentence[] {
  return repeatedSentences(contents, minChars).slice(0, DUPLICATE_SENTENCE_LIMIT);
}

/* ────────────────────────── ④ 角色出场 ────────────────────────── */

export interface CharacterAppearance {
  name: string;
  /** 全书章节里出现的总次数。 */
  total: number;
  /** 出场过的章节数。 */
  chapterCount: number;
  /** 最后一次出场是哪章（按章节列表顺序取最后一个 >0 的）；全书未出场为 null。 */
  lastChapterTitle: string | null;
}

export function trackCharacterAppearances(
  names: string[],
  chapters: { title: string; content: string }[]
): CharacterAppearance[] {
  const rows: CharacterAppearance[] = [];
  for (const rawName of names) {
    const name = rawName.trim();
    if (name === "") continue;
    let total = 0;
    let chapterCount = 0;
    let lastChapterTitle: string | null = null;
    for (const chapter of chapters) {
      let hits = 0;
      let from = 0;
      for (;;) {
        const at = chapter.content.indexOf(name, from);
        if (at === -1) break;
        hits += 1;
        from = at + name.length;
      }
      if (hits > 0) {
        total += hits;
        chapterCount += 1;
        lastChapterTitle = chapter.title;
      }
    }
    rows.push({ name, total, chapterCount, lastChapterTitle });
  }
  rows.sort((x, y) => y.total - x.total || x.name.localeCompare(y.name, "zh"));
  return rows;
}

/* ────────────────────────── ⑥ 对话占比（2026-10-11） ────────────────────────── */

/** 一章对话占比的展示行。verdict 用 contracts 的判读（thin-sample 不算病，单独一个说法）。 */
export interface ChapterDialogueRow {
  docIndex: number;
  /** 占比百分数（0~100 整数）。 */
  percent: number;
  verdict: "thin-sample" | "dense" | "silent" | "normal";
}

/** 展示上限：异常章应该没有这么多；真有，先看最反常的前 20 章。 */
export const DIALOGUE_ROW_LIMIT = 20;

/**
 * 逐章算对话占比。全章都报（判读在行上，作者自己看得出常态与反常），
 * 排序把「dense」「silent」顶到最前——「哪章在开会」一眼看到。
 */
export function chapterDialogueRows(
  chapters: { docIndex: number; content: string }[]
): ChapterDialogueRow[] {
  const weight: Record<ChapterDialogueRow["verdict"], number> = {
    dense: 0,
    silent: 1,
    "thin-sample": 2,
    normal: 3
  };
  return chapters
    .map(({ docIndex, content }) => {
      const balance = dialogueBalance(content);
      return {
        docIndex,
        percent: Math.round(balance.ratio * 100),
        verdict: dialogueVerdict(balance)
      };
    })
    .sort(
      (a, b) =>
        weight[a.verdict] - weight[b.verdict] || b.percent - a.percent || a.docIndex - b.docIndex
    )
    .slice(0, DIALOGUE_ROW_LIMIT);
}

/* ────────────────────────── ⑦ 角色腔调漂移（2026-10-11） ────────────────────────── */

/**
 * 腔调漂移的三重门槛——体检是启发式，宁可漏报不可吓人：
 * 该章引语 ≥4 条（少于此数均值不稳）、该角色全书引语 ≥8 条（基线要立得住）、
 * 该章引语均长是基线的 1.5 倍以上（话变多了）或 0.6 倍以下（话变短了）才报。
 */
export const VOICE_DRIFT = {
  minChapterQuotes: 4,
  minBaselineQuotes: 8,
  longerRatio: 1.5,
  shorterRatio: 0.6
} as const;

export const VOICE_DRIFT_LIMIT = 20;

export interface VoiceDriftSuspect {
  /** 人物卡上的角色名。 */
  name: string;
  /** 漂移发生在哪一章（contents 下标）。 */
  docIndex: number;
  /** 该章引语平均字数（1 位小数）。 */
  chapterMean: number;
  /** 基线 = 这个角色**全书引语字数的中位数**（1 位小数）——他平时一句话说多长。 */
  baselineMean: number;
  chapterQuotes: number;
  baselineQuotes: number;
}

/**
 * 引语归属的**归属口径**：一行里有引语、且**去掉引语之后的叙述部分**恰好出现一个角色名，
 * 才把这条引语记到这个角色头上。两个名字的行不猜（「林说王笑」猜错比漏掉更伤信任），
 * 引语**内部**出现的名字不算（「林潮生你给我站住」是骂林潮生，不是林潮生说的）。
 * 没写说话人的行（「他」/空）同样跳过——「他说」里的他没法对回人物卡。
 */
const QUOTED_SPAN = /[「『]([^」』]+)[」』]/g;

function attributeQuotes(
  line: string,
  names: string[]
): { name: string; lengths: number[] } | null {
  const lengths: number[] = [];
  let match: RegExpExecArray | null;
  QUOTED_SPAN.lastIndex = 0;
  while ((match = QUOTED_SPAN.exec(line)) !== null) {
    if (match[1]!.trim() !== "") lengths.push(match[1]!.length);
  }
  if (lengths.length === 0) return null;
  const narration = line.replace(QUOTED_SPAN, "　");
  const hits = names.filter((name) => narration.includes(name));
  if (hits.length !== 1) return null;
  return { name: hits[0]!, lengths };
}

function meanOf(lengths: number[]): number {
  const sum = lengths.reduce((acc, n) => acc + n, 0);
  return Math.round((sum / lengths.length) * 10) / 10;
}

/** 基线用**中位数**而不是均值：均值会被漂移章拖走——某章一突变，其余章对新均值全体「反向漂移」，一变三报警。中位数不受少数异常章牵动，「他平时说话多长」这个量才稳。 */
function medianOf(lengths: number[]): number {
  const sorted = [...lengths].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.round(median * 10) / 10;
}

/**
 * 角色腔调漂移检测：逐章把引语按角色归堆，某章的引语均长偏离这个角色自己的基线
 * 超过门槛就报「疑似」。管的是「短句突变长句」这类最容易被读者察觉的塌房；
 * 用词层面的漂移是语义问题，启发式做不了，不装能做。
 */
export function findVoiceDrift(
  names: string[],
  chapters: { docIndex: number; content: string }[]
): VoiceDriftSuspect[] {
  const cleanNames = [...new Set(names.map((name) => name.trim()).filter((n) => n !== ""))];
  if (cleanNames.length === 0) return [];
  // quotes[name][chapterIdx] = 该章该角色的引语字数列表。
  const quotes = new Map<string, number[][]>();
  for (const { content } of chapters) {
    const byName = new Map<string, number[]>();
    for (const line of content.split("\n")) {
      const attributed = attributeQuotes(line, cleanNames);
      if (attributed === null) continue;
      const bucket = byName.get(attributed.name) ?? [];
      bucket.push(...attributed.lengths);
      byName.set(attributed.name, bucket);
    }
    for (const name of cleanNames) {
      const list = quotes.get(name) ?? [];
      list.push(byName.get(name) ?? []);
      quotes.set(name, list);
    }
  }

  const suspects: VoiceDriftSuspect[] = [];
  for (const [name, perChapter] of quotes) {
    const flat = perChapter.flat();
    if (flat.length < VOICE_DRIFT.minBaselineQuotes) continue;
    const baselineMean = medianOf(flat);
    if (baselineMean <= 0) continue;
    for (const [idx, lengths] of perChapter.entries()) {
      if (lengths.length < VOICE_DRIFT.minChapterQuotes) continue;
      const chapterMean = meanOf(lengths);
      const ratio = chapterMean / baselineMean;
      if (ratio < VOICE_DRIFT.longerRatio && ratio > VOICE_DRIFT.shorterRatio) continue;
      suspects.push({
        name,
        docIndex: chapters[idx]!.docIndex,
        chapterMean,
        baselineMean,
        chapterQuotes: lengths.length,
        baselineQuotes: flat.length
      });
    }
  }
  suspects.sort((a, b) => {
    const drift =
      Math.abs(b.chapterMean / b.baselineMean - 1) - Math.abs(a.chapterMean / a.baselineMean - 1);
    return drift !== 0 ? drift : a.name.localeCompare(b.name, "zh") || a.docIndex - b.docIndex;
  });
  return suspects.slice(0, VOICE_DRIFT_LIMIT);
}

/* ────────────────────────── ⑧ 高频词口头禅榜（2026-10-11） ────────────────────────── */

/** 榜单上限：给人看的镜子，不是数据倾倒。 */
export const PHRASE_LIMIT = 30;

/**
 * 语法高频双字组合（代词/连词/助词/方位度量等）——口头禅榜要照出的是
 * **内容词**的习惯（「瞬间」「当即」「目光」），不是汉语本来就高频的语法词。
 * 注意这里刻意不放「突然」「仿佛」「似乎」这类副词：它们正是最该被照出来的口头禅。
 */
export const PHRASE_STOP_WORDS: ReadonlySet<string> = new Set([
  "的话",
  "一个",
  "自己",
  "没有",
  "什么",
  "这个",
  "那个",
  "这些",
  "那些",
  "这里",
  "那里",
  "这样",
  "那样",
  "这么",
  "那么",
  "已经",
  "就是",
  "不是",
  "还是",
  "只是",
  "所以",
  "可是",
  "然后",
  "不过",
  "因为",
  "如果",
  "虽然",
  "而且",
  "并且",
  "或者",
  "也许",
  "大概",
  "应该",
  "可能",
  "可以",
  "不能",
  "不会",
  "多少",
  "哪里",
  "怎么",
  "如何",
  "一下",
  "一直",
  "时候",
  "东西",
  "一声",
  "起来",
  "出来",
  "看看",
  "觉得",
  "现在",
  "原来",
  "真的"
]);

export interface PhraseRow {
  /** 双字组合本身。 */
  phrase: string;
  /** 全书出现次数。 */
  count: number;
  /** 每千字出现次数（1 位小数）——短书长书一个口径。 */
  perThousand: number;
}

/**
 * 高频词口头禅榜：全书滑 2 字窗统计 CJK 双字组合，滤掉语法停用词后取 TOP。
 *
 * 为什么只做双字不做三字：中文词汇主体是双字词，口头禅大多两字就能照出来；
 * 三字窗会把双字命中重复计数（「嘴角」和「嘴角勾起」各算一遍），榜单反而失真。
 * 为什么自己剥 frontmatter：readDoc 按盘上原样交回全文，元数据里的词不是你写的正文。
 */
export function topPhrases(contents: string[]): PhraseRow[] {
  const body = contents.map((content) => splitFrontmatter(content).body).join("\n");
  // 非汉字一律当切分符：标点/空白/英数把双字组合的边界断干净，防止跨标点拼出假词。
  const runs = body.split(/[^\u4e00-\u9fff]+/).filter((run) => run.length >= 2);
  const counts = new Map<string, number>();
  let cjkChars = 0;
  for (const run of runs) {
    cjkChars += run.length;
    for (let i = 0; i < run.length - 1; i += 1) {
      const gram = run.slice(i, i + 2);
      if (PHRASE_STOP_WORDS.has(gram)) continue;
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
    }
  }
  const rows = [...counts.entries()]
    .map(([phrase, count]) => ({
      phrase,
      count,
      perThousand: cjkChars === 0 ? 0 : Math.round((count / cjkChars) * 1000 * 10) / 10
    }))
    .sort((a, b) => b.count - a.count || a.phrase.localeCompare(b.phrase, "zh"));
  return rows.slice(0, PHRASE_LIMIT);
}

/* ────────────────────────── ⑨ 逐章活性／退化读数（2026-10-20） ────────────────────────── */

/**
 * 一章的活性／退化读数行——**只有数，没有判读**（照 §一百三十五／§一百三十九 的「只摆数」范式）。
 * 判定真身在 contracts：活性三枚住 `text-vitality.ts`，退化三枚住 `text-degeneration.ts`，
 * 这里只挑出**长度可比的那几枚**摆出来，不重算一枚公式。
 */
export interface ChapterReadoutRow {
  docIndex: number;
  /** 本章字数——**参照列**，不是判线：它让读者看得见「为什么这一格是 `—`」。 */
  charCount: number;
  /** 活性·句长突发度（尺度无关，越大越错落）；不足句数为 null。 */
  burstiness: number | null;
  /** 退化·虚词密度（每千字，越低越像被削平）；无字为 null。 */
  particlePerThousand: number | null;
  /** 退化·短句占比（比例，越高越像电报体）；不足句数为 null。 */
  shortSentenceRatio: number | null;
  /** 退化·平均句长（字，取自 `sentenceRhythmOf` 的真身）；不足句数为 null。 */
  meanSentenceLength: number | null;
}

/**
 * 逐章取活性／退化读数，**按章序原样返回**。
 *
 * 【为什么只上这四枚、把熵与字多样性挡在门外】`ngramEntropy`（字符 n-gram 熵）与
 * `diversity`（字多样性）都**随文本变长而偏高**（样本越多，罕见 n-gram／字越容易被采到，
 * 见 §一百三十五 写进 `text-vitality.ts` 的固有偏差）。多稿面板是「同一篇稿的不同版本」，
 * 字数接近，相对比较站得住；而**逐章并排是拿不同长度的章比长短**——长章天然熵高、短章天然
 * 字多样性低，把它们摆上这张表就是误用（读者会读成「长章更活」）。所以只收四枚**尺度无关／
 * 密度／比例／均值**的读数：`burstiness` / `particlePerThousand` / `shortSentenceRatio` /
 * `meanSentenceLength`。`charCount` 只当参照列，不参与判读。
 *
 * 【为什么不排序、不封顶】排序即排行（把「最碎／最平」的顶到最前），那是机器判定，本刀不做；
 * 既有按序返回的先例是 `trackCharacterAppearances`（角色出场表，全量不封顶）。本表不排序，
 * 封顶就成了**凭空砍掉书的后半截章**，所以不设上限，也不导出 `CHAPTER_READOUT_LIMIT`
 * （没有消费者，导出即死代码）。
 */
export function chapterReadoutRows(
  chapters: { docIndex: number; content: string }[]
): ChapterReadoutRow[] {
  return chapters.map(({ docIndex, content }) => {
    const vitality = vitalityOf(content);
    const degeneration = degenerationOf(content);
    return {
      docIndex,
      charCount: vitality.charCount,
      burstiness: vitality.burstiness,
      particlePerThousand: degeneration.particlePerThousand,
      shortSentenceRatio: degeneration.shortSentenceRatio,
      meanSentenceLength: degeneration.meanSentenceLength
    };
  });
}

/* ────────────────────────── 全文批量读取 ────────────────────────── */

/**
 * 批量读取文档全文（真身从 SearchPanel 迁来，2026-10-10：书稿体检与搜索吃同一条通路，
 * 不许各抄一份 Promise.allSettled）。个别篇读不到就跳过——体检是尽力而为，不是全有全无。
 */
export async function loadAllDocContents(docs: BookDoc[]): Promise<BookDoc[]> {
  const results = await Promise.allSettled(
    docs.map(async (doc) => {
      const loaded = await window.mochen.readDoc(doc.relPath);
      return {
        relPath: doc.relPath,
        kind: doc.kind,
        title: doc.title,
        content: loaded.content
      } satisfies BookDoc;
    })
  );
  return results
    .filter((r): r is PromiseFulfilledResult<BookDoc> => r.status === "fulfilled")
    .map((r) => r.value);
}

/* ────────────────────────── ⑩ 腔调偏离（2026-11-10） ────────────────────────── */

/**
 * 逐章「还像不像这本书」的读数。
 *
 * 前九类报的都是**通用**病（套话、标点、重复句、对话失衡），这一类的参照物是**这本书自己**：
 * 先把已完稿正文量成一份腔调档案（`styleProfileOf`），再拿每一章去比（`styleDriftOf`）。
 * 它治的是另一种塌房——每章单独看都没毛病，合起来不像同一个人写的。
 *
 * 与⑦角色腔调漂移分工不同：⑦看**引语长度**（这个人说话变长了），这里看**叙述**（句长、
 * 长短句落差、对白比、标点脾气）。两条都只报「疑似」，不设判退线。
 */
export interface ChapterStyleRow {
  docIndex: number;
  title: string;
  /** 这一章量不出来（正文太短），此时下面四格全空。 */
  checked: boolean;
  /** 最该看的那一项（人话名，如「句长均值」）。 */
  label: string;
  /** 这一章的读数（已带单位）。 */
  draft: string;
  /** 这本书的常态（同一套单位）。 */
  base: string;
  severity: "off" | "warn" | "";
  advice: string;
}

/** 本书常态的一句话。样本不足时**明说不报**——立一份全 0 的档案比不报更误导。 */
export function bookStyleSentence(contents: readonly string[]): string {
  const profile = styleProfileOf(contents);
  if (profile === null || profile.rhythm === null) {
    return "完稿还不足 500 字，立不起这本书的腔调基线——开书前立手册，立出来的只会是别人的东西。";
  }
  const marks = STYLE_PROFILE_PUNCTUATION.map(({ key, label }) => {
    const density = profile.punctuation[key];
    return density > 0 ? `${label} ${density} 处/千字` : "";
  })
    .filter((text) => text !== "")
    .join("、");
  return (
    `这本书的常态：平均句长 ${profile.rhythm.mean} 字、长短句落差 ${profile.rhythm.spread}、` +
    `对白 ${Math.round(profile.dialogueRatio * 100)}%${marks === "" ? "" : `、${marks}`}` +
    `（样本 ${profile.charCount} 字）。`
  );
}

/**
 * 逐章比一次。排序：偏离大的在前（off → warn → 一致），同档按偏离量降序；
 * 量不出的章排在最后（它们不是「一致」，是「没法比」）。
 */
export function chapterStyleRows(
  contents: readonly string[],
  chapters: readonly { docIndex: number; title: string; content: string }[]
): ChapterStyleRow[] {
  const profile = styleProfileOf(contents);
  const rows = chapters.map((chapter): ChapterStyleRow => {
    const drift = styleDriftOf(profile, chapter.content);
    const worst = drift.worst;
    if (!drift.checked || worst === null) {
      return {
        docIndex: chapter.docIndex,
        title: chapter.title,
        checked: drift.checked,
        label: "",
        draft: "",
        base: "",
        severity: "",
        advice: ""
      };
    }
    return {
      docIndex: chapter.docIndex,
      title: chapter.title,
      checked: true,
      label: worst.label,
      draft: worst.draft,
      base: worst.base,
      severity: worst.severity,
      advice: worst.advice
    };
  });
  const rank = (row: ChapterStyleRow): number =>
    row.severity === "off" ? 0 : row.severity === "warn" ? 1 : 2;
  return rows.sort((x, y) => rank(x) - rank(y));
}
