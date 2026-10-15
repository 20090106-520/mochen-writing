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
 * insideCurrentBook 的 self 档通道（`book:save-meta` / `book-data:*` / `book-backup:*`），
 * 原先它们在没书时被 service 各自判 no-book 挡回去，但主进程侧没有形式化真身。
 * 本刀把这件事收口到 `IPC_TRUST_LEVELS` 这一份表；sensitive 档（第七十四节）再收一层
 * 「有书但有一轮 agent 正在跑」时的整书级批量改写。
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
 * self / sensitive 档通道裸奔，而**没装上＝一律不信**（fail closed）比漏装一次全放行安全得多。
 *
 * 【两个查询器对两档】`currentBookRoot` 供 self 与 sensitive 共用的前置快判（有没有书），
 * `turnRunning` 供 sensitive 档再判「有没有一轮 agent 正在跑」。两者都要求提交时一并装上：
 * `turnRunning` 是**必填字段**——漏装它的装配点会在 typecheck 阶段红，比人工数站点更稳。
 */
export interface ChannelTrustDeps {
  /** 当前打开的那本书的根目录；没开书返回 null。 */
  currentBookRoot(): string | null;
  /** 是否有任意一条对话线程正在跑一轮（agent 待落盘的提案还没结算）。 */
  turnRunning(): boolean;
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
 * self / sensitive 档要求就落这。
 *
 * 【三档口径】
 * - `public`（默认，不在表里也算 public）：不要求当前书已打开。开建选书（`book:open` /
 *   `book:create` / `book:pick`）、设置类（`provider:*` / `appearance:*` / `skills:*` /
 *   `market:*` / `plugins:*`）、应用级（`app:*` / `update:check`）、agent 控制（`agent:*`）、
 *   远程配置（`webdav:*`，要不要落到哪本书在 service 内部判）、`import:pick-preview`。
 * - `self`：要求当前书已打开。所有「会动当前书内字节」或「语义上要有书」的通道——
 *   `doc:*` / `trash:*` / `changes:*` / `book-backup:*` / `book-data:*` / `book:save-meta`。
 * - `sensitive`：要求当前书已打开，**且**没有一轮 agent 正在跑。整书级批量改写——
 *   `book:replace-all`（逐篇重写）与 `import:commit`（批量建章、改 chapterOrder）。
 *
 * 【为什么 `book:open` / `book:create` 是 public】开建选书时还没书，self 档会把自己挡死。
 * 【为什么 `webdav:*` 是 public】远程配置（config-get/save/verify）与书无关；push/list
 *   要不要落到哪本书由 webdav-service 内部判 no-book，与 channelTrustVerdict 不重复
 *   （铁律 6：同一判据只许一处真身，这里不抢 service 的判）。
 * 【为什么 `agent:*` 是 public】agent 轮控制不要求书已打开——`agent:list-sessions` /
 *   `agent:load-session` 在没书时也能用（用户可能先看历史线程再开书）；`agent:start-turn`
 *   等的「有没有书」判据住在 agent-service 自己那层，不在 channelTrustVerdict 抢。
 *
 * 【sensitive 为什么只这两条（第七十四节）】入选判据是「一口气改写整本书的结构或全篇字节」：
 * 轮次中调用会与 agent 待落盘的提案结构性冲突——那批改动落盘时基线已变，指纹守卫会拒，
 * 于是那一轮以一句难懂的话失败，用户看到的是「模型忽然抽风」。这一档把这个难懂的失败
 * 前移成一句人话。
 * 【sensitive 为什么不含这三条】
 * - `book:save-meta`：`/permissions`（→ `book.setPermissionMode`）与 `/stage` 都在
 *   DURING_TURN_COMMANDS 里，用户轮次中调它们是合法动作，闸了就是误伤。
 * - `book-backup:restore`：落点在**书旁边**（`<书父目录>/<书名>-恢复自备份-<时间戳>/`），
 *   不碰当前书的字节，与轮次无冲突。
 * - `changes:restore`：单篇回滚太合法（轮次中改错了单篇要立刻回滚是常态），不是整书级改写。
 */
export const IPC_TRUST_LEVELS: Record<string, "public" | "self" | "sensitive"> = {
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
  // —— 整书级批量改写（sensitive 档：要有书，且没有一轮 agent 正在跑） ——
  [IPC_CHANNELS.bookReplaceAll]: "sensitive",
  [IPC_CHANNELS.importCommit]: "sensitive"
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
 * 【fail closed】没装 `ChannelTrustDeps` 时，self 与 sensitive 档通道一律按不可信处理
 * （与 `senderTrustVerdict` 没装 trust 时同款），漏装一次不能让它俩裸奔。`turnRunning`
 * 是必填字段：漏装它的装配点会在 typecheck 阶段红，不在运行期才炸。
 */
export function channelTrustVerdict(channel: string): string | null {
  const level = IPC_TRUST_LEVELS[channel];
  if (level === undefined || level === "public") return null;
  // self / sensitive 两档都先过同一道「有没有书」的快判（判据真身在 book-service，通过装配点取）
  if (installedChannelDeps === null) {
    return "通道级授权没装上（启动装配没跑到 installChannelTrustDeps），这条按不可信处理。";
  }
  const root = installedChannelDeps.currentBookRoot();
  if (root === null) {
    return `这条通道（${channel}）属于 ${level} 档：要求当前已打开一本书，但现在没有书。`;
  }
  if (level === "self") return null;
  // sensitive 档再加一道：没有一轮 agent 正在跑（判据真身在 agent-service 的 runningTurns）
  if (installedChannelDeps.turnRunning()) {
    return `这条通道（${channel}）属于 sensitive 档：有一轮智能体正在跑，整书级改写会和它待落盘的改动打架——先等它答完，或按 Esc 打断那一轮再试。`;
  }
  return null;
}
