/**
 * 「按纲起草」的指令拼装（2026-11 W-02 第二步）。
 *
 * **只做一件事**：把卷纲里已经写下的六项字段翻成一段**分节、可改**的起草指令。
 * 有值的字段原样进指令；没值的**不猜**——单列一段「未填项 · 请勿自行补设定」，
 * 并明确列出缺的是哪几项。这里不做模型调用、不读盘、不碰任何数据结构；
 * 预填由调用方走 `useAgentStore.prefillComposer`，发送权仍留给用户。
 */
import {
  CHAPTER_OUTLINE_FIELDS,
  CHAPTER_OUTLINE_LABELS,
  DEFAULT_PROFILE_ID,
  type ChapterOutlineField,
  type ParsedChapter,
  type WorkMode
} from "@mochen/contracts";

/** 正文阶段的默认档案（直接取 contracts 那一份，不另抄一个 id）。 */
export const DRAFT_PROFILE_ID = DEFAULT_PROFILE_ID;

/** 起草正文要落盘，工作模式切到「直接动手」，不是「先计划」。 */
export const DRAFT_WORK_MODE: WorkMode = "act";

export interface ChapterDraftInput {
  chapter: ParsedChapter;
  /** 本卷纲里上一章的标题（跳过没有字段的分组节）；第一章为 null。 */
  previousTitle: string | null;
  /** 上一章的目标文稿路径；标题落不了盘时为 null。 */
  previousRelPath: string | null;
  /** 这一章要写入的正文路径（由 `planDocRelPath("chapter", title)` 算出来）。 */
  targetRelPath: string;
  /** 这一篇正文稿是否已经在书里（决定指令说「写进这一篇」还是「新建」）。 */
  targetExists: boolean;
}

/** 每一项已填字段 → 一条具体的写法约束（不是复述字段，是告诉 AI 怎么写）。 */
function fieldConstraints(chapter: ParsedChapter): string[] {
  const lines: string[] = [];
  const push = (field: ChapterOutlineField, text: (value: string) => string): void => {
    const value = chapter.fields[field];
    if (value !== "") lines.push(`${CHAPTER_OUTLINE_LABELS[field]}：${text(value)}`);
  };
  push("pov", (value) => `全章按「${value}」的视角写，不要中途切到别人的内心。`);
  push(
    "goal",
    (value) => `正文要让主角朝「${value}」这个目标推进；每一场戏都问一句「离它近了还是远了」。`
  );
  push("conflict", (value) => `把「${value}」写成具体的阻力、代价和当场的反应，不要一句话带过。`);
  push("turn", (value) => `转折必须真正改变局面（「${value}」），不能只是换句话重复冲突。`);
  push("hook", (value) => `正文最后落在「${value}」这件事上；可以埋线，但不要提前揭开。`);
  push("wordTarget", (value) =>
    chapter.wordTarget === null
      ? `章纲写的是「${value}」；读不出确切数字，就按原话处理，不硬凑成某个数。`
      : `约 ${chapter.wordTarget} 字；按这个量写，不硬凑也不注水。`
  );
  return lines;
}

export function chapterDraftPrompt(input: ChapterDraftInput): string {
  const { chapter } = input;
  const filled = CHAPTER_OUTLINE_FIELDS.filter((field) => chapter.fields[field] !== "");
  const facts =
    filled.length === 0
      ? "- （六项都没填）"
      : filled
          .map((field) => `- ${CHAPTER_OUTLINE_LABELS[field]}：${chapter.fields[field]}`)
          .join("\n");

  // 承接上一章：有明确的上一章就指名道姓；没有就说清「这是第一篇」，不假装读过不存在的前情。
  const previous =
    input.previousTitle === null
      ? "承接上一章：这是这篇卷纲里的第一章。如果书里已有更早的章节，先读最近一章的结尾再接上；读不到就照实说不确定前情，不要凭空补。"
      : `承接上一章：先读上一章《${input.previousTitle}》${
          input.previousRelPath === null ? "" : `（${input.previousRelPath}）`
        }的结尾，从它停下的地方接上；不要复述上一章已经发生的事，也不要假装读过没读到的内容。`;

  const target = input.targetExists
    ? "- 用 write_doc 写进这一篇；卷纲、章纲和其他文稿一个字都不改。"
    : "- 这一篇还没有正文稿，请用 write_doc 新建到该路径；不要写进别的文稿。";

  // 缺项照实报，并且**禁止补设定**——这一句是「不替作者编」的边界，不写就会被模型顺手填满。
  const missing =
    chapter.missing.length === 0
      ? "【未填项】\n- 本章章纲六项都填了，没有留白。"
      : `【未填项 · 请勿自行补设定】\n- 本章章纲没填：${chapter.missing
          .map((field) => CHAPTER_OUTLINE_LABELS[field])
          .join(
            "、"
          )}。\n- 以上未填，请勿自行补设定：不要替它们编动机、关系、规则或前史。正文必须用到时，用不作数的写法带过，并在写完以后单独列出「需要我补哪几项」，不要自己定。`;

  const constraints = [previous, ...fieldConstraints(chapter)].map((line) => `- ${line}`);

  return [
    `请按下面这份章纲起草《${chapter.title}》的正文。`,
    "",
    "【目标文稿】",
    `- 写入：${input.targetRelPath}`,
    target,
    "",
    "【本章章纲】",
    facts,
    "",
    "【写作约束】",
    ...constraints,
    "",
    missing,
    "",
    "写完以后告诉我：正文落在哪一篇、有哪一处拿不准需要我定。"
  ].join("\n");
}

export interface ChapterDraftTargetInput {
  chapterTitle: string;
  targetRelPath: string;
  targetExists: boolean;
  /** 当前正在编辑的那一篇（没有打开文稿时为 null）。 */
  activeRelPath: string | null;
  activeTitle: string | null;
}

/**
 * 「这一章会写到哪里」的提示（W-02 第二步第 4 条）。
 * 目标正是眼前这一篇时返回空串——不需要解释不存在的误会；
 * 目标不是眼前那一篇（或压根没开文稿）时，点名目标标题、路径与「新建」状态。
 */
export function chapterDraftTargetHint(input: ChapterDraftTargetInput): string {
  if (input.activeRelPath === input.targetRelPath) return "";
  const created = input.targetExists ? "" : "；这篇还没有正文稿，先在文稿树里新建它";
  const target = `《${input.chapterTitle}》（${input.targetRelPath}${created}）`;
  if (input.activeRelPath === null) {
    return `这一章会写到${target}；指令已经预填在它对应的输入框里，打开那一篇就能改着发，不会误改别的篇。`;
  }
  return `这一章会写到${target}；指令已经预填在它对应的输入框里，把那一篇打开就能改着发，不会改你眼前这篇《${
    input.activeTitle ?? input.activeRelPath
  }》。`;
}
