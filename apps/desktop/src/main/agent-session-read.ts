import { UNBOUND, type SessionListItem, type SessionLoadResult } from "@mochen/contracts";
import {
  findLatestSession,
  findSessionById,
  listSessions,
  readSession
} from "@mochen/agent-runtime";
import type { BookSnapshot, BookService } from "./book-service.js";

/**
 * 会话的**只读**回程（2026-10-10 从 agent-service.ts 拆出）。
 *
 * 拆的理由与 `prompt-assembly.ts` 同一份：agent-service.ts 贴着 800 行的行数预算
 * （`tools/check-source-line-budget.mjs`，超限门禁直接红）。这一层只管「把盘上已经落好的
 * 会话读回来」——不跑 turn、不碰提案、不写盘，跟服务编排没有共享状态（唯一的外部可观察副作用
 * 是回填那张线程缓存，见 `loadSavedSession` 里的注释），所以拆出来两边都能各自长大。
 */

/** 缓存：线程标识 → 这本书里那条 JSONL 的相对路径。真身仍在 agent-service，这里只借用。 */
export interface SessionReadDeps {
  book: BookService;
  threads: Map<string, string>;
}

/**
 * 入参守卫与 `startTurnInputSchema` 同口径（spec §4.1，裁定 n 延续）：
 * 越界抛单句中文，非字符串（畸形 preload / 被改写的载荷）归一成空串走 unbound，绝不崩在 `.trim()` 上。
 *
 * 单独导出：渲染层与 IPC 那侧的守卫用例要钉的是**同一句**判据，两份口径迟早会不一样。
 */
export function normalizeThreadKey(raw: unknown): string {
  const text = typeof raw === "string" ? raw : "";
  if (text.length > 200) throw new Error("会话线程标识过长（最多 200 字），历史读不回来。");
  return text.trim() === "" ? UNBOUND : text.trim();
}

/**
 * 读回一条线程落盘的 JSONL；没书 / 没这条线程返回 `found:false`，首行坏直接抛中文。
 *
 * `sessionId` 与 `threadKey` 同一口径归一：非字符串 / 空白都当成「没指名」，走「最近那条」的老路径。
 */
export async function loadSavedSession(
  deps: SessionReadDeps,
  threadKey: string,
  sessionId?: string
): Promise<SessionLoadResult> {
  const key = normalizeThreadKey(threadKey);
  const id = typeof sessionId === "string" ? sessionId.trim() : "";
  const current: BookSnapshot | null = deps.book.current();
  if (current === null)
    return { found: false, reason: "no-book", message: "还没打开作品目录，历史读不回来。" };
  // 先查缓存：threads 只在拿到真实相对路径时才写入（threadFor 同口径），且换书即失效——
  // 所以这里拿到的 rel 一定落在**当前这本书**里，不存在「缓存了查不到的线程」。
  const cached = deps.threads.get(key);
  // 指名回放只认这一条 id 对应的文件，找不到就 no-session，**绝不退化成「最近那条」**：
  // 面板点的 A 却回放 B，比读不到更糟。
  const rel =
    id !== ""
      ? await findSessionById(current.root, key, id)
      : (cached ?? (await findLatestSession(current.root, key)));
  if (rel === null)
    return { found: false, reason: "no-session", message: "这本书里没有这条线程的历史。" };
  // 读到即缓存，与 threadFor 用同一个 Map：随后这一章第一次发轮会 append 到同一份 JSONL。
  // 指名的那一条要**覆盖**缓存——选中即改写入目标，否则下一轮又被 threadFor 拉回最近那条。
  if (id !== "" || cached === undefined) deps.threads.set(key, rel);
  // 首行坏：readSession 直接抛中文（rollout.ts:77-80 原文），这里不吞、不转 found:false。
  const stored = await readSession(current.root, rel);
  return {
    found: true,
    relPath: rel,
    meta: stored.meta,
    events: stored.events,
    droppedLines: stored.droppedLines
  };
}

/**
 * 这本书全部会话的总览（#113e 历史对话面板）。
 *
 * 无书返回空数组而不是抛错：面板那颗钮在无书时禁用，通路这边也不许谎报有会话。
 */
export async function listBookSessions(book: BookService): Promise<SessionListItem[]> {
  const current = book.current();
  if (current === null) return [];
  return listSessions(current.root);
}
