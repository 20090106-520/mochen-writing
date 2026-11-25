/**
 * 会话读取与回放一族（2026-11-20 从 useAgentStore 拆出：那份文件贴到 800 行预算）。
 *
 * 为什么这条边界成立：水合（ensureHydrated / runHydrate）、回放（applyReplay）、
 * 面板取数（refreshSessions）、指名切换（showSession）与覆盖式清空（resetThreadView）
 * 是同一条「把盘上的会话读回来、摆进线程视图」的功能面——只读写 store 的
 * hydrateInflight / sessions / 提案两表与 notice；与实时事件归约（apply / reduceEvent）
 * 只经 reduceEvent 这一个出口相交，除此之外不共享任何状态。宿主以第一参递进来，
 * 拿到的就是 store 那份响应式真身（写法同 agent-slash-dispatch 的 SlashDispatchHost）。
 */
import type { AgentEvent, SessionListItem, SessionLoadResult } from "@mochen/contracts";
import {
  EMPTY_STREAM,
  purgeThreadProposals,
  reasonOf,
  type BibleProposalView,
  type ProposalView,
  type ThreadView
} from "../utils/agent-thread";
import { readRemote } from "../utils/agent-requests";
import { replayProposalStatuses } from "../utils/timeline";
import type { SessionRowAction } from "../utils/session-row-action";
import { useBookStore } from "./useBookStore";

/** 宿主（useAgentStore）里被这一族读写的那几格与方法：结构对得上就行，不给这里另造第二份视图。 */
export interface SessionViewHost {
  notice: string;
  sessions: SessionListItem[];
  hydrateInflight: Record<string, Promise<void>>;
  proposals: Record<string, ProposalView>;
  bibleProposals: Record<string, BibleProposalView>;
  viewOf(threadKey: string): ThreadView;
  reduceEvent(
    thread: ThreadView,
    event: AgentEvent,
    options?: { fetchDiff?: boolean; absorbWrites?: boolean }
  ): void;
  rowActionFor(item: SessionListItem): SessionRowAction;
}

/** 水合入口：八条规则逐字照 spec §4.3。判定与取数全在 store，组件只触发。 */
export async function ensureHydrated(host: SessionViewHost, threadKey: string): Promise<void> {
  const thread = host.viewOf(threadKey);
  if (thread.hydrated) return; // 规则1 幂等
  if (thread.running) return; // 规则2 running 时不抢顺序
  if (thread.hydrating) {
    // 规则3 并发合流：复用同一次在途取数，不发第二条 IPC
    const inflight = host.hydrateInflight[threadKey];
    if (inflight !== undefined) await inflight;
    return;
  }
  thread.hydrating = true;
  const task = runHydrate(host, threadKey, thread);
  host.hydrateInflight[threadKey] = task;
  try {
    await task;
  } finally {
    delete host.hydrateInflight[threadKey];
  }
}

export async function runHydrate(
  host: SessionViewHost,
  threadKey: string,
  thread: ThreadView
): Promise<void> {
  let result: SessionLoadResult;
  try {
    result = await window.mochen.loadSession(threadKey);
  } catch (err) {
    // 规则3 失败回滚：首行坏 / IPC 抛 ⇒ 留待用户再按 /resume 重试
    thread.hydrating = false;
    host.notice = `这条线程的历史没有读回来：${reasonOf(err)}`;
    return;
  }
  thread.hydrating = false;
  if (!result.found) {
    // 规则5：no-session 视为确实没有历史 ⇒ 置位；no-book 不置位（下次开书还得能水合）
    if (result.reason === "no-session") thread.hydrated = true;
    return;
  }
  applyReplay(host, thread, result);
  thread.hydrated = true;
}

/** 回放载荷落进线程视图的共用一段（`/resume` 与面板指名切换同一条通路）：按事件 id 去重（规则4）、派生扫描覆盖卡片状态（规则6）、只有 interrupted 结尾才复活「继续」（规则8）、坏行如实播报（规则7）；回放路径既关 diff 取数（M1），也关写盘回吸收与实时提示覆盖（D1）。 */
export function applyReplay(
  host: SessionViewHost,
  thread: ThreadView,
  result: Extract<SessionLoadResult, { found: true }>
): void {
  // 规则4：只归约 items 里不存在该事件 id 的那些
  const known = new Set(thread.items.map((item) => item.id));
  for (const event of result.events) {
    if (known.has(event.id)) continue;
    known.add(event.id);
    host.reduceEvent(thread, event, { fetchDiff: false, absorbWrites: false });
  }
  // 规则6：派生扫描覆盖这些卡的 status（expired 卡已在规则4 里没请求 diff）
  const replayed = replayProposalStatuses(result.events);
  for (const [id, status] of Object.entries(replayed)) {
    const view = host.proposals[id] ?? host.bibleProposals[id];
    if (view) view.status = status;
  }
  // 规则8：只有最后一条是 interrupted 才复活「继续」；error 保守不标 failed
  const last = result.events[result.events.length - 1];
  if (last?.type === "interrupted") thread.endedAs = "interrupted";
  thread.sessionId = result.meta.sessionId;
  // 规则7：坏行如实播报，不伪造事件、不静默
  if (result.droppedLines.length > 0)
    host.notice = `这条线程有 ${result.droppedLines.length} 行没能读回，其余内容已恢复。`;
}

/** 面板打开时的取数：失败只写 notice、不清空已显示的行——把「读不到」伪装成「没有历史」比报错更坏。 */
export async function refreshSessions(host: SessionViewHost): Promise<void> {
  const read = await readRemote(() => window.mochen.listSessions(), "历史对话没有读回来");
  if (read.ok) host.sessions = read.value;
  else host.notice = read.notice;
}

/** 覆盖式切换用的清空：显示态归零，并删掉这一条线程名下的提案卡（旧会话的卡不许留在新视图上）。 */
export function resetThreadView(host: SessionViewHost, threadKey: string): void {
  const thread = host.viewOf(threadKey);
  thread.items = [];
  thread.streaming = { ...EMPTY_STREAM };
  thread.lastError = "";
  thread.endedAs = "";
  thread.sessionId = "";
  purgeThreadProposals(host.proposals, threadKey);
  purgeThreadProposals(host.bibleProposals, threadKey);
}

/** 换书 / 关书时 useAgentStore 被整体作废的那十格：字段名对得上就行（与 SessionViewHost 同一作风）。 */
interface BookSwitchResetHost {
  notice: string;
  sessions: SessionListItem[];
  hydrateInflight: Record<string, Promise<void>>;
  proposals: Record<string, ProposalView>;
  bibleProposals: Record<string, BibleProposalView>;
  threads: Record<string, ThreadView>;
  composerDrafts: Record<string, string>;
  pendingSend: Record<string, string>;
  draftSets: Record<string, unknown>;
  /** 占用条的读数是按这本书算的；换书不清，新书的占用条会挂着上一本的数字。 */
  contextPreview: unknown;
}

/**
 * 换书 / 关书的整体作废（2026-11-24，用户裁定「新书的对话还是第一本的内容」）。
 * 会话 JSONL 盘上按书分（书内 `.mochen/sessions`），但渲染层的会话视图按**线程键**
 * （relPath / unbound）记——键里没有书。不清的话新书打开就读到上一本留在内存里的转录，
 * 看上去就像「新书被第一本覆盖、对话也不分开」。清的是**内容来自某一本具体的书**的内存态：
 * 转录、历史清单、占用条（contextPreview）、提案、输入框草稿、还字账、多稿候选、在途水合、notice。
 * 不清：技能库表（全局）、思考档 / 联网 / 工具开关（用户偏好）、线程级技能覆盖（applyOpened 另清）。
 */
export function resetForBookSwitch(host: BookSwitchResetHost): void {
  host.threads = {};
  host.sessions = [];
  host.proposals = {};
  host.bibleProposals = {};
  host.composerDrafts = {};
  host.pendingSend = {};
  host.draftSets = {};
  host.hydrateInflight = {};
  host.contextPreview = null;
  host.notice = "";
}

/** 点面板一行 = 切到那条会话接着聊。与 `/resume` 的分别是「最近那条」对「指名的那条」：主进程 loadSession 收到 sessionId 会把这一条线程的写入目标改过去，下一轮就续在它后面。 */
export async function showSession(host: SessionViewHost, item: SessionListItem): Promise<void> {
  const action = host.rowActionFor(item);
  if (action.kind !== "open") {
    host.notice = action.reason;
    return;
  }
  const threadKey = item.docRelPath; // 裁定 o：绑定线程的键恒等于文稿路径
  const book = useBookStore();
  // 抢在换标签之前置位：openDocTab 会让组件补一次「最近那条」的自动水合，那一读若先回来就把
  // 用户亲手点开的这一条盖掉了；读失败再照原值退回，`/resume` 还能重试。
  const wasHydrated = host.viewOf(threadKey).hydrated;
  host.viewOf(threadKey).hydrated = true;
  if (book.activeDocTab !== threadKey) await book.openDocTab(threadKey);
  let result: SessionLoadResult;
  try {
    result = await window.mochen.loadSession(threadKey, item.sessionId);
  } catch (err) {
    host.viewOf(threadKey).hydrated = wasHydrated;
    host.notice = `这条线程的历史没有读回来：${reasonOf(err)}`;
    return;
  }
  resetThreadView(host, threadKey);
  host.notice = "";
  if (!result.found) {
    // 主进程那句中文就是全部实话：不假装切过去了，也不留下上一条会话的显示。
    // 切失败要把 hydrated 退回原值：否则 ensureHydrated 见 true 早退，/resume 也救不回来，
    // 这条线程就永久变砖（与上面 catch 分支同一口径）。
    host.viewOf(threadKey).hydrated = wasHydrated;
    host.notice = result.message;
    return;
  }
  applyReplay(host, host.viewOf(threadKey), result);
}
