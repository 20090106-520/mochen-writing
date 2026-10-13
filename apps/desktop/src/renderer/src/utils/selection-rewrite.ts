/**
 * 选中即改写（2026-10-11）：正文里划选一段，浮出「扩写 / 收着写 / 更口语」三个按钮，
 * 点了带着选段预填进 AI 智能体输入区——发送权在用户（与 ai-check 审核同一纪律：不自动发送）。
 *
 * 为什么提示词住 .ts 不住 .vue：本仓 verify 用裸 tsc，`<script setup>` 不进类型程序，
 * 有行为的代码搬进 .ts 才真的被 vitest 钉住（与 useSnippetToolbar 同一条房规）。
 *
 * 改写为什么走智能体而不是直接改草稿：改写是「提案—审批」的事，直接改草稿等于
 * 替用户按了确认键。预填的指令里点名 propose_patch，改法走替换提案，批准才落盘。
 */

export type SelectionRewriteKind = "expand" | "tighten" | "colloquial";

export interface SelectionRewriteAction {
  kind: SelectionRewriteKind;
  label: string;
  /** 按钮上的悬停说明——三个词太短，得让用户知道按下会发生什么。 */
  hint: string;
}

export const SELECTION_REWRITE_ACTIONS: readonly SelectionRewriteAction[] = [
  { kind: "expand", label: "扩写", hint: "把这段写足：补动作、环境与感官细节" },
  { kind: "tighten", label: "收着写", hint: "删掉水分：信息与转折全保留，字数减半" },
  { kind: "colloquial", label: "更口语", hint: "书面腔改成人说的话，字数大体不变" }
] as const;

/** 比这短的选段不值得动用智能体（一句话扩成两句话，手写更快）。 */
export const SELECTION_REWRITE_MIN_CHARS = 6;
/** 比这长的选段让用户分次来——一段喂太多，改写质量与提案可读性都会塌。 */
export const SELECTION_REWRITE_MAX_CHARS = 2000;

/** 这段选值不值得给按钮。纯判定：trim 后算长度，全空白的选区不算。 */
export function selectionWorthy(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.length >= SELECTION_REWRITE_MIN_CHARS && trimmed.length <= SELECTION_REWRITE_MAX_CHARS
  );
}

const REQUIREMENT: Record<SelectionRewriteKind, string> = {
  expand:
    "扩写。在不新增人物、不改变既有事实的前提下把这段写足：补进动作、环境与感官细节，" +
    "长度约为原来的 1.5 到 2 倍；保持原文的人称与叙事距离，心理活动要演出来，别用「他感到」式汇报。",
  tighten:
    "收着写。删掉这段里的水分：重复的解释、凑字的形容、替读者下的结论全去掉，" +
    "信息与转折一个都不能丢，长度压到原来的一半以下；句子该短就短。",
  colloquial:
    "改得更口语。把书面腔、翻译腔与解释句改成人在说话的样子：对白像这个人会说的原话，" +
    "叙述少用四字堆砌；字数大体不变，事实与顺序不动。"
};

/**
 * 预填进智能体输入区的指令全文。点名 propose_patch——
 * 改写走替换提案、批准才落盘，模型不该有别的指望。
 */
export function selectionRewritePrompt(kind: SelectionRewriteKind, selection: string): string {
  return (
    `请改写当前章里的一段正文。要求：${REQUIREMENT[kind]}\n\n` +
    "原文如下（两条分隔线之间，一字未动）：\n" +
    "--------\n" +
    `${selection.trim()}\n` +
    "--------\n" +
    "改完用 propose_patch 把原文整段替换掉，这一段之外的任何字都不要动。"
  );
}
