/**
 * 标签录入那一刀的唯一实现（2026-10-09 扫描总单·假控件那一批）。
 *
 * 这件事原本有两种坏形态：`StoryBiblePanel.vue` 里手抄了两份 `.split(",")`（标签一份、别名一份，
 * 都不去重、不认中文逗号），而笔记一侧**根本没有录入入口**——标签只有展示端，标签集恒空。
 * 现在两个面板、四个字段（笔记标签、设定标签、设定别名）都调这里这一份。
 *
 * 为什么单独立一个文件而不是放在 `note-scope.ts`：它跟"档位"没关系，是面板共用的输入解析。
 */

/** 中英文逗号都认，去空白、去空项、去重复、保序。 */
export function parseTags(raw: string): string[] {
  const out: string[] = [];
  for (const piece of raw.split(/[,，]/)) {
    const tag = piece.trim();
    if (tag !== "" && !out.includes(tag)) out.push(tag);
  }
  return out;
}
