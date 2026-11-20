import path from "node:path";

/**
 * 写盘互斥队列（2026-10-10 批次 P1-6）：同一目标路径的写一次做完，不同路径照旧并发。
 *
 * **为什么必须有**：`writeDocFile` 的 critical section 是「读盘 → 指纹闸 → 备份 → 原子写 → 淘汰」，
 * 步与步之间全是 await 间隙。自动保存、手动 Ctrl+S、Agent 批准写盘三路并发进来时，
 * 指纹闸只能拦住「onDisk 与 expected 不符」的交叉；拦不住竞态窗口里恰好读到
 * 「onDisk == 将要覆写的内容」那一次——连点两次 Ctrl+S 会自撞出一个假冲突，要用户手动处置。
 * 同仓先例：JSONL 侧的并发 append 会交错成坏行，`agent-service.ts` 用一个严格串行的
 * `persist` 链修掉了；这里把同款口径搬到正文侧，只是**按路径分队**而不是全局一条链
 * （全局串行会把 1000 章的批量写拖死）。
 */

/** key = 规范化后的绝对路径 → 该路径上「最后一个已入队任务的完成信号」。 */
const tails = new Map<string, { done: Promise<void>; release: () => void }>();

/**
 * 等前单的上限（2026-11-20 审计 R-7）。
 *
 * 队列本身只等「前单跑完」这一个信号：前单卡在 fsync/rename 上永不回来（网络盘、休眠唤醒）时，
 * 这条路径之后的每一次保存都会无限期排队，界面表现为「一直保存中」。
 * 到点放行不等于前单停手——两个写手仍可能交错，但这比整本书再也存不下去轻得多。
 */
export const WRITE_QUEUE_WAIT_TIMEOUT_MS = 30_000;

/** 等到 `done` 或超时，先到先走；计时器始终清掉，不留悬着的句柄。 */
function settleOrTimeout(done: Promise<void>, timeoutMs: number): Promise<void> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return done;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
    // 这只计时器只是等待上限，不该拖住进程退出（浏览器端没有 unref）。
    (timer as unknown as { unref?: () => void }).unref?.();
  });
  return Promise.race([done, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * 队列 key 的规范化：先 `path.resolve` 统一分隔符、折叠 `.` 与多余尾分隔；
 * Windows 上再压平大小写——口径与 `changes.ts` 里的 `samePath` 完全一致
 * （同一判定只有一份口径：盘符大小写、8.3 短名之外，大小写混写的 root/relPath 必须排进同一条队，
 * 否则「同一文件的两种写法」会被当成两个文件放行，互斥形同虚设）。
 */
export function normalizeWriteKey(target: string): string {
  const resolved = path.resolve(target);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * 同 key 的任务严格排队执行；不同 key 并发。返回值/异常原样透传，调用方契约不变。
 *
 * `release()` 必须放在 **finally**：前一个任务哪怕抛错也不能把队列锁死——
 * 漏掉一次 release，这条路径之后的每一次写都会永远排在死掉的 gate 上。
 */
export async function runWriteExclusive<T>(
  key: string,
  task: () => Promise<T>,
  waitTimeoutMs = WRITE_QUEUE_WAIT_TIMEOUT_MS
): Promise<T> {
  const prev = tails.get(key);
  let release!: () => void;
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  tails.set(key, { done, release });
  // 只等「前单结束」这一个信号；前单的成败/异常由它自己的调用方拿去，不该传染给后单。
  if (prev) await settleOrTimeout(prev.done, waitTimeoutMs);
  try {
    return await task();
  } finally {
    release();
    // 队尾还是自己这一格才摘除：有人排在后面时它已把 tails 覆写成它的 gate，不能替它删。
    // 这一步不是为了不死锁（死锁由 release 兜着），而是不让 Map 随访问过的路径数无限膨胀。
    if (tails.get(key)?.done === done) tails.delete(key);
  }
}
