/**
 * 存稿仪表（W-05）的纯计算层：章节状态的唯一判据。
 *
 * 【档位只用仓库里既有的事实】
 * 本仓没有「交稿 / 发布」这种章节状态字段（`book.json` 没有、导出也不留记录），
 * 所以这里**不造**「已交稿」这一档，也不提供手动勾选。能读到的既有事实只有两样：
 *   ① `DocRef.chars`——`doc:scan` 顺路算好的正文字数（空稿 = 0）；
 *   ② `useWritingGoalStore.chapterTargetOf()`——写作目标里既有的逐章目标（0 = 没设）。
 * 于是档位是：空稿 / 有正文 / 未达标 / 已达章目标。「已达章目标」只说明这一章够到了
 * 作者自己设的篇幅目标，不是交稿事实——面板页脚把这句话写给作者看。
 *
 * 【最近一次改动】取改稿历史（`.mochen/changes/`）里这一篇最新的那条备份时间。
 * `writeDocFile` 每次覆盖正文前都会留一份备份，所以它就是「最近一次保存」的既有记录；
 * 没有记录说明没在本软件里改过、或备份已被保留条数滚动清掉——两种情况一律显示「—」，
 * 不拿文件系统里别的什么东西凑一个时间。
 */
import type { ChangeEntry, DocRef } from "@mochen/contracts";
import { changeTimeLabel } from "./change-history";
import { sortDocsByOrder } from "./doc-order";

export const CHAPTER_STATUSES = ["empty", "untargeted", "writing", "done"] as const;
export type ChapterStatus = (typeof CHAPTER_STATUSES)[number];

/** 档位文案：都从上面那两样既有事实读出来，没有一个字是手填的。 */
export const CHAPTER_STATUS_LABELS: Record<ChapterStatus, string> = {
  empty: "空稿",
  untargeted: "有正文",
  writing: "未达标",
  done: "已达章目标"
};

/**
 * 档位 → 样式类名。写成字面量而不是模板里拼 `is-${status}`，
 * 是为了让「死 CSS 守卫」能顺着代码文本找到消费者（它只认字面量）。
 */
export const CHAPTER_STATUS_TONES: Record<ChapterStatus, string> = {
  empty: "is-empty",
  untargeted: "is-plain",
  writing: "is-writing",
  done: "is-done"
};

export interface ChapterInventoryRow {
  relPath: string;
  title: string;
  chars: number;
  /** 逐章目标（0 = 没设）。 */
  target: number;
  status: ChapterStatus;
  statusLabel: string;
  tone: string;
  /** 距本章目标还差多少；没设目标或已达标都是 0。 */
  gap: number;
  /** 最近一次保存的备份时间戳；没有记录是空串。 */
  lastChange: string;
  /** 上面那条时间戳的人话；没有记录是「—」。 */
  lastChangeLabel: string;
  /** 是不是 `book.activeDocTab` 那一篇。 */
  current: boolean;
  /** 当前这一篇有未保存的改动。 */
  unsaved: boolean;
}

export interface ChapterInventoryInput {
  docs: DocRef[];
  chapterOrder: string[];
  targetOf: (relPath: string) => number;
  changes: ChangeEntry[];
  activeDocTab: string | null;
  dirty: boolean;
}

/**
 * 档位判据。顺序固定：先判空稿——一章没正文时，目标达没达标都不成立；
 * 再判有没有目标——没设目标的章不能冒充「未达标」，只能说「有正文」。
 */
export function chapterStatusOf(chars: number, target: number): ChapterStatus {
  if (chars <= 0) return "empty";
  if (target <= 0) return "untargeted";
  return chars >= target ? "done" : "writing";
}

/**
 * 每篇文稿最新一条备份的时间戳。
 *
 * 时间戳目录名定长且字典序即时序（见 `utils/change-history.ts` 头注释），
 * 所以直接比字符串，不另造一份日期解析。
 */
export function latestChangeByDoc(changes: ChangeEntry[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of changes) {
    const prev = out.get(entry.docRelPath) ?? "";
    if (entry.stamp > prev) out.set(entry.docRelPath, entry.stamp);
  }
  return out;
}

/** 按既有章节次序排好、逐章给出状态与读数。 */
export function chapterInventoryRows(input: ChapterInventoryInput): ChapterInventoryRow[] {
  const changesByDoc = latestChangeByDoc(input.changes);
  const ordered = sortDocsByOrder(input.docs, input.chapterOrder).filter(
    (doc) => doc.kind === "chapter"
  );
  return ordered.map((doc) => {
    const chars = doc.chars ?? 0;
    const target = input.targetOf(doc.relPath);
    const status = chapterStatusOf(chars, target);
    const lastChange = changesByDoc.get(doc.relPath) ?? "";
    const current = input.activeDocTab === doc.relPath;
    return {
      relPath: doc.relPath,
      title: doc.title,
      chars,
      target,
      status,
      statusLabel: CHAPTER_STATUS_LABELS[status],
      tone: CHAPTER_STATUS_TONES[status],
      gap: target > 0 ? Math.max(0, target - chars) : 0,
      lastChange,
      lastChangeLabel: lastChange === "" ? "—" : changeTimeLabel(lastChange),
      current,
      unsaved: current && input.dirty
    };
  });
}

export interface ChapterInventorySummary {
  chapterCount: number;
  totalChars: number;
  emptyCount: number;
  writtenCount: number;
  /** 设了逐章目标的章数。0 = 全书都没设，此时「已达标章」无法判定。 */
  targetCount: number;
  reachedCount: number;
  avgChars: number;
  /** 全书目标（0 = 未设）。 */
  totalTarget: number;
  /** 距全书目标还差多少；未设目标时为 null——不编一个默认值假装是书的数据。 */
  remaining: number | null;
  /** 全书目标进度百分比；未设目标时为 0。 */
  percent: number;
}

/**
 * 汇总。平均章字数与字数统计面板同一口径（总字数 ÷ 章节数，空稿也计入），
 * 免得同一本书在两个面板里出现两个「平均」。
 */
export function chapterInventorySummary(
  rows: ChapterInventoryRow[],
  totalWordTarget: number
): ChapterInventorySummary {
  const chapterCount = rows.length;
  const totalChars = rows.reduce((sum, row) => sum + row.chars, 0);
  const emptyCount = rows.filter((row) => row.status === "empty").length;
  const targetCount = rows.filter((row) => row.target > 0).length;
  const reachedCount = rows.filter((row) => row.status === "done").length;
  const totalTarget =
    Number.isFinite(totalWordTarget) && totalWordTarget > 0 ? Math.floor(totalWordTarget) : 0;
  return {
    chapterCount,
    totalChars,
    emptyCount,
    writtenCount: chapterCount - emptyCount,
    targetCount,
    reachedCount,
    avgChars: chapterCount > 0 ? Math.round(totalChars / chapterCount) : 0,
    totalTarget,
    remaining: totalTarget > 0 ? Math.max(0, totalTarget - totalChars) : null,
    percent: totalTarget > 0 ? Math.min(100, Math.round((totalChars / totalTarget) * 100)) : 0
  };
}

/** 页脚与空态文案：状态从哪来、目标怎么处理，都写在作者看得到的地方。 */
export const INVENTORY_NOTE =
  "空稿 / 有正文 / 未达标 / 已达章目标只读扫描字数与写作目标里的逐章目标；仓库没有「已交稿」这类既有事实，所以这里不设这一档，也不提供手动勾选。";
export const INVENTORY_CHANGE_NOTE =
  "最近改动取改稿历史里这一篇最新的一条备份时间（每次保存都会留一份）；没有记录显示「—」，可能是没在本软件里改过，或备份已被保留条数滚动清掉。";
export const INVENTORY_GOAL_NOTE =
  "距全书目标用的是写作目标里既有的数值；未设时如实写「未设」，不编默认值。本仪表只读，不写任何文件。";
export const INVENTORY_EMPTY_TEXT = "这本书还没有章节文稿。";
