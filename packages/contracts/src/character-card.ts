import { frontmatterField, frontmatterList, splitFrontmatter } from "./frontmatter.js";

/**
 * 人物约束卡的形状与判定（2026-10-22）。
 *
 * 存在的理由：用户点名的短板是「多角色设定一致性不足」与「跨章伏笔引用回归」。
 * 这两件事的共同点是——**能自动判的只有作者自己声明过的东西**。从正文里统计推断
 * 「这个人写得像不像」要真人语料分位（本仓不编数），所以这里只认人物卡上写明的三格：
 *
 * ```yaml
 * ---
 * title: 李深
 * aliases: [老李, 深爷]
 * voice: ["少废话", "闸上不许跑"]
 * exit: chapters/21-沉船.md
 * ---
 * ```
 *
 * - `aliases`：出场的另一种叫法（C5 出场判据用）。与 `book_cast` 同口径：名字至少两个字，
 *   一个字的名字在正文里到处撞上，数出来的「出场」没有意义。
 * - `voice`：这个人的专属说法（口头禅、用词习惯）。只在**他完全不在场**的章节里出现才报「疑似」——
 *   同场出现不判（可能是别人转述他的话，宁可漏，不冤枉）。
 * - `exit`：退场章。此后仍在场只**提示**，不阻断（回忆、转述、他人提及都合法，文案里写明）。
 *
 * 三条判定纪律：
 * 1. 不猜语义：只做子串命中，不做近似匹配与统计阈值；
 * 2. 不替作者下结论：报出来的是「这里有处对不上，自己看一眼」，不是「必须改」；
 * 3. 凑不齐证据就不报：每条告警都要能指到「哪张卡、哪一章、哪一行、哪段原文」。
 *    读不到正文的篇章跳过并在数据缺口里说明，不拿「没读到」当「没出现」。
 */

/** 名字（卡题或别名）的最短长度：一个字的名字在正文里到处撞，不算出场。与 `book_cast` 同口径。 */
export const CAST_MIN_NAME = 2;

/** 口头禅的最短长度：更短的串（「行」「好」）在正文里人人都在说，判不出归属。 */
export const VOICE_MIN_CHARS = 3;

/** 告警里引用原文的最大长度（展示额度，不是判据）。 */
export const CAST_QUOTE_CHARS = 24;

export interface CharacterCardMeta {
  /** 别名表（已去重、已剔除空串与过短的项）。 */
  aliases: string[];
  /** 专属说法表（原样保留，长度不足的项在判定时单列为数据缺口）。 */
  voice: string[];
  /** 退场章的文稿相对路径；没写就是空串。 */
  exit: string;
}

export function parseCharacterCard(raw: string): CharacterCardMeta {
  const { block } = splitFrontmatter(raw);
  const aliases: string[] = [];
  for (const alias of frontmatterList(block, "aliases")) {
    if (!aliases.includes(alias)) aliases.push(alias);
  }
  return {
    aliases,
    voice: frontmatterList(block, "voice"),
    exit: frontmatterField(block, "exit").trim()
  };
}

/**
 * 一个角色在正文里的全部叫法：卡题在前，别名在后。
 * 卡题与别名短于 `CAST_MIN_NAME` 的丢掉（不是「没这个角色」，是「这个名字判不了出场」）。
 */
export function castNames(title: string, meta: CharacterCardMeta): string[] {
  const names: string[] = [];
  for (const name of [title.trim(), ...meta.aliases]) {
    if ([...name].length < CAST_MIN_NAME) continue;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** 这一章里出现的是他的哪个叫法；没出现回空串。 */
export function castMention(text: string, names: readonly string[]): string {
  for (const name of names) {
    if (text.includes(name)) return name;
  }
  return "";
}

/** 1-based 行号；找不到回 0。 */
function lineOf(text: string, at: number): number {
  if (at < 0) return 0;
  let line = 1;
  for (let i = 0; i < at && i < text.length; i += 1) if (text[i] === "\n") line += 1;
  return line;
}

function quoteOf(text: string, at: number, length: number): string {
  const lineStart = text.lastIndexOf("\n", at - 1) + 1;
  const nextBreak = text.indexOf("\n", at);
  const lineEnd = nextBreak === -1 ? text.length : nextBreak;
  const raw = text.slice(lineStart, lineEnd).trim();
  if (raw === "") return text.slice(at, at + length);
  const chars = [...raw];
  return chars.length <= CAST_QUOTE_CHARS ? raw : `${chars.slice(0, CAST_QUOTE_CHARS).join("")}…`;
}

/** 三层：硬伤（数据自己打架 / 指空）、疑似（约束与正文对不上）、数据缺口（缺字段，判不了）。 */
export type CastFindingLevel = "defect" | "suspect" | "gap";

export interface CastFinding {
  level: CastFindingLevel;
  /** C2 口头禅归属 / C3 退场后仍在场 / C4 登记完整性。 */
  code: "C2" | "C3" | "C4";
  /** 出事的那张人物卡（标题）。 */
  card: string;
  /** 人物卡的文稿相对路径。 */
  cardPath: string;
  /** 给作者看的一句中文。 */
  message: string;
  /** 命中的那一章（书内相对路径）；空串 = 没有具体章节。 */
  chapter: string;
  /** 1-based 行号；0 = 没有具体位置。 */
  line: number;
  /** 命中的原文片段（截断过）；空串 = 没有。 */
  quote: string;
}

export interface CastCardInput {
  relPath: string;
  title: string;
  meta: CharacterCardMeta;
}

export interface CastChapterInput {
  relPath: string;
  /** 正文（已剥围栏）。读不到时不要传进来——不拿「没读到」当「没出现」。 */
  text: string;
}

const LEVEL_ORDER: Record<CastFindingLevel, number> = { defect: 0, suspect: 1, gap: 2 };

/**
 * 逐条核对人物卡上声明过的约束。`chapters` 的顺序就是章节顺序（`docs` 的顺序即盘上顺序），
 * C3 的「退场之后」按这个顺序算，不另排一份（排序口径全仓只住 scan 一处）。
 */
export function checkCast(
  cards: readonly CastCardInput[],
  chapters: readonly CastChapterInput[],
  knownPaths: readonly string[]
): CastFinding[] {
  const findings: CastFinding[] = [];
  const known = new Set(knownPaths);
  const chapterIndex = new Map(chapters.map((chapter, i) => [chapter.relPath, i]));

  // C2 归属冲突：同一个说法被两张卡声明——数据自己打架，先于一切正文判定报出来。
  const owners = new Map<string, CastCardInput[]>();
  for (const card of cards) {
    for (const phrase of card.meta.voice) {
      const key = phrase.replace(/\s/g, "");
      if (key === "") continue;
      const list = owners.get(key) ?? [];
      if (!list.some((one) => one.relPath === card.relPath)) list.push(card);
      owners.set(key, list);
    }
  }
  for (const [phrase, list] of owners) {
    if (list.length < 2) continue;
    const first = list[0]!;
    findings.push({
      level: "defect",
      code: "C2",
      card: first.title,
      cardPath: first.relPath,
      message: `「${phrase}」同时被 ${list.map((one) => `「${one.title}」`).join("、")} 声明为专属说法——先定它到底是谁的口头禅。`,
      chapter: "",
      line: 0,
      quote: phrase
    });
  }

  for (const card of cards) {
    const names = castNames(card.title, card.meta);
    const phrases = card.meta.voice.filter(
      (phrase) => [...phrase].length >= VOICE_MIN_CHARS && phrase.trim() !== ""
    );

    // C4 登记完整性：写了退场章，但那一篇不在书里（改章节名之后最常见）。
    if (card.meta.exit !== "" && !known.has(card.meta.exit)) {
      findings.push({
        level: "defect",
        code: "C4",
        card: card.title,
        cardPath: card.relPath,
        message: `退场章指向的「${card.meta.exit}」在书里找不到——改过章节名或路径之后，这条线已经指空了。`,
        chapter: "",
        line: 0,
        quote: card.meta.exit
      });
    } else if (card.meta.exit !== "" && !chapterIndex.has(card.meta.exit)) {
      findings.push({
        level: "gap",
        code: "C4",
        card: card.title,
        cardPath: card.relPath,
        message: `退场章「${card.meta.exit}」不是章节文稿，退场顺序判不了。`,
        chapter: "",
        line: 0,
        quote: card.meta.exit
      });
    }

    // 数据缺口：写了的专属说法短于判据下限，无法归属。
    const short = card.meta.voice.filter(
      (phrase) => phrase.trim() !== "" && [...phrase].length < VOICE_MIN_CHARS
    );
    if (short.length > 0) {
      findings.push({
        level: "gap",
        code: "C2",
        card: card.title,
        cardPath: card.relPath,
        message: `专属说法 ${short.map((one) => `「${one}」`).join("、")} 不足 ${VOICE_MIN_CHARS} 字，判不出是谁说的（太短的串正文里人人都在说）。`,
        chapter: "",
        line: 0,
        quote: ""
      });
    }

    const exitAt = card.meta.exit === "" ? -1 : (chapterIndex.get(card.meta.exit) ?? -1);

    for (const chapter of chapters) {
      // C2 口头禅串味：他**完全不在场**（卡题与别名一个都没出现）却出现了他的专属说法。
      // 同场一律不判——转述、旁人的模仿都合法，那要读语义，不在确定性判据的范围里。
      const mentioned = names.length === 0 ? "" : castMention(chapter.text, names);
      if (mentioned === "" && names.length > 0) {
        for (const phrase of phrases) {
          const at = chapter.text.indexOf(phrase);
          if (at === -1) continue;
          findings.push({
            level: "suspect",
            code: "C2",
            card: card.title,
            cardPath: card.relPath,
            message: `「${card.title}」这一章完全没出场，却出现了他声明过的说法「${phrase}」——是别人在学他，还是本该写他却漏了名字？`,
            chapter: chapter.relPath,
            line: lineOf(chapter.text, at),
            quote: quoteOf(chapter.text, at, phrase.length)
          });
          break;
        }
      }

      // C3 退场之后仍在场：只提示，不阻断——回忆、转述、他人提及都合法。
      if (exitAt < 0 || names.length === 0) continue;
      const index = chapterIndex.get(chapter.relPath) ?? -1;
      if (index <= exitAt) continue;
      if (mentioned === "") continue;
      const at = chapter.text.indexOf(mentioned);
      findings.push({
        level: "suspect",
        code: "C3",
        card: card.title,
        cardPath: card.relPath,
        message: `「${card.title}」的退场章是「${card.meta.exit}」，这一章之后又出现了「${mentioned}」——是回忆、转述，还是退场没写住？（这两种都合法，看一眼就行）`,
        chapter: chapter.relPath,
        line: lineOf(chapter.text, at),
        quote: quoteOf(chapter.text, at, mentioned.length)
      });
    }
  }

  return findings.sort((a, b) => {
    const byLevel = LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level];
    if (byLevel !== 0) return byLevel;
    const byCard = a.card.localeCompare(b.card, "zh");
    if (byCard !== 0) return byCard;
    return a.chapter.localeCompare(b.chapter, "zh");
  });
}

/** 三层的中文说法。穷尽表：加一档而不写这里，编译不过。 */
const CAST_LEVEL_LABELS: Record<CastFindingLevel, string> = {
  defect: "硬伤",
  suspect: "疑似",
  gap: "数据缺口"
};

export function castLevelLabel(level: CastFindingLevel): string {
  return CAST_LEVEL_LABELS[level];
}

/** 判据本身说给人听的那句「这里不判什么」——与时间线核对底部那块同一用途。 */
export const CAST_BLIND_NOTE = "这几样查不出来，别指望这张表";
export const CAST_BLIND_SPOT: readonly { label: string; hint: string }[] = [
  {
    label: "写得像不像这个人",
    hint: "要判断「这句话不像他会说的」，得读语义；本仓不拿统计推断冒充判据。"
  },
  {
    label: "没写进人物卡的约束",
    hint: "只判你声明过的：没写 aliases / voice / exit 的角色，这张表管不到。"
  },
  {
    label: "角色状态与关系变化",
    hint: "「他这时候该不该知道这件事」要从正文推人物状态，不是确定性判据。"
  }
];
