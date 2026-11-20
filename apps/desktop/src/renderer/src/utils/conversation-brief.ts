/**
 * 「这本书现在到哪了」的判定（2026-11-20 · 对话区智能刀）。
 *
 * 【为什么要有这一份】
 * 打开一本书、对话区还是空的，中栏摆出来的是**一份静态产品说明书**：
 * 五张能力卡 + 六条「我可以帮你做这些」+ 五枚固定不变的 pill。
 * 每一句都成立，但**没有一句在说这本书现在到哪了、下一句该写什么**。
 * 作者把光标放进输入框时看到的，是手册，不是自己那本书的进度。
 *
 * ⇒ 这一份把「现状」现算出来：写到第几章、共多少字、人物几张、
 *   下一步该动哪一章。全部从 `book.docs` 里算，**不额外读盘**
 *   （`DocRef.chars` / `DocRef.title` 是 scan 顺路带出来的）。
 *
 * 【为什么住在 `.ts` 而不是 `.vue`】
 * 本仓的 `.vue` 既不过 `tsc` 也没有组件测试环境。判定写在模板里 =
 * 写了一段永远测不到的逻辑。放在这里，边界（无书 / 空书 / 写到一半）
 * 就是三条能钉住的断言。
 *
 * 【诚实纪律：没有数据就不显示，也不猜】
 *  - `DocRef.chars` 是可选字段。所以「字数」那一格只在**真的有文稿带回字数**时
 *    才出现——一个都没有就不出现，而不是显示「0 字」。
 *    显示「0 字」是在说「你一个字都没写」，那是假的。
 *  - 「上一稿停在哪一章」查不出来（没有「最后编辑时间」这份数据），
 *    所以**不说这句话**。只说「下一步该动哪一章」——那一章是看得见的
 *    （当前打开的，没打开就取第一章）。
 */

import type { DocRef } from "@mochen/contracts";

/** 这本书现在处在哪一步。 */
export type BriefStage = "no-book" | "empty-book" | "drafting";

export interface ConversationBriefInput {
  /** 有没有打开作品（`book.hasBook`）。 */
  hasBook: boolean;
  /** 书名（`book.meta.title`）。没书时是空串。 */
  title?: string;
  /** 本书全部文稿（`book.docs`）。顺序由 `sortDocsByOrder` 排好，就是作者排的章节顺序。 */
  docs: DocRef[];
  /** 当前打开的文稿路径（`book.activeDocTab`）。 */
  activeChapter?: string | null;
}

/** 状态条上的一格：先值后名（横排读作「3 章」）。 */
export interface BriefStat {
  label: string;
  value: string;
}

export interface ConversationBrief {
  stage: BriefStage;
  /** 书名（没书时是空串）。 */
  title: string;
  /** 章节数。 */
  chapterCount: number;
  /** 正文总字数；**没有任何文稿带回字数时是 null**（不是 0）。 */
  totalChars: number | null;
  /** 人物卡张数。 */
  characterCount: number;
  /** 正打开的那一章的标题；没打开章时是 null。 */
  currentChapter: string | null;
  /** 下一步该动的那一章的标题（没打开时取第一章）；一章都没有时是 null。 */
  targetChapter: string | null;
  /** 目标那一章的字数；没有字数时是 null。 */
  targetChapterChars: number | null;
  /** 目标那一章是不是第一章。 */
  targetIsFirstChapter: boolean;
  /** 状态条那几格。 */
  stats: BriefStat[];
  /** 一句话：这本书现在到哪了。 */
  headline: string;
  /** 一句话：接下来该干什么。 */
  nextStep: string;
}

/**
 * 字数怎么念。
 *
 * 一万以下照实念（"8,432 字"），一万以上折成万（"1.2 万字"）。
 * 不折的话，六位数往状态条上一摆会把那条挤成两行。
 */
export function briefCharText(chars: number): string {
  if (chars < 10000) return `${chars.toLocaleString("zh-CN")} 字`;
  return `${(chars / 10000).toFixed(1)} 万字`;
}

/** 本书里有多少章（按 kind 判，不靠路径前缀）。 */
function countChapters(docs: DocRef[]): number {
  return docs.filter((doc) => doc.kind === "chapter").length;
}

/** 人物卡张数。 */
function countCharacters(docs: DocRef[]): number {
  return docs.filter((doc) => doc.kind === "character").length;
}

/**
 * 正文总字数。
 *
 * 只累加**确实带回了字数**的文稿：一份都没带回来时返回 null（"不知道"），
 * 而不是 0（"一个字都没有"）。这两个是不同的事实。
 */
function sumChars(docs: DocRef[]): number | null {
  const counted = docs.filter(
    (doc): doc is DocRef & { chars: number } => typeof doc.chars === "number"
  );
  if (counted.length === 0) return null;
  return counted.reduce((sum, doc) => sum + (doc.chars ?? 0), 0);
}

/** 第一章（按 `docs` 的既有顺序）。 */
function firstChapter(docs: DocRef[]): DocRef | undefined {
  return docs.find((doc) => doc.kind === "chapter");
}

/** 正打开的那一篇；路径对不上就是 null（不猜「大概是第一篇」）。 */
function openDoc(docs: DocRef[], activeChapter: string | null): DocRef | undefined {
  const relPath = (activeChapter ?? "").trim();
  if (relPath === "") return undefined;
  return docs.find((doc) => doc.relPath === relPath);
}

/**
 * 现算「这本书现在到哪了」。
 *
 * 三档边界：
 *  - `no-book`：没打开作品 ⇒ 说「还没打开」，不装懂。
 *  - `empty-book`：有书但一章都没有 ⇒ 说「还是空的」，下一步是开第一章。
 *  - `drafting`：有章 ⇒ 报章数/字数/人物数，并指出下一步该动哪一章。
 */
export function conversationBrief(input: ConversationBriefInput): ConversationBrief {
  const title = (input.title ?? "").trim();
  const docs = input.docs;
  const chapterCount = countChapters(docs);
  const totalChars = sumChars(docs);
  const characterCount = countCharacters(docs);

  const open = openDoc(docs, input.activeChapter ?? null);
  const currentChapter = open?.title ?? null;

  /* 下一步动哪一章：开着的那一章，没开着就取第一章。
     这与 `utils/workbench-state.ts` 的 `workbenchTarget` 是同一个判定——
     那边给「点哪张卡」用，这边给「现在到哪了」用，同一份事实两处读。 */
  const target = open?.kind === "chapter" ? open : firstChapter(docs);
  const targetChapter = target?.title ?? null;
  const targetChapterChars =
    target !== undefined && typeof target.chars === "number" ? target.chars : null;
  const targetIsFirstChapter =
    target !== undefined && firstChapter(docs)?.relPath === target.relPath;

  const stats: BriefStat[] = [{ label: "章", value: `${chapterCount}` }];
  if (totalChars !== null) stats.push({ label: "字", value: briefCharText(totalChars) });
  stats.push({ label: "人物", value: `${characterCount}` });

  if (!input.hasBook) {
    return {
      stage: "no-book",
      title,
      chapterCount: 0,
      totalChars: null,
      characterCount: 0,
      currentChapter: null,
      targetChapter: null,
      targetChapterChars: null,
      targetIsFirstChapter: false,
      stats,
      headline: "还没打开作品",
      nextStep: "先挑一个作品目录，或者新建一本。"
    };
  }

  if (chapterCount === 0) {
    return {
      stage: "empty-book",
      title,
      chapterCount: 0,
      totalChars,
      characterCount,
      currentChapter: null,
      targetChapter: null,
      targetChapterChars: null,
      targetIsFirstChapter: false,
      stats,
      headline: `《${title}》还是空的`,
      nextStep: "先写第一章；大纲和人物可以随写随补。"
    };
  }

  return {
    stage: "drafting",
    title,
    chapterCount,
    totalChars,
    characterCount,
    currentChapter,
    targetChapter,
    targetChapterChars,
    targetIsFirstChapter,
    stats,
    headline: `《${title}》有 ${chapterCount} 章`,
    nextStep: targetChapter === null ? "先挑一章，接着往下写。" : `接着写《${targetChapter}》。`
  };
}
