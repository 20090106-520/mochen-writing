/// <reference types="node" />
/**
 * 通道级授权（2026-10-15，台账第六十九节）。
 *
 * 【为什么独立成一份文件】ipc-guard.ts 的 800 行预算已经吃紧（来源闸 + 形状闸 +
 * realpath 闸 + 窗口闸四块），通道级授权这一刀加进来会越线。拆到这里不改变「判据只有
 * 一份」的约束（铁律 6）：`channelTrustVerdict` 只在 channel-trust.ts 实现一次，
 * ipc-guard.ts 只调它。
 *
 * 【这一层挡得住什么】注入脚本趁「没书」时调 self 档通道——特别是那些没挂
 * insideCurrentBook 的 self 档通道（`book:save-meta` / `book-data:*` / `book-backup:*`
 * / `book:replace-all` / `import:commit`），原先它们在没书时被 service 各自判 no-book
 * 挡回去，但主进程侧没有形式化真身。本刀把这件事收口到 `IPC_TRUST_LEVELS` 这一份表。
 *
 * 【这一层挡不住什么】同源页内注入脚本趁「有书」时调任意通道：那一帧的 URL 与来源完全
 * 合法，主进程侧与合法脚本不可区分（`ipc-guard.ts:20-23` 顶上注释已自认）。真正拦
 * 这件事的是 CSP + fs-store 写盘闸，不是这里。
 *
 * 【判据真身住哪】`currentBookRoot` 的真身在 book-service（`service.current()?.root`，
 * 见 `book-service.ts:81` 的 `current()` 与 `agent-service.ts:158` 的 `currentRoot`）。
 * channel-trust.ts 只通过装配点取它，不写第二份「当前书根」判定（铁律 6）。
 */

import { IPC_CHANNELS } from "@mochen/contracts";

/**
 * 通道级授权需要的主进程运行时态查询器。
 *
 * 与 `installRendererTrust` 同款：装配点装上去之后判据只有一份，漏装一次＝那几条
 * self 档通道裸奔，而**没装上＝一律不信**（fail closed）比漏装一次全放行安全得多。
 *
 * 【为什么只装一个查询器就够】本刀只做 self 档（要求当前书已打开）。sensitive 档
 * （要求"没有进行中的 agent 轮"等更严判据）要装第二个查询器，留下一刀避免越失败
 * 边界（与台账「webdav pull 留下一刀」同一条铁律）。
 */
export interface ChannelTrustDeps {
  /** 当前打开的那本书的根目录；没开书返回 null。 */
  currentBookRoot(): string | null;
}

let installedChannelDeps: ChannelTrustDeps | null = null;

export function installChannelTrustDeps(deps: ChannelTrustDeps | null): void {
  installedChannelDeps = deps;
}

export function installedChannelTrustDeps(): ChannelTrustDeps | null {
  return installedChannelDeps;
}

/**
 * 通道级授权的分档表：与 `IPC_ARG_SHAPES` 并列——形状表管「参数长什么样」，
 * 分档表管「这条通道要求什么运行时态」。两张表都按通道名索引，新增通道时若有
 * self 档要求就落这。
 *
 * 【两档口径】
 * - `public`（默认，不在表里也算 public）：不要求当前书已打开。开建选书（`book:open` /
 *   `book:create` / `book:pick`）、设置类（`provider:*` / `appearance:*` / `skills:*` /
 *   `market:*` / `plugins:*`）、应用级（`app:*` / `update:check`）、agent 控制（`agent:*`）、
 *   远程配置（`webdav:*`，要不要落到哪本书在 service 内部判）、`import:pick-preview`。
 * - `self`：要求当前书已打开。所有「会动当前书内字节」或「语义上要有书」的通道——
 *   `doc:*` / `trash:*` / `changes:*` / `book-backup:*` / `book-data:*` / `book:save-meta`
 *   / `book:replace-all` / `import:commit`。
 *
 * 【为什么 `book:open` / `book:create` 是 public】开建选书时还没书，self 档会把自己挡死。
 * 【为什么 `webdav:*` 是 public】远程配置（config-get/save/verify）与书无关；push/list
 *   要不要落到哪本书由 webdav-service 内部判 no-book，与 channelTrustVerdict 不重复
 *   （铁律 6：同一判据只许一处真身，这里不抢 service 的判）。
 * 【为什么 `agent:*` 是 public】agent 轮控制不要求书已打开——`agent:list-sessions` /
 *   `agent:load-session` 在没书时也能用（用户可能先看历史线程再开书）；`agent:start-turn`
 *   等的「有没有书」判据住在 agent-service 自己那层，不在 channelTrustVerdict 抢。
 *
 * 【sensitive 档留下一刀】要求"没有进行中的 agent 轮"等更严判据要装第二个查询器，
 * 本刀只做 self 档避免越失败边界（与台账「webdav pull 留下一刀」同一条铁律）。
 */
export const IPC_TRUST_LEVELS: Record<string, "public" | "self"> = {
  // —— 会动当前书内字节的 self 档 ——
  [IPC_CHANNELS.bookSaveMeta]: "self",
  [IPC_CHANNELS.bookDataRead]: "self",
  [IPC_CHANNELS.bookDataWrite]: "self",
  [IPC_CHANNELS.docRead]: "self",
  [IPC_CHANNELS.docWrite]: "self",
  [IPC_CHANNELS.docCreate]: "self",
  [IPC_CHANNELS.docRefresh]: "self",
  [IPC_CHANNELS.docTrash]: "self",
  // —— 回收站（书内 .mochen/trash/） ——
  [IPC_CHANNELS.trashList]: "self",
  [IPC_CHANNELS.trashRestore]: "self",
  // —— 改稿历史（书内 .mochen/changes/） ——
  [IPC_CHANNELS.changesList]: "self",
  [IPC_CHANNELS.changesRead]: "self",
  [IPC_CHANNELS.changesDiff]: "self",
  [IPC_CHANNELS.changesRestore]: "self",
  [IPC_CHANNELS.changesRetentionGet]: "self",
  [IPC_CHANNELS.changesRetentionSave]: "self",
  [IPC_CHANNELS.changesPruneNow]: "self",
  // —— 整书备份（书内 .mochen/backups/） ——
  [IPC_CHANNELS.bookBackupCreate]: "self",
  [IPC_CHANNELS.bookBackupList]: "self",
  [IPC_CHANNELS.bookBackupRestore]: "self",
  // —— 全书替换与导入提交（要有书才能替换/导入） ——
  [IPC_CHANNELS.bookReplaceAll]: "self",
  [IPC_CHANNELS.importCommit]: "self"
};

/**
 * 通道级授权判定。返回 null = 这条通道的档位要求满足；返回中文字符串 = 挡下理由。
 *
 * 在 `trustedHandler` 里挂在 `senderTrustVerdict` 之后、`argRulesFor` 之前：来源不可信时
 * `senderTrustVerdict` 已经拒了，到这里来源都可信，只问「这条通道的档位要求满不满足」。
 *
 * 【与 insideCurrentBook 的关系】insideCurrentBook 判「relPath 解出来在书内」（realpath 级），
 * 它的前提「书根非 null」是隐式判——书根 null 时 realpath 失败也拒，但属于"误打误撞挡住"。
 * `channelTrustVerdict` 判「有没有书」（快判），是 doc:* 的前置快判：没书时直接拒，
 * 不走 realpath，理由说得出口。两者不重复：一个判"书状态"，一个判"路径越界"。
 *
 * 【fail closed】没装 `ChannelTrustDeps` 时，self 档通道一律按不可信处理（与
 * `senderTrustVerdict` 没装 trust 时同款），漏装一次不能让 self 档通道裸奔。
 */
export function channelTrustVerdict(channel: string): string | null {
  const level = IPC_TRUST_LEVELS[channel];
  if (level === undefined || level === "public") return null;
  // self 档：要求当前书已打开（判据真身在 book-service，通过装配点取）
  if (installedChannelDeps === null) {
    return "通道级授权没装上（启动装配没跑到 installChannelTrustDeps），这条按不可信处理。";
  }
  const root = installedChannelDeps.currentBookRoot();
  if (root === null) {
    return `这条通道（${channel}）属于 self 档：要求当前已打开一本书，但现在没有书。`;
  }
  return null;
}
