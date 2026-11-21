import { z } from "zod";

/**
 * 设定提案（2026-11-20）。
 *
 * 与正文提案（`EditProposal`）刻意分成两种：正文提案带 docRelPath / anchor / 指纹，
 * 全部围绕「一段已存在的文字」；设定库是 `.mochen/data/story-bible.json` 里的一条 JSON，
 * 没有锚点也没有原稿可比。硬套 EditProposal 会让审批、指纹、差异三套判据都长出分支。
 *
 * 纪律相同：模型只提、用户批准才落盘；落盘仍走 `writeBookData` 那一条通路。
 */
export const BIBLE_PROPOSAL_TYPES = ["character", "location", "timeline"] as const;
export type BibleProposalType = (typeof BIBLE_PROPOSAL_TYPES)[number];

export const bibleProposalSchema = z.object({
  id: z.string().min(1),
  threadKey: z.string().min(1),
  turnId: z.string().min(1),
  type: z.enum(BIBLE_PROPOSAL_TYPES),
  title: z.string().min(1),
  content: z.string(),
  why: z.string().min(1),
  createdAt: z.string().min(1)
});
export type BibleProposal = z.infer<typeof bibleProposalSchema>;

/** 三类的中文名（界面与回执同一份，别处不再各写一张表）。 */
export const BIBLE_PROPOSAL_TYPE_LABELS: Record<BibleProposalType, string> = {
  character: "人物",
  location: "地点",
  timeline: "时间线"
};
