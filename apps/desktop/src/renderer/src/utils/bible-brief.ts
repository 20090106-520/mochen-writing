/**
 * W-01 补完：把「这一轮到底带入了哪几条设定」摆到输入区。
 *
 * 主链路（turn-context → assembleContext → agent:context-preview）早已把故事圣经的
 * 短卡装进上下文，占用条里也有「设定 N 项 M 字」的汇总；缺的是**名字**——作者要
 * 一眼看到「它记得林夜、码头、旧账」，而不是点开占用条才看见一个数字。
 *
 * 这里只读预览结果，不改装配、不发 IPC、不提供移除：读数与主进程装出去的那一份
 * 必须逐字同源，自己在渲染层再挑一遍「本章提到谁」就是第二套判据（铁律 6）。
 */
import type { ContextPreview } from "@mochen/contracts";
import { BIBLE_TYPE_LABEL } from "./bible-scope";

/** 两套设定的分工说明：输入卡弹层与设定面板同读这一句，不许各写一份。 */
export const BIBLE_DIVISION_NOTE =
  "短卡给 AI 看：本轮装配会带入本章提到或重要的条目。character / worldview 类长文稿是给你自己看的传记，挂在短卡上，不必两边各写一遍。";

/** 预览里故事圣经条目的 relPath 形状：`bible:<类型>:<id>`（真身在 packages/agent-runtime/src/context.ts）。 */
const BIBLE_PREFIX = "bible:";

export interface BibleBriefRow {
  key: string;
  title: string;
  typeLabel: string;
  chars: number;
}

export interface BibleBrief {
  rows: BibleBriefRow[];
  count: number;
  /** 常驻 chip 的一行字（长名单截断，完整名字在 fullText / 弹层里）。 */
  chipText: string;
  /** 给 title 属性用的完整名单，不截断。 */
  fullText: string;
}

export const EMPTY_BIBLE_BRIEF: BibleBrief = { rows: [], count: 0, chipText: "", fullText: "" };

function typeLabelOf(raw: string): string {
  if (raw === "character" || raw === "location" || raw === "timeline") {
    return BIBLE_TYPE_LABEL[raw];
  }
  return "设定";
}

export function bibleBriefOf(preview: ContextPreview | null): BibleBrief {
  if (preview === null) return { ...EMPTY_BIBLE_BRIEF };
  const rows: BibleBriefRow[] = preview.items
    .filter((item) => item.kind === "world" && item.relPath.startsWith(BIBLE_PREFIX))
    .map((item) => {
      const type = item.relPath.slice(BIBLE_PREFIX.length).split(":")[0] ?? "";
      return {
        key: item.relPath,
        title: item.title,
        typeLabel: typeLabelOf(type),
        chars: item.chars
      };
    });
  if (rows.length === 0) return { ...EMPTY_BIBLE_BRIEF };

  const names = rows.map((row) => row.title);
  const fullText = `本章带入：${names.join("、")}（${rows.length} 条）`;
  // 横向额度是稀缺资源（composer-toolbar-overflow 那笔 13px 缺额的实测）：
  // 芯片最多摆三个名字，其余用「等 N 条」收住，CSS 还有一层 ellipsis 兜底。
  const shown = names.slice(0, 3).join("、");
  const chipText = rows.length > 3 ? `本章带入：${shown} 等 ${rows.length} 条` : fullText;
  return { rows, count: rows.length, chipText, fullText };
}
