/**
 * 跨 IPC **取数**的薄壳（P0-② 顺手搬出来的，2026-10-19）。
 *
 * 只做一件事：把 rejection 收成中文（`reasonOf`），让每个调用点在 store 里少一层 try/catch。
 * **失败前缀**仍由调用点给（`提案差异取回失败` 这类）——那句话说的是「这次读不到意味着什么」，
 * 只有那个调用点知道，不该在这里再兜一份。
 *
 * 为什么不搬进 agent-thread.ts：那份文件的门槛是「纯函数、零 IPC」，这一枚恰恰要碰 window。
 */

import { reasonOf } from "./agent-thread";

/** 读一次：成功给 `value`，失败给 `notice`（= `前缀：原因`）；调用点不再各写一份 catch。 */
export async function readRemote<T>(
  read: () => Promise<T>,
  failure: string
): Promise<{ ok: true; value: T } | { ok: false; notice: string }> {
  try {
    return { ok: true, value: await read() };
  } catch (err) {
    return { ok: false, notice: `${failure}：${reasonOf(err)}` };
  }
}
