import type { FlushQuitReply } from "@mochen/contracts";
import type { FlushAllResult } from "./draft-flush";

/**
 * 退出握手的渲染层接线（2026-10-09 全仓扫描 P0-6）。
 *
 * 兜底判定与逐篇落盘都已有真身（`draft-flush` 的 `flushAllBeforeQuit`），这里只补三段通路：
 * 该不该跑兜底、把结果换算成契约里那两句形状、以及回程发不出去时**不许把异常带出去**——
 * 那一刻主进程已经在退出路上，一个未处理的 rejection 换不回任何字，只会往崩溃日志里灌水。
 */

/** store 递进来的那一格：只需要这两个事实，好让本模块不 import pinia、也不依赖整份 store 形状。 */
export interface QuitFlushTarget {
  rootPath: string | null;
  flushAllForQuit(): Promise<FlushAllResult>;
}

/** preload 面上这两枚就够：整份 `RendererApi` 在这儿没有额外用处，收窄了才好测。 */
export interface QuitFlushApi {
  onQuitFlushRequest(listener: () => void): () => void;
  quitFlushDone(reply: FlushQuitReply): Promise<void>;
}

/** 兜底结果 → 契约回程。`blocked` 恒为数组（缺字段就是主进程眼里的「形状不对」，会被按放行处理）。 */
export function quitReplyOf(result: FlushAllResult | null): FlushQuitReply {
  if (result === null || result.ok) return { ok: true, blocked: [] };
  return { ok: false, blocked: result.blocked };
}

/**
 * 跑一次兜底并答话。
 *
 * 「书没打开」不走兜底：那时 `docTabs` 与存档都是空的，跑一遍等于白跑，
 * 而主进程正等着——不回话就只能靠超时放行，用户看到的是一次迟钝的关闭。
 */
export async function replyQuitFlush(target: QuitFlushTarget, api: QuitFlushApi): Promise<void> {
  const result = target.rootPath === null ? null : await target.flushAllForQuit();
  const reply = quitReplyOf(result);
  try {
    await api.quitFlushDone(reply);
  } catch {
    // 通道已断（主进程已在退出）：话已经尽力递过一次了，这里再抛出去就是未处理 rejection。
  }
}

/**
 * 装上监听，返回退订函数。不叠两层的责任在调用方（store 里那枚 `quitFlushOff`：装配那一行先摘旧再订新）：
 * 叠两层的后果是一次关闭落两遍盘、回两条话，主进程按第一条走，第二条纯属灌水。
 */
export function installQuitFlushListener(target: QuitFlushTarget, api: QuitFlushApi): () => void {
  return api.onQuitFlushRequest(() => {
    void replyQuitFlush(target, api);
  });
}
