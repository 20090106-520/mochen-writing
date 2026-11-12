import type { SkillRef } from "@mochen/contracts";

/**
 * `use_skill` 的三句回执（2026-11-12 从 doc-tools-host.ts 拆出）。
 *
 * 拆的理由是行数预算（那个文件贴着 800 行），但拆出来也更该在这儿：这三句是**给模型看的
 * 话**，不是工具执行逻辑。它们各自要说清一件事——
 *
 * - 停用（P0-4）：清单里不出现、正文也读不到，恢复要回技能库；
 * - id 写错：清单里同一份技能并排摆着三个字面量（显示名 / 目录名 / 完整 id），模型照着
 *   前两个调是常态。认得出就点名要它，省掉一轮「列出全部技能」的往返——那轮往返之后
 *   模型往往还要加一句「抱歉，我先列出技能」，正是对话里最重的那层 AI 腔；
 * - 真没有：只说没有，不编一个近似。猜错比不猜更费一轮。
 */
export function disabledSkillText(id: string): string {
  return `技能「${id}」在这本书里已停用，正文不读、也不带进这一轮上下文。要恢复就到技能库把它启用。`;
}

/**
 * 想读一份技能却没读到时的说法。
 *
 * `hit` 是 `matchSkillRef` 的结论（认不出为 null，可能是别的来源下同名的另一份）；
 * `hitDisabled` 必须先算好再传进来——认出的是停用技能时**不能**点名要它，
 * 否则「你是指它吧」会把一份停用技能的存在感递出去。
 */
export function skillReadMissText(
  wanted: string,
  hit: SkillRef | null,
  hitDisabled: boolean
): string {
  if (hit === null || hit.id === wanted) {
    return `技能库里没有 id 为「${wanted}」的技能。先不带参数调一次 use_skill 看看有哪些。`;
  }
  if (hitDisabled) return disabledSkillText(hit.id);
  return (
    `技能库里没有 id 为「${wanted}」的技能——id 要带来源前缀（形如「来源:目录名」）。` +
    `你要的是「${hit.displayName}」吧？用 use_skill("${hit.id}")。`
  );
}
