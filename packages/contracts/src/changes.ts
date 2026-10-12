/**
 * 改稿历史（2026-10-05）。
 *
 * 住在 contracts 而不是 fs-store：IPC 的 `changes:list` 要把这份形状跨进程发给渲染层，
 * 而 contracts 不能反向依赖 fs-store（包边界检查会拦）。fs-store 那边从这份转出去，
 * 两边共用同一个类型，不许各写一份长得像的。
 */

/** 一次改稿留下的那条备份。 */
export interface ChangeEntry {
  /** 时间戳目录名，如 `2026-10-05T12-34-31-168Z`。 */
  stamp: string;
  /** 当时被改的那篇文稿的相对路径，如 `chapters/01-开局.md`。 */
  docRelPath: string;
  /** 备份在盘上的相对路径（含 `.mochen/` 前缀），读回与回滚都拿它当句柄。 */
  backupRelPath: string;
  /** 备份体积，给 UI 一眼看出「这条是整章重写还是小改」。 */
  bytes: number;
}

/**
 * 「这一份改前备份 ↔ 盘上此刻的正文」逐行对比的结果（2026-10-13）。
 *
 * **为什么算在主进程**：逐行 diff 的真身只有一份，住在 `packages/agent-runtime/src/diff.ts` 的
 * `unifiedDiff`（提案卡那套 `agent:diff` 用的也是它）。渲染层禁 import agent-runtime，
 * 判据写在 `ipc.ts` 的 `proposalDiff` 注释里——所以改稿历史要 diff 也只能走主进程算好、
 * 渲染层只管渲染这条路。在渲染层再抄一份 LCS 就是第二份判据（铁律 6）。
 *
 * `ok:true` 且 `diff === ""` 是**成功**，含义是「两边逐行相同」——回滚这一条不会有任何变化。
 * 这句话必须说得出来，所以失败单独一档 `ok:false`，而不是用空串同时表示「没变」和「没算出来」。
 */
export type ChangeDiffResult = { ok: true; diff: string } | { ok: false; message: string };

/**
 * 一次「立即清理」的结果（2026-10-06 批次 5-⑧）。
 *
 * **为什么回这些数而不是一句「已清理」**：清掉 0 条和清掉 300 条对用户是两件事。
 * 界面要能说「清掉了 312 份，腾出 87 MB」，也要能老实说「本来就没什么可清的」——
 * 这两种场合现在都会发生（本来就是默认档、盘上没攒够时）。
 */
export interface ChangePruneReport {
  /** 真删掉几份。0 = 本来就在上限内。 */
  removed: number;
  /** 删完之后还剩几份。 */
  kept: number;
  /** 腾出多少字节。 */
  freedBytes: number;
  /** 清完之后的剩余总字节。 */
  keptBytes: number;
}
