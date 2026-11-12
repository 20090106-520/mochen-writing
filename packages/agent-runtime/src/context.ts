import type { AgentProfile, BibleEntry, ContextKind, ContextScope } from "@mochen/contracts";
import {
  CAST_MIN_NAME,
  castMention,
  castNames,
  contextKindLabel,
  parseCharacterCard,
  splitFrontmatter
} from "@mochen/contracts";

/**
 * 上下文包装配（spec §5「上下文包 = 当前章正文 + 大纲摘要 + 出场人物卡 + 前情提要 + 显式挂入的素材与技能」）。
 *
 * 纯函数、零 Electron 依赖：调用方（主进程）负责把正文读进来，这里只做切片与拼装。
 * 「装什么」完全由 profile.context 这份**数据**决定——agent-runtime 里没有一处
 * 写死「主笔就该怎么怎样」，所以新增第七枚档案不需要改这个文件。
 *
 * 这也是中栏顶部「上下文占用条」的数据源：assembleContext 的字数与条目数直接就是它要显示的东西，
 * 不另造一份估算。
 */

/** 上下文条目。kind 用于 UI 分组与标题，relPath 用于「点开这一条」。 */
export interface ContextItem {
  kind: ContextKind;
  relPath: string;
  title: string;
  text: string;
  chars: number;
  /** 这条是不是当前正在写的那一章（UI 用来标「本章」）。 */
  active: boolean;
}

export interface AssembleContextInput {
  profile: AgentProfile;
  activeDocRelPath: string | null;
  /**
   * scanBook 的结果，装配只读它的 relPath / kind / title / opening。
   * `opening`（2026-10-15）是 scan 顺路带出的首行非空行原文，给 `openings` 用——
   * 装配层不再为「其余章的首行」从 `contents` 读全文。
   */
  docs: readonly { relPath: string; kind: string; title: string; opening?: string }[];
  /** relPath → 正文全文。由主进程读好传进来，装配层不碰盘。 */
  contents: Readonly<Record<string, string>>;
  /** 用户显式挂入的 relPath（@ 引用 / 「加入当前上下文」/ 技能）。 */
  pinned?: readonly string[];
  /**
   * 挂入物里**不在书内文稿树上**的那些（技能库：全局 `<appData>/…/skills` 与书内 `.mochen/skills`）。
   * 正文由主进程读好传进来，relPath 与 pinned 里那一项对得上。
   */
  pinnedExtra?: readonly { relPath: string; title: string; text: string }[];
  /** 章节先后顺序；不给就按 docs 的出现顺序。 */
  chapterOrder?: readonly string[];
  /**
   * 故事圣经（`.mochen/data/story-bible.json`）的条目（2026-11-08 W-01）。
   *
   * 主进程读好、并按 contracts 的 `normalizeBibleEntries` 归好形状再传进来：
   * 文件缺失 / JSON 损坏 / 形状不认一律传空表。装配层不碰盘，也不会因为设定坏掉而抛错。
   */
  bible?: readonly BibleEntry[];
  /**
   * 判定「这条设定与本章有没有关系」的语料：当前章正文 + 章纲/大纲。
   *
   * 缺省时退回当前章正文（`contents[activeDocRelPath]`）；再缺就是空串——此时只按
   * importance 降级选取。语料只用于判名，不会成为上下文条目，所以不吃上下文额度。
   */
  bibleCorpus?: string;
}

export interface AssembledContext {
  items: ContextItem[];
  /** 装进去的总字数（已去空白口径，与 proseCharCount 同源）。 */
  chars: number;
  /** token 估算，见 estimateTokens。 */
  approxTokens: number;
  /**
   * 各章开头句（首个非空行，截到 CHAPTER_OPENING_CHARS）——按 docs 的章节顺序。
   * 提示词装配用它点名「别每章同一套起手式」；这轮模型看不见的头，才最容易被它写重。
   * 可选字段：老的装配结果（测试夹具）没有它，装配层按空清单处理。
   */
  openings?: string[];
  /**
   * 已装进上下文的角色卡上声明过的约束（2026-10-22）。人物卡正文剥掉了 frontmatter，
   * 提示词装配再把这几格念给模型听时读不到原字段，所以在装配时就带上。
   * 只含 voice / exit 有一项非空的卡；可选字段，老夹具不给就是空清单。
   */
  characterNotes?: CharacterNote[];
  /**
   * 因额度或相关性没装进来的设定条数（2026-11-08 W-01）：0 或 undefined 就不出「未完整」提示。
   * 提示词装配据此补一句「还有 N 条没载入」，让模型知道信息不全、不要凭印象补设定。
   */
  bibleOmitted?: number;
}

/** 一张已装进上下文的角色卡上的约束。 */
export interface CharacterNote {
  title: string;
  /** 专属说法（口头禅、用词习惯）；没写就是空表。 */
  voice: string[];
  /** 退场章的文稿相对路径；没写就是空串。 */
  exit: string;
}

/** 前情提要每章取多少字（spec §5：默认前 2 章的尾部摘要，各约 400 字）。 */
export const PRIOR_CHAPTER_TAIL_CHARS = 400;

/** 各章开头句进「起手式」清单时截多少字——一句 enough，多了就成正文倾倒。 */
export const CHAPTER_OPENING_CHARS = 24;

/**
 * token 估算：中文/日文按「一字约一 token」，其余按「四字符一 token」折算。
 * 刻意写死成一个公式并在这里单测——占用条上那个数字如果有两份算法，
 * 用户看到的百分比和实际发出去的上下文就对不上，那比不显示更糟。
 */
export function estimateTokens(text: string): number {
  if (text === "") return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    // CJK 统一表意文字（含扩展 A）、假名、韩文音节
    const isCjk =
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af);
    if (isCjk) cjk += 1;
    else other += 1;
  }
  return cjk + Math.ceil(other / 4);
}

/** 世界观那一族：scanBook 把它们各自放在独立目录，但装配时按一族对待。导出给主进程预读正文时用同一份。 */
export const WORLD_KINDS: ReadonlySet<string> = new Set([
  "worldview",
  "faction",
  "location",
  "timeline",
  "glossary",
  "volume"
]);

/** 剥掉 frontmatter 再截断——元数据不该混进给模型看的正文。 */
function body(text: string): string {
  return splitFrontmatter(text).body;
}

/**
 * 挂入技能在上下文包里**最多占多少字**（P0-2 起装的是清单行，不是正文）。
 *
 * 正文由 `use_skill` 按需读，所以这个额度正常碰不到；保留它是防一份异常夸张的
 * SKILL.md 描述（把 frontmatter description 写成一篇长文）把整轮提示词摊薄。
 *
 * 历史：P0-2 之前这里装整份技能正文，4000 是为了不让方法在结尾处被 800 字的口径截掉；
 * 现在技能只进清单，正文读取仍走 `readSkill`，不受这里的上限影响。
 */
export const PINNED_SKILL_CHARS = 4000;

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

/**
 * 故事圣经（W-01）的额度：单条 800 字与世界观文稿同一档，整族 2400 字（约三条）。
 *
 * 设定面板不是正文——大书几十条人物/地点，整份塞进来会挤掉本章正文与前情，
 * 所以这里和文稿一样按额度截断，只是多了一条「与本章相关」的取舍。
 */
export const BIBLE_ENTRY_CHARS = 800;
export const BIBLE_TOTAL_CHARS = 2400;

const BIBLE_TYPE_ORDER: Record<BibleEntry["type"], number> = {
  character: 0,
  location: 1,
  timeline: 2
};
const BIBLE_TYPE_LABEL: Record<BibleEntry["type"], string> = {
  character: "人物",
  location: "地点",
  timeline: "事件"
};

/**
 * 取舍档位（2026-11-08 W-01）。超额度时**严格按这个顺序**舍弃：
 * ① 标题/别名在本章正文或章纲里出现过（本章真要用的）；
 * ② 本章没提到、但 importance=high（保住主线设定）；
 * ③ 本章没提到、importance=medium；
 * ④ 其余（low / 没填）。
 *
 * 同档内先人物、再地点、再事件（人物最容易写成另一个人）；
 * 再按更新时间新的优先，最后按 id，保证同一份数据每次装出来的顺序都一样。
 */
function bibleTier(mentioned: boolean, importance: BibleEntry["importance"]): number {
  if (mentioned) return 0;
  if (importance === "high") return 1;
  if (importance === "medium") return 2;
  return 3;
}

/** 去空白后再比：两份文本只差换行/缩进时，语义上就是重复。 */
function collapse(text: string): string {
  return text.replace(/\s+/g, "");
}

/**
 * 这条设定和本章有没有关系：标题（人物另加别名）出现在语料里。
 * 名字短于 `CAST_MIN_NAME` 的不判——单字名在整章正文里必然到处命中，等于全装。
 */
function bibleMentioned(entry: BibleEntry, corpus: string): boolean {
  if (corpus === "") return false;
  const names =
    entry.type === "character" ? [entry.title, ...(entry.aliases ?? [])] : [entry.title];
  for (const raw of names) {
    const name = raw.trim();
    if ([...name].length < CAST_MIN_NAME) continue;
    if (corpus.includes(name)) return true;
  }
  return false;
}

/**
 * 一条设定变成给模型看的文字。只写「人物：林夜」而不写身份/别名，
 * 模型就抓不到这个名字在本章该怎么用；限定只带该类型真有的那几格，不把别的类型的空字段念出来。
 */
function bibleEntryText(entry: BibleEntry): string {
  const head = `${BIBLE_TYPE_LABEL[entry.type]}：${entry.title.trim() || "未命名"}`;
  const extras: string[] = [];
  if (entry.role !== undefined) extras.push(`身份：${entry.role}`);
  if (entry.aliases !== undefined && entry.aliases.length > 0)
    extras.push(`别名：${entry.aliases.join("、")}`);
  if (entry.type === "location" && entry.parentLocation !== undefined)
    extras.push(`位于：${entry.parentLocation}`);
  if (entry.type === "timeline" && entry.eventDate !== undefined)
    extras.push(`时间：${entry.eventDate}`);
  if (entry.tags.length > 0) extras.push(`标签：${entry.tags.join("、")}`);
  const content = entry.content.trim();
  if (content !== "") extras.push(`设定：${content}`);
  return [head, ...extras].join("；");
}

function makeItem(
  kind: ContextItem["kind"],
  doc: { relPath: string; title: string },
  text: string,
  active: boolean
): ContextItem {
  return { kind, relPath: doc.relPath, title: doc.title, text, chars: text.length, active };
}

export function assembleContext(input: AssembleContextInput): AssembledContext {
  const { profile, docs, contents } = input;
  const scope: ContextScope = profile.context;
  const active = input.activeDocRelPath;
  const items: ContextItem[] = [];
  /** 已装进上下文的角色卡约束（随人物卡一起装，提示词装配那边直接念，不再读盘）。 */
  const notes: CharacterNote[] = [];
  const seen = new Set<string>();

  const push = (item: ContextItem): void => {
    if (item.text === "" || seen.has(item.relPath)) return;
    seen.add(item.relPath);
    items.push(item);
  };

  const docByPath = new Map(docs.map((d) => [d.relPath, d]));
  const textOf = (relPath: string): string => body(contents[relPath] ?? "");
  // 书外的挂入物（技能）：正文由调用方读好传进来，装配层不碰盘。键仍是 relPath，
  // 于是 ⑧ 那条循环书内书外走同一遍——不为技能单开一个分支。
  const pinnedExtraOf = new Map((input.pinnedExtra ?? []).map((item) => [item.relPath, item]));

  // ① 当前章：主笔按 excerpt 截断，续写与审稿要 full（否则接不上口吻 / 看不全全章）
  if (scope.currentChapter !== "none" && active !== null) {
    const doc = docByPath.get(active);
    const text = textOf(active);
    if (doc && text !== "") {
      const cut = scope.currentChapter === "full" ? text : clip(text, 4000);
      push(makeItem("chapter", doc, cut, true));
    }
  }

  // ② 大纲摘要
  if (scope.outlineSummary) {
    for (const doc of docs) {
      if (doc.kind !== "outline") continue;
      push(makeItem("outline", doc, clip(textOf(doc.relPath), 1200), false));
    }
  }

  // ③ 出场人物卡：spec §5 叫「**出场**人物卡」，判据就是字面义——人名（卡题）出现在
  //    当前章正文里才装。此前的实现是无差别全装：大书 20 张卡 × 800 字把上下文摊薄成
  //    每张卡都只剩个名字，模型写对话反而抓不住本章真要用的那几个人的性子。
  //    判定用**未截断**的当前章全文（contents 里的），excerpt 档截掉的出场也算出场。
  //    没开章（active === null）时退回全装：让模型补人物设定、做全书审读时仍要看全家福。
  if (scope.castCharacters) {
    const stage = active === null ? "" : textOf(active);
    for (const doc of docs) {
      if (doc.kind !== "character") continue;
      const raw = contents[doc.relPath] ?? "";
      const text = body(raw);
      if (text === "") continue;
      // 出场判据（2026-10-22）：卡题 **与别名** 任一出现在本章正文里都算出场。
      // 此前只认卡题——「李深」这一章通篇叫「老李」，他的人设卡就装不进来，
      // 而模型正好在这一章把他写成另一个人。名字最短两个字，与 `book_cast` 同口径。
      const meta = parseCharacterCard(raw);
      if (stage !== "" && castMention(stage, castNames(doc.title, meta)) === "") continue;
      push(makeItem("character", doc, clip(text, 800), false));
      if (meta.voice.length > 0 || meta.exit !== "") {
        notes.push({ title: doc.title, voice: meta.voice, exit: meta.exit });
      }
    }
  }

  // ④ 前情提要：本章之前的 N 章，取尾部
  if (scope.priorChapters > 0) {
    const order =
      input.chapterOrder && input.chapterOrder.length > 0
        ? input.chapterOrder
        : docs.filter((d) => d.kind === "chapter").map((d) => d.relPath);
    const activeIndex = active === null ? -1 : order.indexOf(active);
    const start = activeIndex < 0 ? order.length : activeIndex;
    const prior = order.slice(Math.max(0, start - scope.priorChapters), start);
    for (const relPath of prior) {
      const doc = docByPath.get(relPath);
      if (!doc) continue;
      const text = textOf(relPath);
      if (text === "") continue;
      push(makeItem("chapter", doc, clip(text.slice(-PRIOR_CHAPTER_TAIL_CHARS), 2000), false));
    }
  }

  // ⑤ 全书章节摘要（总编看节奏）
  if (scope.chapterDigests) {
    for (const doc of docs) {
      if (doc.kind !== "chapter" || doc.relPath === active) continue;
      push(makeItem("chapter", doc, clip(textOf(doc.relPath), 300), false));
    }
  }

  // ⑥ 素材库（2026-10-23 额度 600 → 1000）：导入的外部材料常是整段设定 / 资料，
  // 600 字往往只够开头一句，等于「导进来了 AI 也只看到个标题」。1000 与世界观一族同量级。
  if (scope.materials) {
    for (const doc of docs) {
      if (doc.kind !== "material") continue;
      push(makeItem("material", doc, clip(textOf(doc.relPath), 1000), false));
    }
  }

  // ⑦ 世界观一族
  if (scope.worldbuilding) {
    for (const doc of docs) {
      if (!WORLD_KINDS.has(doc.kind)) continue;
      push(makeItem("world", doc, clip(textOf(doc.relPath), 800), false));
    }
  }

  // ⑧ 故事圣经（2026-11-08 W-01）：设定面板里的条目过去从不进上下文，作者写「林夜」，
  //    模型仍当新角色。这里**不看 profile.context.worldbuilding**——主笔档案通常不装世界观文稿，
  //    而"说了不记得"正是主笔最要命的毛病；设定库只按本章相关性进，额度也单独限死。
  //
  //    去重两条：
  //    ① 同名文稿已经装进来（人物卡 / 世界观文稿），同名的设定不再说第二遍；
  //    ② 设定正文与已装条目同文（去空白后包含关系），也不再说第二遍。
  //
  //    超额度时按 `bibleTier` 的档位舍弃：本章提到的 → high → medium → 其余；
  //    同档先人物、再地点、再事件。整条装不下就跳过（继续看后面更短的），
  //    不做半句截断——半个设定比没有更误导。没装进去的条数记进 `bibleOmitted`，
  //    提示词装配会补一句「信息没带全」，让模型别凭印象补设定。
  const bible = input.bible ?? [];
  let bibleOmitted = 0;
  if (bible.length > 0) {
    const corpus = input.bibleCorpus ?? (active === null ? "" : textOf(active));
    const characterDocTitles = new Set(
      items.filter((item) => item.kind === "character").map((item) => item.title.trim())
    );
    const worldDocTitles = new Set(
      items.filter((item) => item.kind === "world").map((item) => item.title.trim())
    );
    const occupiedTexts = items
      .map((item) => collapse(item.text))
      .filter((text) => text.length >= 24);
    const seenInBible = new Set<string>();
    let deduped = 0;
    let loaded = 0;
    let budget = BIBLE_TOTAL_CHARS;
    const ranked = bible
      .filter((entry) => !entry.archived)
      .filter((entry) => entry.title.trim() !== "" || entry.content.trim() !== "")
      .map((entry) => ({ entry, mentioned: bibleMentioned(entry, corpus) }))
      .sort((a, b) => {
        const tier =
          bibleTier(a.mentioned, a.entry.importance) - bibleTier(b.mentioned, b.entry.importance);
        if (tier !== 0) return tier;
        const type = BIBLE_TYPE_ORDER[a.entry.type] - BIBLE_TYPE_ORDER[b.entry.type];
        if (type !== 0) return type;
        if (a.entry.updatedAt !== b.entry.updatedAt) return b.entry.updatedAt - a.entry.updatedAt;
        return a.entry.id.localeCompare(b.entry.id);
      });
    for (const { entry } of ranked) {
      const title = entry.title.trim();
      const key = `${entry.type}:${title}`;
      // 同一份 JSON 里同类型同名重复（手工合并过的档）只留排序靠前的一条
      if (seenInBible.has(key)) {
        deduped += 1;
        continue;
      }
      seenInBible.add(key);
      // ① 同名文稿已经装进来：人物卡写过的角色、世界观文稿写过的地点/事件，不重复注入
      if (
        (entry.type === "character" && characterDocTitles.has(title)) ||
        (entry.type !== "character" && worldDocTitles.has(title))
      ) {
        deduped += 1;
        continue;
      }
      const text = bibleEntryText(entry);
      const entryBody = collapse(entry.content);
      // ② 正文与已装条目同文（只比 24 字以上的，避免"他笑了"这种短句误杀）
      if (
        text === "" ||
        (entryBody.length >= 24 && occupiedTexts.some((known) => known.includes(entryBody)))
      ) {
        deduped += 1;
        continue;
      }
      const relPath = `bible:${entry.type}:${entry.id}`;
      if (seen.has(relPath)) {
        deduped += 1;
        continue;
      }
      const clipped = clip(text, BIBLE_ENTRY_CHARS);
      if (clipped.length > budget) continue;
      budget -= clipped.length;
      push(makeItem("world", { relPath, title }, clipped, false));
      occupiedTexts.push(collapse(clipped));
      loaded += 1;
    }
    bibleOmitted = Math.max(0, ranked.length - deduped - loaded);
  }

  // ⑨ 用户显式挂入的（@ 引用 / 加入当前上下文 / 技能）—— 挂了就一定装，不看 scope
  //    挂入物分两类：书内文稿（在 docByPath 里）与书外的技能（不在）。先查书内，
  //    查不到再查 pinnedExtra——同一条通路，技能不是特例分支，只是「正文不在这本书的树上」。
  for (const relPath of input.pinned ?? []) {
    const bookDoc = docByPath.get(relPath);
    if (bookDoc) {
      const text = textOf(relPath);
      if (text === "") continue;
      push(makeItem("pinned", bookDoc, clip(text, 800), relPath === active));
      continue;
    }
    const extra = pinnedExtraOf.get(relPath);
    if (!extra) continue;
    // P0-2：`pinnedExtra` 现在装的是**技能清单**（名称/用途/何时用），不是技能正文；
    // 正文由 `use_skill` 按 id 按需读取。kind="skill" 让占用条把这一格单独计量，
    // 不再和 @ 挂入的文稿混在同一行。clip 仍是安全上限：清单短句永远碰不到它。
    push(
      makeItem(
        "skill",
        { relPath, title: extra.title },
        clip(body(extra.text), PINNED_SKILL_CHARS),
        false
      )
    );
  }

  const chars = items.reduce((sum, item) => sum + item.chars, 0);
  // 各章开头句（2026-10-10 四段 / 2026-10-15 改源）：从 DocRef.opening 取——scan 顺路提取的
  // 首个非空行原文，口径与旧实现逐字同源（同一个 body、同一句 split-首行非空），只是提取时机
  // 从「装配时读全文」挪到「扫描时顺路」。这让 assembleFor 不必再为「其余章的首行」单独跑
  // readDocFile——1000 章的书上 readDocFile 次数从 1004 降到个位数。截到 CHAPTER_OPENING_CHARS
  // 仍在这一步做（scan 存原文不截，包边界不许 fs-store import 这儿的常量）。
  const openings = docs
    .filter((doc) => doc.kind === "chapter")
    .map((doc) => doc.opening ?? "")
    .filter((line) => line !== "")
    .map((line) => clip(line, CHAPTER_OPENING_CHARS));
  return {
    items,
    chars,
    approxTokens: estimateTokens(items.map((i) => i.text).join("\n")),
    openings,
    characterNotes: notes,
    // exactOptionalPropertyTypes 下不能显式写 undefined：没省略项就干脆不出这格
    ...(bibleOmitted > 0 ? { bibleOmitted } : {})
  };
}

/**
 * 粗粒度预算：按 `profile.context` 选出「这一轮要读全文的篇」清单（2026-10-15 读放大刀）。
 *
 * 调用方（assembleFor）据此只读会被 `assembleContext` 装进 items 的那些篇——1000 章的书
 * 主笔档案（priorChapters=2, chapterDigests=false）只读 3 章，而非全量 1004 次 readDocFile。
 *
 * **粗粒度**是刻意的：castCharacters 预算所有 character，而 assembleContext 只装名字在当前章的
 * ——「名字在不在当前章」这条细粒度判据仍只住 assembleContext 一份，不抄到主进程。不变量
 * `预算 ⊇ 实装` 钉在 context.test.ts（删掉非预算章的 contents 不影响 items/openings/chars）。
 * priorChapters 的 order/slice 判定与 assembleContext 逐字同源（含 active 不在 order 里取最后 N 章）。
 */
export interface SelectBudgetInput {
  scope: ContextScope;
  docs: readonly { relPath: string; kind: string }[];
  activeDocRelPath: string | null;
  pinned?: readonly string[];
  chapterOrder?: readonly string[];
}

export function selectBudgetDocPaths(input: SelectBudgetInput): readonly string[] {
  const { scope, docs, activeDocRelPath: active, pinned, chapterOrder } = input;
  const budget = new Set<string>(pinned ?? []);
  if (scope.currentChapter !== "none" && active !== null) budget.add(active);
  if (scope.outlineSummary) for (const d of docs) if (d.kind === "outline") budget.add(d.relPath);
  if (scope.castCharacters) for (const d of docs) if (d.kind === "character") budget.add(d.relPath);
  if (scope.priorChapters > 0) {
    const order =
      chapterOrder && chapterOrder.length > 0
        ? chapterOrder
        : docs.filter((d) => d.kind === "chapter").map((d) => d.relPath);
    const activeIndex = active === null ? -1 : order.indexOf(active);
    const start = activeIndex < 0 ? order.length : activeIndex;
    for (const rel of order.slice(Math.max(0, start - scope.priorChapters), start)) budget.add(rel);
  }
  if (scope.chapterDigests)
    for (const d of docs) if (d.kind === "chapter" && d.relPath !== active) budget.add(d.relPath);
  if (scope.materials) for (const d of docs) if (d.kind === "material") budget.add(d.relPath);
  if (scope.worldbuilding) for (const d of docs) if (WORLD_KINDS.has(d.kind)) budget.add(d.relPath);
  return [...budget];
}

/**
 * 把装配结果拼成给模型看的提示词块。
 * 没有条目时返回空串——调用方据此判断「不要注入一段空标题」。
 *
 * 【技能条目合并成一段清单（2026-11-12）】原先每条技能都占一个 `【技能·名】` 块，挂几条就是
 * 几个同形块，块里还缀着同一句「正文未载入……」——十几行读下来是一个样子的东西重复十几遍，
 * 这正是模型最容易照抄的形状（也是它写正文时冒模板腔的来源之一）。技能的正文本来就不在这里
 * （`use_skill` 现读），它和「一章正文」并列本来就不该同形：合并成一段清单，
 * 标签仍走 `contextKindLabel("skill")` 一处，与占用条那格口径不变。
 * 读法说明只说一次，由上下文包末尾的 `skillHint` 承担（`agent-service.ts`）。
 */
export function renderContextBlock(assembled: AssembledContext): string {
  if (assembled.items.length === 0) return "";
  const lines: string[] = [];
  // 连着的技能条目合成一段。技能在 pinned 里总排在书内挂入物之后（见 turn-context 的
  // `[...pinned, ...skills]`），所以这里几乎总是「整段连续」；万一夹了别的条目，就断成两段清单。
  let skillRun: ContextItem[] = [];
  const flushSkills = (): void => {
    if (skillRun.length === 0) return;
    lines.push(`【${contextKindLabel("skill", false)}·挂入 ${skillRun.length} 份】`);
    for (const item of skillRun) {
      // 清单行自己就带名称（`skillBriefLine`）；外部直接塞 text 的场合（测试夹具、旧数据）
      // 补上 title，否则一行里只剩用途、看不出这是哪一份技能。
      lines.push(
        `- ${item.text.startsWith(item.title) ? item.text : `${item.title}：${item.text}`}`
      );
    }
    skillRun = [];
  };
  for (const item of assembled.items) {
    if (item.kind === "skill") {
      skillRun.push(item);
      continue;
    }
    flushSkills();
    lines.push(`【${contextKindLabel(item.kind, item.active)}·${item.title}】`, item.text);
  }
  flushSkills();
  // 设定没带全时明说（W-01）：模型不会因为少了几条设定就停下，反而会顺手把缺的地方编圆。
  // 这句话是给模型看的提示，不是给用户看的——用户侧由占用条显示"设定"这一族占了多少。
  if ((assembled.bibleOmitted ?? 0) > 0) {
    lines.push(
      `【设定库·未完整】另有 ${assembled.bibleOmitted} 条设定因额度或与本章无关没有载入；` +
        `写到这些人物/地点/事件时先向用户确认，不要凭印象补设定。`
    );
  }
  return lines.join("\n");
}
