/**
 * 改稿历史保留上限的**默认档与取值范围**（2026-10-06 批次 5-⑧）。
 *
 * **为什么在 fs-store 里又抄一份**：`fs-store` 不能依赖 `contracts` 的运行时代码
 * （`tools/check-package-boundary.mjs` 会拦），而 `writeDocFile` 每次写盘都要读这个上限。
 * 两边必须是同一个数，所以：
 * ① 真身住在 `contracts/change-retention.ts`（`DEFAULT_CHANGE_RETENTION` 与四个范围界）；
 * ② 这里只抄**数字**，不抄任何判定；
 * ③ 接线测试（`apps/desktop/src/main/change-retention-defaults.test.ts`）把两处的数字对着钉，
 *    并逐个脏值比对两边的处理结果——改了一处没改另一处就红。
 *
 * 这不是「两份实现」——判定（该删哪些）在 `changes.ts` 的 `planChangePruning`，
 * 只有这六个纯数字跨包出现了两次，且被测试钉着。
 */

/** 每篇留最近多少份（默认值）。 */
export const DEFAULT_CHANGE_KEEP_PER_DOC = 50;
/** 每篇合计不超过多少字节（默认值，32 MB）。 */
export const DEFAULT_CHANGE_KEEP_BYTES_PER_DOC = 32 * 1024 * 1024;

/**
 * 允许的范围（2026-10-06 批次 5-⑧ 补齐）。
 *
 * **为什么 fs-store 这侧也必须夹，而不是「只判 > 0」**：夹不住的下界方向是**更危险**的那个。
 * 递进来 `maxCount: 3` 时，只判 `> 0` 会照办——于是 `planChangePruning` 把这一篇砍到只剩 3 份，
 * 而用户在那边的设置页上明明被夹在了 10 份。**下界必须与 contracts 一致**，
 * 否则「界面上说留 10 份、盘上只剩 3 份」这种最难查的分家就会回来。
 *
 * 上界同理：递进来一个荒诞的 10^9 会让淘汰形同虚设（这正是 5-⑦ 修掉的那个「只增不减」）。
 * 这里与 contracts 用 `Math.round` 而不是 `Math.floor`：**向上取整只会多留、不会少留**，
 * 对一个要删东西的操作，少留的那一边才是出错的那一边（两个包的取整方向也因此一致）。
 *
 * 下界 10 与 contracts 的档位表下界一致（2026-10-06 真机复验时改的：原先这里是 5、
 * 那边档位表从 10 起，于是「5 份」配得出来却没有任何一档能被选中）。
 */
export const CHANGE_KEEP_COUNT_MIN = 10;
export const CHANGE_KEEP_COUNT_MAX = 500;
export const CHANGE_KEEP_BYTES_MIN = 5 * 1024 * 1024;
export const CHANGE_KEEP_BYTES_MAX = 512 * 1024 * 1024;

/** 与 `contracts` 的 `ChangeRetention` 同形（纯数据）。 */
export const DEFAULT_CHANGE_RETENTION = {
  maxCount: DEFAULT_CHANGE_KEEP_PER_DOC,
  maxBytes: DEFAULT_CHANGE_KEEP_BYTES_PER_DOC
} as const;

/**
 * 把「可能来自 IPC、可能被人手改坏」的上限值收成能直接用的两个数（2026-10-06 批次 5-⑧）。
 *
 * **坏值退回默认档或夹到范围边界，不抛、绝不返回 0**：返回 0 会让 `planChangePruning`
 * 判定「全删光」——那等于把用户的改稿历史一次清空，比配置坏掉严重得多。
 *
 * 住在 `retention-defaults.ts` 而不是 `read-write.ts`：`changes.ts` 也要用它（回滚那条路），
 * 放在 `read-write.ts` 会形成 `read-write → changes → read-write` 的循环 import。
 */
export function resolveRetention(
  override?: {
    maxCount?: unknown;
    maxBytes?: unknown;
  } | null
): { maxCount: number; maxBytes: number } {
  if (override === undefined || override === null) return { ...DEFAULT_CHANGE_RETENTION };
  const count = Number(override.maxCount);
  const bytes = Number(override.maxBytes);
  return {
    maxCount: clampInt(
      count,
      CHANGE_KEEP_COUNT_MIN,
      CHANGE_KEEP_COUNT_MAX,
      DEFAULT_CHANGE_KEEP_PER_DOC
    ),
    maxBytes: clampInt(
      bytes,
      CHANGE_KEEP_BYTES_MIN,
      CHANGE_KEEP_BYTES_MAX,
      DEFAULT_CHANGE_KEEP_BYTES_PER_DOC
    )
  };
}

function clampInt(raw: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.round(raw)));
}
