/**
 * 按书作用域：换书即失效，判定只有这一份。
 *
 * 【为什么必须有这一下——真机 2026-10-06 批次 5-㉔ 撞出来的】
 * agent-service 有一张 `threads` 表记「threadKey → 会话相对路径」，而相对路径是**相对于
 * 当时那本书**的。两本书只要有一篇**同名文稿**（新建章节的默认标题极易撞），threadKey 就
 * 一模一样，于是新书里的 `threadFor` / `loadSession` 会拿上一本书的路径去读新书下的同名文件，
 * 在 `readSession` 上抛 ENOENT。
 *
 * 症状不是「历史读不回来」，而是**新书里第一句话直接发不出去**，对话一条都没起来；
 * 用户看到的是一条 `ENOENT: no such file or directory, open '…rollout-….jsonl'`。
 * 复现很短：连跑两轮、中间不重启进程，第二轮必挂。
 *
 * 为什么之前没被发现：写缓存那处的注释是「只在拿到真实相对路径时才写入」，
 * 读缓存那处的注释是「不存在缓存了查不到的线程」——**两条都只在单书内成立**，
 * 而作用域一变那条不变量就没了。单看每处都像是对的，合起来才是错的。
 *
 * 落点规则只有一条：**凡是会读或写按作用域状态的入口，开头都要先调一次 `sync()`**。
 * 它幂等且便宜（一次读 + 一次字符串比较），漏掉任何一处就等于给那一处留了一条跨作用域的缝
 * ——实测漏过两处，都是**测试自己有洞**才暴露出来的。
 */
export interface BookScope {
  /** 作用域变了就清；同一作用域内连续调用是空操作。 */
  sync(): void;
  /** 退出时复位，不留半张表。 */
  reset(): void;
}

/**
 * 自动批准判据的键：把「书身份（书根目录）」并进本地判别式，**只在这一处拼装**（铁律 6）。
 *
 * 【和上面 threads 撞名是同源的同一刀】`threads` 撞的是「threadKey → 会话相对路径」，
 * 自动批准这两张表撞的是「本地判别式 → 免审授权」：
 * - `accept-session`（本章不再问）按 `threadKey` 记，而 threadKey 恒等于文稿相对路径；
 * - `accept-prefix`（同文档同类改动不再问）按 `${docRelPath}::${tool}` 记。
 * 两者都不含书身份，于是两本书只要有**同名文稿**（新建章节的默认标题极易撞），
 * A 书点过一次「接受并本会话自动批准」，B 书撞名文稿的提案就**不经确认直接落盘**。
 *
 * 【拿不到书根怎么办，写死在这里】书根取不到（`null` = 没开书）⇒ 返回 `null`。
 * 调用方据此**不得命中**自动批准——也就是保守回落到人工确认，绝不放行。
 * 不许用一个猜出来的根、空串或某个默认值去兜：那等于把「拿不准」伪装成「已授权」。
 *
 * 连接符用 NUL（`\u0000`）：它不会出现在文件系统路径里，也不会出现在 `docRelPath::tool`
 * 那种判别式里，所以拼接可逆、不会因为路径自身含分隔串而让两本书撞成同一个键。
 */
export function scopedApprovalKey(root: string | null, local: string): string | null {
  if (root === null) return null;
  return `${root}\u0000${local}`;
}

/**
 * @param readRoot 读当前作用域标识（通常是当前书目录）。返回 null = 没开书，也算一个作用域。
 * @param clear 真正清掉按作用域存放的那些表，由调用方决定清哪些——
 *   **哪些算「按书」是 agent-service 的判断，不在这里猜**。
 */
export function createBookScope(readRoot: () => string | null, clear: () => void): BookScope {
  // 初值 null ≠ 任何一根真实路径，于是「第一本书」与「没开书」都会触发一次清空；
  // 清空空表本来就是空操作，不必为它单开一个分支。
  let scopedRoot: string | null = null;
  return {
    sync() {
      const root = readRoot();
      if (root === scopedRoot) return;
      scopedRoot = root;
      clear();
    },
    reset() {
      scopedRoot = null;
      clear();
    }
  };
}
