import type { AgentProfile, ContextKind, ContextScope } from "@mochen/contracts";
import { contextKindLabel, splitFrontmatter } from "@mochen/contracts";

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
  /** scanBook 的结果，装配只读它的 relPath / kind / title。 */
  docs: readonly { relPath: string; kind: string; title: string }[];
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
}

export interface AssembledContext {
  items: ContextItem[];
  /** 装进去的总字数（已去空白口径，与 proseCharCount 同源）。 */
  chars: number;
  /** token 估算，见 estimateTokens。 */
  approxTokens: number;
}

/** 前情提要每章取多少字（spec §5：默认前 2 章的尾部摘要，各约 400 字）。 */
export const PRIOR_CHAPTER_TAIL_CHARS = 400;

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
 * 挂入技能那份正文给模型留多少字（2026-10-07 真机逮到的）。
 *
 * 【原来是多少、为什么是错的】技能走的是 `clip(text, 800)`——那是**书内文稿摘录**的额度：
 * 一份稿子塞进上下文只取八百字是合理的。技能不是稿子，它是一套**方法**，
 * 而方法被砍掉尾巴等于让模型照着一份残缺的操作步骤干活，还没有一句「以下被截断」。
 *
 * 真机证据：市场首批五条正文分别是 981 / 1000 / 723 / 690 / 843 字（整份 SKILL.md），
 * 剥掉 frontmatter 后 853 / 872 / 723 / 690 / 843。第一条与第五条都超过 800，
 * 于是**用户装上市场技能后，方法正好在结尾处被截掉**——
 * 而占用条安静地报 801（800 + 省略号），看上去像「装上了」。
 *
 * 【为什么是 4000 而不是不限】仍要一个上限：技能目录是用户可写的，
 * 一份十万字的 SKILL.md 不该把整轮上下文吃光。4000 足够装下任何一份正经方法，
 * 又比当前章的全量（full 时无上限）小一个量级。真到顶了仍然是**截断**而不是丢弃，
 * 用户至少还拿到前四千字。
 */
export const PINNED_SKILL_CHARS = 4000;

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
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

  // ③ 出场人物卡
  if (scope.castCharacters) {
    for (const doc of docs) {
      if (doc.kind !== "character") continue;
      push(makeItem("character", doc, clip(textOf(doc.relPath), 800), false));
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

  // ⑥ 素材库
  if (scope.materials) {
    for (const doc of docs) {
      if (doc.kind !== "material") continue;
      push(makeItem("material", doc, clip(textOf(doc.relPath), 600), false));
    }
  }

  // ⑦ 世界观一族
  if (scope.worldbuilding) {
    for (const doc of docs) {
      if (!WORLD_KINDS.has(doc.kind)) continue;
      push(makeItem("world", doc, clip(textOf(doc.relPath), 800), false));
    }
  }

  // ⑧ 用户显式挂入的（@ 引用 / 加入当前上下文 / 技能）—— 挂了就一定装，不看 scope
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
    // 与书内挂入同形：先剥 frontmatter（`name:`/`stage:` 是元数据，不是给人读的方法），
    // 再按**技能**的额度截断，而不是书内摘录那 800 字。
    push(
      makeItem(
        "pinned",
        { relPath, title: extra.title },
        clip(body(extra.text), PINNED_SKILL_CHARS),
        false
      )
    );
  }

  const chars = items.reduce((sum, item) => sum + item.chars, 0);
  return { items, chars, approxTokens: estimateTokens(items.map((i) => i.text).join("\n")) };
}

/**
 * 把装配结果拼成给模型看的提示词块。
 * 没有条目时返回空串——调用方据此判断「不要注入一段空标题」。
 */
export function renderContextBlock(assembled: AssembledContext): string {
  if (assembled.items.length === 0) return "";
  const lines: string[] = [];
  for (const item of assembled.items) {
    lines.push(`【${contextKindLabel(item.kind, item.active)}·${item.title}】`, item.text);
  }
  return lines.join("\n");
}
