import { frontmatterField, frontmatterList, splitFrontmatter } from "./frontmatter.js";

/**
 * 伏笔台账的形状与规则（2026-10-05）。
 *
 * 存在的理由：六枚智能体档案里，「总编」的职责写着「伏笔埋设与回收」——
 * 但那只是**提示词里的一句话**，全仓没有任何一处能查「哪条伏笔埋了、埋在哪、收了没有」。
 * 于是长篇写到一百万字时，伏笔只能靠人脑记，这正是长篇崩掉最常见的方式之一。
 *
 * 形态：**一条伏笔就是一篇普通文稿**（`foreshadow/` 目录下的 .md），元数据走 frontmatter。
 * 刻意不新造一套存储——复用文稿层就自动有了左栏树、AI 可读写、搜索、备份与改稿历史。
 *
 * ```yaml
 * ---
 * title: 老枪的伤
 * status: planted      # planted 已埋 / paid 已回收 / dropped 已弃用
 * planted: chapters/01-开局.md
 * paid: chapters/05-归港.md
 * keywords: [老枪, 旧伤]   # 可选：能认出这条线的那几个词
 * ---
 * 正文…
 * ```
 *
 * 住 contracts 而不是 fs-store：主进程（AI 写伏笔）与渲染层（台账显示）要对同一份状态机
 * 达成一致，而渲染层进不了 fs-store。切分复用 frontmatter.ts 那一份真身（铁律 6）。
 */

export const FORESHADOW_STATUSES = ["planted", "paid", "dropped"] as const;
export type ForeshadowStatus = (typeof FORESHADOW_STATUSES)[number];

export interface ForeshadowMeta {
  status: ForeshadowStatus;
  /** 埋设在第几篇（文稿相对路径）；作者没写就是空串，不编。 */
  plantedIn: string;
  /** 回收在第几篇；没写就是空串。 */
  paidIn: string;
  /**
   * 可选：能认出这条线的那几个词（2026-10-22，C6 关键词回归）。
   * 没写就是空表——空表的那条不参与关键词核对，不替作者从标题里猜关键词。
   */
  keywords: string[];
  /**
   * frontmatter 里 `status:` 的**原样**取值（没写则是空串）。
   * 认不出的值不静默吞掉：status 照样按「已埋」算，但 UI 拿它说「这条的状态字段写错了」，
   * 而不是假装没看见——悄悄改成另一个状态才是真正的骗人。
   */
  rawStatus: string;
}

/** 从 frontmatter 的围栏块里取一个标量键；真身在 `frontmatter.ts` 的 `frontmatterField`（铁律 6）。 */
function fieldOf(block: string | null, key: string): string {
  return frontmatterField(block, key);
}

function isStatus(value: string): value is ForeshadowStatus {
  return (FORESHADOW_STATUSES as readonly string[]).includes(value);
}

/**
 * 解析一篇伏笔文稿的元数据。
 *
 * **一条不许猜的纪律**：只写了 `paid:` 而没写 `status:` 时，状态仍按「已埋未收」算。
 * 「回收章填了」不等于「这条伏笔收了」——作者可能只是留了个计划位置。宁可显示「已埋」叫作者去看一眼，
 * 也不替作者把伏笔判死（判死的伏笔会被归档，不再有人管）。
 */
export function parseForeshadowMeta(raw: string): ForeshadowMeta {
  const { block } = splitFrontmatter(raw);
  const rawStatus = fieldOf(block, "status");
  return {
    status: isStatus(rawStatus) ? rawStatus : "planted",
    plantedIn: fieldOf(block, "planted"),
    paidIn: fieldOf(block, "paid"),
    keywords: frontmatterList(block, "keywords"),
    rawStatus
  };
}

/** 状态 → 屏显说法。穷尽表：加一档状态而不写这里，编译不过。 */
const FORESHADOW_STATUS_LABELS: Record<ForeshadowStatus, string> = {
  planted: "已埋 · 待回收",
  paid: "已回收",
  dropped: "已弃用"
};

export function resolveForeshadowStatus(status: ForeshadowStatus): string {
  return FORESHADOW_STATUS_LABELS[status];
}
