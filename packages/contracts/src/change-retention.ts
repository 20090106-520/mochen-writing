// 结构出处见 docs/ATTRIBUTION.md。
// 改稿历史的**保留上限**（2026-10-06 批次 5-⑧）。
//
// **为什么上限要能调**：`writeDocFile` 每写一次盘就整篇留一份，默认自动保存档是停手 2 秒就存。
// 批次 5-⑦ 加的固定上限（50 份 / 32 MB）解决了「只增不减」，但那是**我替用户定的**：
// 写短篇的人想多留几十份（回滚点更密），写超长篇的人想少留（省盘）。
// 把这个数交回设置页，是产品决定，不该由我替他选。
//
// **默认档与 5-⑦ 那两个写死的值一字不差**：没设置过时行为完全不变（铁律同 autosave-preference）。
import { z } from "zod";
import type { ChangePruneReport } from "./changes.js";

/**
 * 份数上限的允许范围。**下界 = 档位表的下界（10）**。
 *
 * 2026-10-06 真机实测后改的：原先下界是 5，而档位表是 10/25/50/100/200/500。
 * 于是「配 5 份」在语义上合法、界面上却**没有任何一档能被选中**——两排卡片全是灰的，
 * 用户既不知道自己存了什么，也改不回去。**允许一个选不出来的档是自相矛盾的**：
 * 范围必须与 `CHANGE_RETENTION_COUNT_OPTIONS` 完全一致。
 * 下界 10 的理由本身也够：低于这个数，「撤销撤销」之外的路基本就没了。
 */
export const CHANGE_RETENTION_COUNT_MIN = 10;
export const CHANGE_RETENTION_COUNT_MAX = 500;
/** 字节上限的允许范围：5 MB ~ 512 MB。 */
export const CHANGE_RETENTION_MB_MIN = 5;
export const CHANGE_RETENTION_MB_MAX = 512;

export const ChangeRetentionSchema = z.object({
  /** 每篇留最近多少份。 */
  maxCount: z
    .number()
    .finite()
    .int()
    .min(CHANGE_RETENTION_COUNT_MIN)
    .max(CHANGE_RETENTION_COUNT_MAX),
  /** 每篇合计不超过多少字节。 */
  maxBytes: z
    .number()
    .finite()
    .int()
    .min(CHANGE_RETENTION_MB_MIN * 1024 * 1024)
    .max(CHANGE_RETENTION_MB_MAX * 1024 * 1024)
});
export type ChangeRetention = z.infer<typeof ChangeRetentionSchema>;

/** 默认档 = 5-⑦ 那两个写死的值（50 份 / 32 MB）。 */
export const DEFAULT_CHANGE_RETENTION: ChangeRetention = {
  maxCount: 50,
  maxBytes: 32 * 1024 * 1024
};

/**
 * 坏值一律夹回默认档，**不抛**。
 *
 * 为什么不抛（与 `appearance-store` 同一口径）：这份配置坏在启动路上把整个应用堵死，
 * 代价远大于「退回默认值继续跑」。外观是这么处理的，改稿历史上限也该是。
 */
export function sanitizeChangeRetention(value: unknown): ChangeRetention {
  if (!value || typeof value !== "object") return { ...DEFAULT_CHANGE_RETENTION };
  const candidate = value as Partial<ChangeRetention>;
  const clampInt = (raw: unknown, min: number, max: number, fallback: number): number => {
    if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
    return Math.min(max, Math.max(min, Math.round(raw)));
  };
  return {
    maxCount: clampInt(
      candidate.maxCount,
      CHANGE_RETENTION_COUNT_MIN,
      CHANGE_RETENTION_COUNT_MAX,
      DEFAULT_CHANGE_RETENTION.maxCount
    ),
    maxBytes: clampInt(
      candidate.maxBytes,
      CHANGE_RETENTION_MB_MIN * 1024 * 1024,
      CHANGE_RETENTION_MB_MAX * 1024 * 1024,
      DEFAULT_CHANGE_RETENTION.maxBytes
    )
  };
}

export interface ChangeRetentionOption {
  value: number;
  label: string;
  note: string;
}

/**
 * 界面上摆的份数档位。
 *
 * 档位是**离散的几档**而不是滑块：滑块能停在 73 份这种数上，用户回头看不懂自己调到了哪；
 * 离散档配上「大概占多少盘」的话，他能自己判断该选哪一档。
 * 字数按一篇 300 KB 的长篇估（10 万字中文正文约 300 KB），短篇实际占用远低于这个数。
 */
const MB = 1024 * 1024;
/**
 * 界面上摆的份数档位。
 *
 * **这张表与 `CHANGE_RETENTION_COUNT_MIN/MAX` 必须完全一致**（真机复验时才发现过两者对不上：
 * 范围下界 5、档位下界 10，于是「5 份」配得出来却选不中，界面两排全灰）。
 * 下面那条守卫把这件事钉住了。
 */
export const CHANGE_RETENTION_COUNT_OPTIONS: readonly number[] = [10, 25, 50, 100, 200, 500];
/** 估算用的单篇体积（长篇约 300 KB，这里取 320 KB 留一点余量）。 */
const ASSUMED_DOC_BYTES = 320 * 1024;

export function changeRetentionCountOptions(): ChangeRetentionOption[] {
  return CHANGE_RETENTION_COUNT_OPTIONS.map((value) => {
    const mb = (value * ASSUMED_DOC_BYTES) / MB;
    return {
      value,
      label: `${value} 份`,
      note:
        mb >= 1024
          ? `够回退到很早的版本；按一篇 300 KB 的长篇估，这档大约占 ${(mb / 1024).toFixed(1)} GB。`
          : `按一篇 300 KB 的长篇估，这档大约占 ${mb.toFixed(0)} MB。短篇实际占用远低于这个数。`
    };
  });
}

export const CHANGE_RETENTION_MB_OPTIONS: readonly number[] = [5, 20, 32, 100, 256, 512];
export function changeRetentionMbOptions(): ChangeRetentionOption[] {
  return CHANGE_RETENTION_MB_OPTIONS.map((value) => ({
    value,
    label: `${value} MB`,
    note:
      value <= 5
        ? "很省盘，只够回退最近的几次。适合机器盘小、稿子短。"
        : `${value} MB 以内。篇数与字节谁先越线就按谁删，${value >= 100 ? "长篇通常由这条先管住" : "短篇通常由份数那条先管住"}。`
  }));
}

/** 界面上写给用户看的那句上限说明（面板与设置页共用这一份，不许各写一遍）。 */
export function changeRetentionNote(retention: ChangeRetention): string {
  const mb = Math.round(retention.maxBytes / MB);
  return `每篇只留最近 ${retention.maxCount} 份、合计不超过 ${mb} MB，超出的由墨宸自动清理（最旧的先走，最新那份永远留着）。`;
}

/** 读回来的那份：带 `persisted` 标志，口径与外观设置完全一致。 */
export interface ChangeRetentionSnapshot {
  /** false = 盘上还没有、或读回来不合法——这时给的是**默认档**，界面上要说清不是用户设的。 */
  persisted: boolean;
  retention: ChangeRetention;
}

/**
 * 字节数摆给用户看的那句话（2026-10-06 批次 5-⑧）。
 *
 * 住 contracts 而不是组件里：改稿历史面板与设置页都要说「腾出多少」，两处各写一遍
 * 迟早写出两种写法（一个说 MB 一个说 KiB），而用户是在两个地方看同一个数的。
 * 阈值：≥ 1 GB 用 GB，否则 MB，字节太小才落到 KB——这三个单位对「一篇文章的备份」是够的。
 */
export function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "0 B";
  const value = Math.max(0, Math.round(bytes));
  if (value >= 1024 * MB) return `${(value / (1024 * MB)).toFixed(1)} GB`;
  if (value >= MB) return `${(value / MB).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

/**
 * 「立即清理」之后摆给用户看的那句实话。
 *
 * **删掉 0 条与删掉 300 条必须说成不同的话**：现在真会走到「本来就没什么可清」这条路
 * （默认 50 份 / 32 MB，而多数人一天攒不到 50 次保存）。回一句「已清理」等于让用户
 * 以为刚才那一下白按了，而白按一次在设置里是很容易被当成功能坏了的动作。
 */
export function changePruneReportLine(report: ChangePruneReport): string {
  if (report.removed === 0) {
    return `没什么可清的：现在只有 ${report.kept} 份、${humanBytes(report.keptBytes)}，本来就在上限内。`;
  }
  return (
    `删掉 ${report.removed} 份、腾出 ${humanBytes(report.freedBytes)}；` +
    `还留着 ${report.kept} 份、${humanBytes(report.keptBytes)}。`
  );
}
