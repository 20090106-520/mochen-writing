import { shallowRef } from "vue";
import { BOOK_DATA_LABELS, type BookDataKey } from "@mochen/contracts";

/**
 * 设定数据通路的登记表（2026-10-09 扫描总单 P0-7）。
 *
 * 为什么单独一个文件、而且不 import 任何 store：
 * `useBookStore.openBook()` 要在换书**之前**把上一本书里未落盘的那一笔交回去，
 * 而通路本体（`useBookFileData`）本身要读 `useBookStore` 的当前书根。
 * 让 store 直接 import 通路就是 `store → composable → store` 的循环引用；
 * 中间放这一枚只有登记表与闸门的叶子模块，两边各自引它，环就断了。
 *
 * 顺序为什么不能反过来：主进程的「当前书」在 `book:open` 落地那一刻就换了，
 * 而渲染层的 `rootPath` 是那次 IPC **返回之后**才更新的。
 * 等看到 rootPath 变化再写，那一笔就顺着新书的根落进了新书的文件里——
 * 这正是这一波要治的串台，只是换了个方向。
 */

type BookDataFlusher = () => Promise<boolean>;

const flushers = new Map<BookDataKey, BookDataFlusher>();

/**
 * 上一次闸门里没落成的那几枚键；`bookDataFlushNotice` 据此点名。
 * 用 shallowRef：状态栏要能随着「重试成功」立刻收起按钮，而失败清单只由本模块写。
 */
export const bookDataFlushFailedKeys = shallowRef<BookDataKey[]>([]);

/** 通路实例按自己的键登记；同一枚键后登记的覆盖先登记的（热重载不留双份）。返回注销函数。 */
export function registerBookDataFlusher(key: BookDataKey, flush: BookDataFlusher): () => void {
  flushers.set(key, flush);
  return () => {
    if (flushers.get(key) === flush) flushers.delete(key);
  };
}

/**
 * 把所有登记中的通路立刻落盘。
 *
 * 三条硬口径：
 * - **每一枚都要跑**：漏一枚就是那一本的改动跟着进新书；
 * - 某一枚抛错不许中断其余的：先跑完再汇总，否则第一枚坏了会让后面几枚永远不落盘；
 * - 返回「是不是全都落成了」，并把没落成的键记下来供提示用（每次调用都重算，旧话不挂着）。
 */
export async function flushAllBookData(): Promise<boolean> {
  const failed: BookDataKey[] = [];
  for (const [key, flush] of [...flushers]) {
    try {
      if (!(await flush())) failed.push(key);
    } catch {
      failed.push(key);
    }
  }
  bookDataFlushFailedKeys.value = failed;
  return failed.length === 0;
}

/**
 * 换书那一次 IPC 的唯一正确包法：先交回上一本的设定，再执行 `call`。
 *
 * 闸门**不拦换书**——上一本没存好不是把用户锁在应用里的理由，那只会让他以为
 * 「软件卡死了」；该做的是让他知道哪几份没落成（`bookDataFlushNotice`）。
 * `call` 自己抛错时原样往外传：这里吞掉，换书失败就成了静默失败。
 */
export async function withBookDataFlush<T>(call: () => Promise<T>): Promise<T> {
  await flushAllBookData();
  return await call();
}

/** 基础提示（`已打开《X》`）后面补上「哪几份没落进上一本」；没有失败记录就一字不改。 */
export function bookDataFlushNotice(base: string): string {
  if (bookDataFlushFailedKeys.value.length === 0) return base;
  const names = bookDataFlushFailedKeys.value.map((key) => BOOK_DATA_LABELS[key]).join("、");
  return `${base}（上一本的${names}没能全部存进它的目录）`;
}

/**
 * 状态栏「重试保存」的唯一实现：再跑一遍闸门，回一句给人看的话。
 *
 * 成功就报「已补存」，并把失败清单清空（按钮随之收起）；
 * 仍失败就点名还差哪几份，按钮留着让用户检查权限后再试。
 */
export async function retryFailedBookData(): Promise<string> {
  const ok = await flushAllBookData();
  if (ok) return "已补存上一本没写进目录的设定。";
  const names = bookDataFlushFailedKeys.value.map((key) => BOOK_DATA_LABELS[key]).join("、");
  return `仍有${names}没能存进目录，请检查磁盘权限后再试。`;
}

/** 有几枚通路登记着：接线用例用它证明「三本 store 都真的接上了」，而不是只接了一本。 */
export function bookDataFlusherCount(): number {
  return flushers.size;
}

/** 用例与热重载用的清空：产品代码不调它。 */
export function resetBookDataFlushers(): void {
  flushers.clear();
  bookDataFlushFailedKeys.value = [];
}
