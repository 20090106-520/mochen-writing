import { castMention, castNames, type BibleEntry } from "@mochen/contracts";

/** 一条嗓音摘要：人物名 + 一行「说话/不做/本卷」。 */
export interface VoiceBrief {
  name: string;
  line: string;
}

/**
 * 本章点到名的人物，谁写了嗓音三格就摘谁（2026-11 W-09，只读展示）。
 *
 * 判定与装配层同源：`castMention` 认标题与别名，短于 `CAST_MIN_NAME` 的名字不判——
 * 单字名在整章里必然命中，列出来只会糊满面板。
 * 顺序按设定表的原有顺序（面板自己排过序），不另立一套。
 */
export function voiceBriefs(entries: readonly BibleEntry[], text: string, limit = 3): VoiceBrief[] {
  if (text.trim() === "") return [];
  const briefs: VoiceBrief[] = [];
  for (const entry of entries) {
    if (entry.type !== "character" || entry.archived) continue;
    const names = castNames(entry.title, { aliases: entry.aliases ?? [], voice: [], exit: "" });
    if (castMention(text, names) === "") continue;
    const parts: string[] = [];
    if (entry.voice !== undefined) parts.push(`说话：${entry.voice}`);
    if (entry.taboo !== undefined) parts.push(`不做：${entry.taboo}`);
    if (entry.arc !== undefined) parts.push(`本卷：${entry.arc}`);
    if (parts.length === 0) continue;
    briefs.push({ name: entry.title, line: parts.join("；") });
    if (briefs.length >= limit) break;
  }
  return briefs;
}
