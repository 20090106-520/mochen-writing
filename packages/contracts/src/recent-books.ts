/**
 * 作品库（2026-10-21）。
 *
 * 存在的理由：这本书之前的形态是「一次只记得住一本」——主进程只持有一个当前快照，
 * 盘上也没有任何「我写过哪几本」的清单，于是用户建了第二本、第三本以后，界面上没有任何地方
 * 能把它们再找回来（左栏那组只画当前这本的文稿树）。这一份就是那份清单的契约。
 *
 * 落点在 `<appData>/recent-books.json`，**只记路径与书名**：正文一个字都不进这里，
 * 删除清单条目也绝不碰书目录（「从最近里移除」不是「删书」）。
 */
export interface RecentBookEntry {
  /** 书根绝对路径（book.json 所在目录）。 */
  rootPath: string;
  /** 最近一次打开时 book.json 里的书名。 */
  title: string;
  /** 最近一次打开的时间（ISO 字符串），清单按它倒序。 */
  lastOpenedAt: string;
  /** 最近一次打开时扫描到的章节数（可选：老条目没有这一格）。 */
  chapterCount?: number;
  /** 最近一次打开时扫描到的正文字数（可选：老条目没有这一格）。 */
  totalChars?: number;
}

/** 作品库的一次读回：按最近打开时间倒序，最多 20 条（上限住在主进程那份 store 里）。 */
export interface RecentBooksSnapshot {
  books: RecentBookEntry[];
}
