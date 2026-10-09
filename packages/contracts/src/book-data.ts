/**
 * 书内设定数据的读写契约（2026-10-09 扫描总单 P0-7）。
 *
 * **为什么是「键」而不是「路径」**：笔记 / 故事圣经 / 写作目标原先只住 `localStorage`，
 * 键不带书标识 ⇒ 两本书的设定互相串台，清缓存或换电脑就把设定整批丢掉（正文却在盘上，
 * 用户因此以为「软件删了我的心血」）。修法是把它们搬进书目录的 `.mochen/data/`。
 *
 * 搬过去之后新开了一条渲染层→磁盘的写通路，而这条通路的**形状**必须先立规矩：
 * 渲染层只递一枚白名单里的键，文件路径由主进程自己拼。这与技能市场
 * （`market:install` 只收 dirName）和插件（`plugins:toggle` 同理）是同一条铁律——
 * 让渲染层传路径，等于让浏览器决定主进程读写哪，路径穿越与盖掉 book.json 都随之开门。
 */

/** 白名单：书里到底有哪几份设定数据。加第四份先改这里，再改 store。 */
export const BOOK_DATA_KEYS = ["notes", "story-bible", "writing-goal"] as const;

export type BookDataKey = (typeof BOOK_DATA_KEYS)[number];

/**
 * 每份设定的中文显示名：换书/退出时「哪几份没落成」要点名，而不是笼统一句「有问题」。
 * 这张表必须与 `BOOK_DATA_KEYS` 一样宽（`test/book-data.test.ts` 钉着）——
 * 少一枚，提示里就会念出 `undefined`。
 */
export const BOOK_DATA_LABELS: Record<BookDataKey, string> = {
  notes: "笔记",
  "story-bible": "故事圣经",
  "writing-goal": "写作目标"
};

/**
 * 读的结果。四种情况必须分得开，因为它们决定调用方**敢不敢**接着写：
 * - `ok:true, json:null` ⇒ 这本书还没写过这类数据（正常，可迁移/可新建）；
 * - `ok:true, json:string` ⇒ 盘上有内容，原样交回，解析与否归渲染层；
 * - `no-book` ⇒ 还没打开作品目录。**刻意不与 `json:null` 混成一格**：后者会被渲染层
 *   读成「这本书是空的」，于是把上一本书的 localStorage 内容迁进当前书——串台正是这一波要治的病；
 * - `invalid-key` ⇒ 递来的键不在白名单里（含路径穿越的形状）；
 * - `unreadable` ⇒ 这一秒读不到（那一枚是目录、权限不对）。此时渲染层**不许**当成空库继续保存。
 */
export type BookDataReadResult =
  | { ok: true; json: string | null }
  | {
      ok: false;
      reason: "invalid-key" | "no-book" | "unreadable";
      message: string;
    };

/**
 * 写的结果。`not-json` 是刻意的一档：写下去的东西必须读得回来，
 * 否则「保存成功」的提示本身就是在撒谎。`invalid-key` / `no-book` 由主进程判
 * （渲染层递来的一切，以及「书根还在不在」都归这里，而不是指望调用方自律）。
 */
export type BookDataWriteResult =
  | { ok: true }
  | {
      ok: false;
      reason: "invalid-key" | "no-book" | "not-json" | "write-failed";
      message: string;
    };
