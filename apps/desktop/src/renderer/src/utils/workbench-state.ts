import type { BookKind, DocRef } from "@mochen/contracts";

export type WorkbenchCardId = "chief-write" | "character" | "world" | "outline";

export const WORKBENCH_CARD_LABELS: Record<WorkbenchCardId, string> = {
  "chief-write": "主笔创作",
  character: "角色塑造",
  world: "世界构建",
  outline: "大纲规划"
};

/** 主笔创作卡的预填指令；只在 Task 4 的 prefillComposer 通路落地后才随卡出现（§2.7）。 */
export const WORKBENCH_PREFILL = "我想改这一章：先读它，再给我三处可以动的地方。";

export interface WorkbenchCard {
  id: WorkbenchCardId;
  label: string;
  hint: string;
  enabled: boolean;
}

const CARD_ORDER: WorkbenchCardId[] = ["chief-write", "character", "world", "outline"];

// world 卡落 materials/ 分组（scan.ts:45 把 materials/ 归 material kind）；character→characters、outline→outline。
const CARD_TARGET_KIND: Record<Exclude<WorkbenchCardId, "chief-write">, BookKind> = {
  character: "character",
  world: "material",
  outline: "outline"
};

const CARD_HINTS: Record<WorkbenchCardId, string> = {
  "chief-write": "打开当前章，预填一句改稿指令，再交给你逐条审批。",
  character: "浏览人物分组第一篇，落到右栏浏览态。",
  world: "浏览素材库分组第一篇，落到右栏浏览态。",
  outline: "浏览大纲分组第一篇，落到右栏浏览态。"
};

/** 该卡的目标分组在本书里不存在时的实话：不承诺动作，只说明缺什么。 */
export const WORKBENCH_EMPTY_HINTS: Record<WorkbenchCardId, string> = {
  "chief-write": "这本书还没有章节，先在左栏新建一篇。",
  character: "这本书还没有人物分组。",
  world: "这本书还没有素材库分组。",
  outline: "这本书还没有大纲分组。"
};

/** 无书 ⇒ false：整块降级成引导，不显示任何死卡。 */
export function workbenchVisible(hasBook: boolean): boolean {
  return hasBook;
}

export function workbenchTarget(input: {
  id: WorkbenchCardId;
  docs: DocRef[];
  activeChapter: string | null;
}): string | null {
  if (input.id === "chief-write") {
    const active = input.activeChapter?.trim() ?? "";
    if (active !== "") return active;
    return input.docs.find((doc) => doc.kind === "chapter")?.relPath ?? null;
  }
  const kind = CARD_TARGET_KIND[input.id];
  return input.docs.find((doc) => doc.kind === kind)?.relPath ?? null;
}

export function workbenchCards(input: {
  hasBook: boolean;
  docs: DocRef[];
  activeChapter: string | null;
}): WorkbenchCard[] {
  if (!workbenchVisible(input.hasBook)) return [];
  return CARD_ORDER.map((id) => {
    const target = workbenchTarget({ id, docs: input.docs, activeChapter: input.activeChapter });
    return {
      id,
      label: WORKBENCH_CARD_LABELS[id],
      // target 为 null（本书里没有该分组）⇒ 发实话；有目标才发动作说明。
      hint: target === null ? WORKBENCH_EMPTY_HINTS[id] : CARD_HINTS[id],
      enabled: target !== null
    };
  });
}
