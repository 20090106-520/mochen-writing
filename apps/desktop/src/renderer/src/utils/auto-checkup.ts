/**
 * 写后自动体检（2026-11-17）：模型把一章写到盘上之后，自动跑一遍「去 AI 味」与两枚硬伤检查，
 * 只有真有问题才在回执之后摆一张紧凑卡片。
 *
 * 【为什么不新造测量】三类的判据各有真身——AI 味词表在 contracts（与提示词端的文风硬约束
 * 同一份）、标点与重复句在 doc-checkup（与书稿体检同一份）。这里只负责「逐篇跑、只留有问题的」，
 * 不新增一枚阈值：作者在体检报告里看到什么口径，这张卡片就是什么口径。
 *
 * 【为什么只查这一轮写过的篇】自动体检测的是「刚生成的东西」，不是第二次全书扫描；
 * 全书体检仍由左栏「书稿体检」按用户意愿跑。范围小，才敢在每轮回执后都跑。
 */
import { analyzeAiFlavor, type AiFlavorEntry } from "@mochen/contracts";
import {
  findDuplicateSentences,
  findPunctuationIssues,
  type DuplicateSentence,
  type PunctuationIssue
} from "./doc-checkup";

export interface AutoCheckupFinding {
  docRelPath: string;
  title: string;
  /** 去 AI 味命中（真身 analyzeAiFlavor，词表与提示词端同一份）。 */
  aiFlavor: AiFlavorEntry[];
  /** 标点硬伤（findPunctuationIssues）。 */
  punctuation: PunctuationIssue[];
  /** 重复句（findDuplicateSentences）。 */
  duplicates: DuplicateSentence[];
  /** 三类合计条数，排序与卡片标题用。 */
  total: number;
}

export interface AutoCheckupDoc {
  relPath: string;
  title: string;
  content: string;
}

/**
 * 逐篇体检，只返回**真有命中**的篇；按合计条数降序、同分按 relPath 稳定序。
 *
 * 空内容直接跳过：刚建的空白章既不该报「全绿」也不该报问题——它根本还没有可查的东西。
 * 三类传的都是单篇数组，所以命中的 docIndex 恒为 0，展示层不必再映射回全书下标。
 */
export function autoCheckupOf(docs: readonly AutoCheckupDoc[]): AutoCheckupFinding[] {
  const findings: AutoCheckupFinding[] = [];
  for (const doc of docs) {
    if (doc.content.trim() === "") continue;
    const flavor = analyzeAiFlavor([doc.content]);
    const punctuation = findPunctuationIssues([doc.content]);
    const duplicates = findDuplicateSentences([doc.content]);
    const total = flavor.totalHits + punctuation.length + duplicates.length;
    if (total === 0) continue;
    findings.push({
      docRelPath: doc.relPath,
      title: doc.title,
      aiFlavor: flavor.entries,
      punctuation,
      duplicates,
      total
    });
  }
  return findings.sort((a, b) => b.total - a.total || a.docRelPath.localeCompare(b.docRelPath));
}
