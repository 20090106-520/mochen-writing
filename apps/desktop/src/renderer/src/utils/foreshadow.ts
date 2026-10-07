import {
  parseForeshadowMeta,
  resolveForeshadowStatus,
  type DocRef,
  type ForeshadowStatus
} from "@mochen/contracts";

/**
 * 伏笔台账的**行组装与统计**（2026-10-05）。
 *
 * 解析与状态机在 `contracts/foreshadow.ts`（主进程写、渲染层读，必须同一份），这里只管
 * 「把一堆伏笔文稿摆成一张能一眼看懂的表」：排序、语气、脏数据提示、统计。
 *
 * 一条纪律贯穿全文件：**宁可让作者多看一眼，不替他下结论。**
 * 状态字段写错就说写错（`broken`），只填了回收章也不判死（仍算已埋），
 * 读不到原文的也照样列出来（`unknown`）——凭空消失的那一条才是真正会漏的伏笔。
 */

/** 一行在台账里的语气。`broken` / `unknown` 是两种「需要人看一眼」的异常态。 */
export type ForeshadowTone = "pending" | "paid" | "dropped" | "broken" | "unknown";

export interface ForeshadowRow {
  relPath: string;
  title: string;
  status: ForeshadowStatus;
  /** 屏显说法（来自 contracts 的穷尽表，这里不自抄）。 */
  statusLabel: string;
  /** 埋在哪、收在哪；作者没写就是空串，面板据此说「没写」而不是留白。 */
  plantedIn: string;
  paidIn: string;
  /** frontmatter 里 status 的原样取值；空串 = 没写这个键。 */
  rawStatus: string;
  tone: ForeshadowTone;
}

function isKnownStatus(value: string): value is ForeshadowStatus {
  return value === "planted" || value === "paid" || value === "dropped";
}

/** 同状态内部的排序：异常与「还欠什么」排在最前，台账先说要紧的。 */
const TONE_ORDER: Record<ForeshadowTone, number> = {
  broken: 0,
  unknown: 1,
  pending: 2,
  paid: 3,
  dropped: 4
};

/**
 * 把书里的伏笔文稿摆成台账行。
 * `raws` 是 `relPath → 文稿原文`，由 store 一次性读回来；读不到的那条仍会列出来（unknown）。
 */
export function foreshadowRows(docs: DocRef[], raws: Map<string, string>): ForeshadowRow[] {
  const rows: ForeshadowRow[] = [];
  for (const doc of docs) {
    if (doc.kind !== "foreshadow") continue;
    const raw = raws.get(doc.relPath);
    if (raw === undefined) {
      rows.push({
        relPath: doc.relPath,
        title: doc.title,
        status: "planted",
        statusLabel: resolveForeshadowStatus("planted"),
        plantedIn: "",
        paidIn: "",
        rawStatus: "",
        tone: "unknown"
      });
      continue;
    }
    const meta = parseForeshadowMeta(raw);
    // 写了但认不出：这是**数据坏了**，不是「还没写」——两者的下一步动作完全不同。
    const broken = meta.rawStatus !== "" && !isKnownStatus(meta.rawStatus);
    rows.push({
      relPath: doc.relPath,
      title: doc.title,
      status: meta.status,
      statusLabel: resolveForeshadowStatus(meta.status),
      plantedIn: meta.plantedIn,
      paidIn: meta.paidIn,
      rawStatus: meta.rawStatus,
      tone: broken ? "broken" : meta.status === "planted" ? "pending" : meta.status
    });
  }
  return rows.sort((a, b) => {
    const byTone = TONE_ORDER[a.tone] - TONE_ORDER[b.tone];
    return byTone !== 0 ? byTone : a.relPath.localeCompare(b.relPath);
  });
}

export interface ForeshadowStats {
  total: number;
  pending: number;
  paid: number;
  dropped: number;
  /** 状态字段写坏了的条数——它们既不能算待回收也不能算已回收。 */
  broken: number;
}

export function foreshadowStats(rows: ForeshadowRow[]): ForeshadowStats {
  const stats: ForeshadowStats = { total: rows.length, pending: 0, paid: 0, dropped: 0, broken: 0 };
  for (const row of rows) {
    if (row.tone === "broken") stats.broken += 1;
    else if (row.tone === "unknown") stats.pending += 1;
    else if (row.tone === "pending") stats.pending += 1;
    else if (row.tone === "paid") stats.paid += 1;
    else stats.dropped += 1;
  }
  return stats;
}

/** 语气 → 给作者的下一步提示。穷尽表：加一种语气而不写这里，编译不过。 */
const PLANT_TONE_LABELS: Record<ForeshadowTone, string> = {
  pending: "还没回收——写到这里时它该有个交代",
  paid: "已回收",
  dropped: "已弃用（不再管它）",
  broken: "状态字段不是 planted/paid/dropped，改前它按「已埋」算",
  unknown: "读不到这篇原文，状态未知"
};

export function plantToneLabel(tone: ForeshadowTone): string {
  return PLANT_TONE_LABELS[tone];
}
