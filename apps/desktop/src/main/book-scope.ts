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
