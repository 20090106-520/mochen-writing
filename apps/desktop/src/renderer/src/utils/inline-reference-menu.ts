/**
 * 行内引用菜单的判定层（#106）：打字时的触发判定、条目组装、过滤、上下键、Enter 的结果。
 * 脑子对齐 deepwrite：`utils/composerReferences.ts`（触发与插入）+
 * `composables/useConversationComposer.ts`（过滤、环绕、空态、菜单文案）。
 * 这里没有 DOM、没有 store、没有键名：键→动作的裁决仍住 utils/hotkeys.ts，Esc 仍住 utils/escape-policy.ts，
 * 本文件只回答「菜单该不该开、开着有哪些条目、选中这条之后草稿变成什么」。
 *
 * 与本仓的两处适配（其余逐字对齐）：
 * ① `/` 的条目来自 slash-commands.ts 那张唯一命令表，且命令是**动作**不是文本——选中即执行（D1），
 *    所以结果联合是 insert | execute，两型都不含「发送」：Enter 永不发送（D2）。
 * ② `@` 的条目来自 book store 已有的 DocRef，插入的是可读引用文本，出站仍是一条 userText——
 *    本任务不新增 IPC 通道，也不假装这是结构化上下文注入。
 */
import type { DocRef } from "@mochen/contracts";
import { SLASH_COMMAND_DESCRIPTIONS, type SlashCommand } from "./slash-commands";
import { BOOK_KIND_LABELS } from "./book-kinds";
import type { IconName } from "../types/icons";

export const REFERENCE_TRIGGERS = ["/", "@"] as const;
export type ReferenceTrigger = (typeof REFERENCE_TRIGGERS)[number];

export interface ReferenceMatch {
  trigger: ReferenceTrigger;
  /** 触发符在草稿里的下标。 */
  start: number;
  /** 判定时的光标下标（已钳进串内）。 */
  caret: number;
  /** 触发符与光标之间的那串字，就是过滤词。 */
  query: string;
}

export interface ReferenceMenuPool {
  /** `/` 的池：调用方从 slash-commands 的 availableCommands 拿（可用性闸只在那一处）。 */
  commands: readonly SlashCommand[];
  /** `@` 的池：book store 的文档列表。 */
  docs: readonly DocRef[];
}

interface ReferenceOptionBase {
  /** v-for 的 key：`/model`、`@chapters/ch01.md` 形态，天然唯一。 */
  id: string;
  label: string;
  detail: string;
}

/** 穷尽联合（铁律 6）：加一枚触发符不写这一型，下面的 switch 编译不过。 */
export type ReferenceOption =
  | (ReferenceOptionBase & { trigger: "/"; command: SlashCommand; doc: null })
  | (ReferenceOptionBase & { trigger: "@"; command: null; doc: DocRef });

/** Enter 的两种结果——没有第三种：这里发不出消息。 */
export type ReferenceSelection =
  | { kind: "insert"; text: string; value: string; caret: number }
  | { kind: "execute"; command: SlashCommand; value: string; caret: number };

/** 一次最多列这么多条（deepwrite 的 slice(0, 12)）。 */
export const REFERENCE_OPTION_LIMIT = 12;

/** 菜单文案与图标的唯一表（铁律 6：Record 穷尽，加触发符不写文案就编译不过）。 */
export interface ReferenceMenuCopy {
  title: string;
  hint: string;
  icon: IconName;
  /** 池子本身是空的（无书、无文档、命令被可用性闸全部滤掉）。 */
  poolEmpty: string;
  /** 有池子但过滤没中。 */
  queryEmpty: string;
}

/**
 * 模板只读这张表，不再自行判定 `/` 还是 `@`（铁律 6）。
 */
export const REFERENCE_MENU_COPY: Record<ReferenceTrigger, ReferenceMenuCopy> = {
  "/": {
    title: "调用命令",
    hint: "输入名称搜索命令",
    icon: "sparkles",
    // 与 SlashPalette 的旧空态同口径：没接通的通路不列出来，也不列出一堆死的。
    poolEmpty: "这一版没有可执行的命令——还没接通的通路不会列出来。",
    queryEmpty: "没有匹配的命令"
  },
  "@": {
    title: "引用素材",
    hint: "输入名称搜索本书文档",
    icon: "archive",
    poolEmpty: "这本书里还没有可引用的文档，先在左栏建一篇",
    queryEmpty: "没有匹配的文档"
  }
};

/** deepwrite 的前置字符黑名单：紧跟在拉丁字母/数字/路径字符后面的 / @ 属于词内部（path/mod、user@name）。 */
const INVALID_PRECEDING_TRIGGER_CHARACTER = /[A-Za-z0-9_./:-]/;

/** 触发符与光标之间一旦出现空白或第二个触发符就不是引用词。 */
const QUERY_BREAK = /\s|[/@]/u;

/** 插入后不需要补空格的后文起点（句读与闭括号已经自带边界）。 */
const TRAILING_PUNCTUATION = /^[\s，。！？；：、）)】\]}]/u;

export function findReferenceMatch(value: string, caret: number): ReferenceMatch | null {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  const beforeCaret = value.slice(0, safeCaret);
  const slashIndex = beforeCaret.lastIndexOf("/");
  const mentionIndex = beforeCaret.lastIndexOf("@");
  const start = Math.max(slashIndex, mentionIndex);
  if (start < 0) return null;

  const query = beforeCaret.slice(start + 1);
  if (QUERY_BREAK.test(query)) return null;

  const preceding = start > 0 ? value[start - 1] : undefined;
  if (preceding !== undefined && INVALID_PRECEDING_TRIGGER_CHARACTER.test(preceding)) return null;

  return { trigger: value[start] as ReferenceTrigger, start, caret: safeCaret, query };
}

function commandOption(command: SlashCommand): ReferenceOption {
  return {
    id: `/${command}`,
    trigger: "/",
    label: command,
    detail: SLASH_COMMAND_DESCRIPTIONS[command],
    command,
    doc: null
  };
}

function documentOption(doc: DocRef): ReferenceOption {
  return {
    id: `@${doc.relPath}`,
    trigger: "@",
    label: doc.title,
    // kind 的中文名仍出自 book-kinds 那张表（铁律 6），组件与这里都不再抄一遍。
    detail: `${BOOK_KIND_LABELS[doc.kind]} · ${doc.relPath}`,
    command: null,
    doc
  };
}

/** 条目池：`/` 走 slash-commands 的表，`@` 走 book store 的 DocRef——不存在第三份来源。 */
export function referenceOptionPool(
  match: ReferenceMatch,
  pool: ReferenceMenuPool
): ReferenceOption[] {
  switch (match.trigger) {
    case "/":
      return pool.commands.map(commandOption);
    case "@":
      return pool.docs.map(documentOption);
    default: {
      const unhandled: never = match.trigger; // 新触发符没接池子 ⇒ 编译失败，不是空菜单
      return unhandled;
    }
  }
}

/** 过滤：label 与 detail 一起小写包含（deepwrite 的 zh-CN 口径，中文标题同样搜得到）。 */
export function filterReferenceOptions(
  options: readonly ReferenceOption[],
  query: string
): ReferenceOption[] {
  const needle = query.trim().toLocaleLowerCase("zh-CN");
  const matches = needle
    ? options.filter((option) =>
        `${option.label} ${option.detail}`.toLocaleLowerCase("zh-CN").includes(needle)
      )
    : [...options];
  return matches.slice(0, REFERENCE_OPTION_LIMIT);
}

/** 池子 + 过滤一次做完：调用方拿到的就是「屏幕上那几条」。 */
export function referenceVisibleOptions(
  match: ReferenceMatch,
  pool: ReferenceMenuPool
): ReferenceOption[] {
  return filterReferenceOptions(referenceOptionPool(match, pool), match.query);
}

export function moveReferenceIndex(index: number, delta: number, total: number): number {
  if (total === 0) return 0;
  return (index + delta + total) % total;
}

/** 过滤后列表变短 ⇒ 高亮收回最后一行（deepwrite 用 watch 夹住，这里夹在同一个纯函数里）。 */
export function clampReferenceIndex(index: number, total: number): number {
  if (total === 0) return 0;
  return Math.min(Math.max(index, 0), total - 1);
}

/** `@` 插入的可读引用文本：标题给人看，relPath 给它自己找回那篇。 */
export function materialReferenceText(doc: DocRef): string {
  return `@素材：${doc.title}（${doc.relPath}）`;
}

/** 空态两档：池子本来就空（无书/无文档/命令被闸掉）与过滤没中，文案不同。 */
export function referenceEmptyText(match: ReferenceMatch, poolSize: number): string {
  const copy = REFERENCE_MENU_COPY[match.trigger];
  return poolSize === 0 ? copy.poolEmpty : copy.queryEmpty;
}

/**
 * 选中一条的结果：`@` 把 token 换成可读引用文本（insert），`/` 把 token 吃掉并交出命令名（execute）。
 * 两型都把草稿的新值与新光标算好——写回由 store 经 setDraft 做，执行由 runSlashCommand 做，这里不碰。
 */
export function resolveReferenceSelection(
  value: string,
  match: ReferenceMatch,
  option: ReferenceOption
): ReferenceSelection {
  const prefix = value.slice(0, match.start);
  const suffix = value.slice(match.caret);
  switch (option.trigger) {
    case "/": {
      // 命令是动作：屏幕上那串 `/xxx` 是召唤语，不是要发出去的话，执行完就收掉。
      return {
        kind: "execute",
        command: option.command,
        value: `${prefix}${suffix}`,
        caret: prefix.length
      };
    }
    case "@": {
      const text = materialReferenceText(option.doc);
      const needsTrailingSpace = suffix.length === 0 || !TRAILING_PUNCTUATION.test(suffix);
      const insertion = `${text}${needsTrailingSpace ? " " : ""}`;
      return {
        kind: "insert",
        text,
        value: `${prefix}${insertion}${suffix}`,
        caret: prefix.length + insertion.length
      };
    }
    default: {
      const unhandled: never = option; // 新触发符没接这条通路 ⇒ 编译失败，不是「Enter 空转」
      return unhandled;
    }
  }
}
