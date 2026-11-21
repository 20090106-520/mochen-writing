import type { DocRef, RecentBookEntry } from "@mochen/contracts";
import { sortDocsByOrder } from "./doc-order";

/**
 * 启动时静默恢复上次会话（2026-11-24）：恢复上次打开的书 + 落一个文稿标签。
 *
 * 【「会话恢复」的信号为什么取 recent-books 第一条，而不新落一份会话文件】
 * 主进程在每次 `book:open` / `book:create` 成功那一刻本来就记账（`main/index.ts` 的
 * `onOpened` 钩子 → `recentBooks.touch`），清单按 `lastOpenedAt` 倒序排好。也就是说
 * 「上次开的是哪本」这份事实**已经落盘了**（`<appData>/recent-books.json`），再发明
 * 一份 session.json 就是同一件事两份真源，两边还会各错各的。所以这里只读、不写：
 * 读清单、取第一条，够了。
 *
 * 【上次活动章为什么是「第一章」而不是真正关掉时的那一章】
 * `BookMeta` 里没有 lastActiveDoc 之类的落盘字段（contracts 的 BookMeta 逐字段核过，
 * 2026-11-24），`DocRef` 也不带 mtime；书内数据通路（book-data）的键是白名单制，
 * 加一枚新键要同时改 contracts 与 fs-store 的文件名表——那就是发明新落盘字段，
 * 本任务明确不做。写作目标的台账虽有 docRelPath，但粒度只到「天」，跨天就没了。
 * 所以退而求其次：按这本书自己的 `chapterOrder` 排序后开**第一章**——确定性、
 * 零新落盘；代价是恢复的位置可能不是上次停笔的那一章，等哪天 meta 愿意收
 * lastActiveDoc 了再升级，判据改这一处就够。
 *
 * 【静默的代价与边界】
 * - 书被移动/删除/清单损坏：开书 IPC 会失败。`openBookInto` 失败时会把一句人话
 *   写进 store 的 notice，这里在**同一个微任务**里把 notice 清掉——渲染层一帧都
 *   没画过它，所以屏上不会闪失败文案；启动退回首页空态，与没有这条功能时一样。
 * - 本函数自己吞掉一切异常（包括 IPC 通路的 throw）：main.ts 的全局
 *   unhandledrejection 会把漏网之鱼弹成错误通知，恢复失败绝没有资格惊动用户。
 * - 多开窗口：每个窗口的渲染层各自跑一遍恢复，会各自打开同一条「最近」——
 *   主进程的当前书是单份的，后开的那扇窗胜出；两扇窗显示同一本书，不丢字，
 *   只是本来就没承诺双窗各开各的书。
 * - 成功时不刻意压掉 openBookInto 留下的「已打开《…》」状态栏文案：它顺带告诉
 *   用户这次是恢复出来的哪一本，且不是错误。
 */

/** 恢复依赖的窄接口：判定真身在 book store 与 preload 那边，这里只描述要什么（铁律 6：不复制判据）。 */
export interface SessionRestoreDeps {
  /** 读最近清单（主进程已按时间倒序）。 */
  listRecent(): Promise<{ books: RecentBookEntry[] }>;
  /** 开一本书；返回打开成功后「手上有书」与否。失败由实现方走 store 的既有失败路。 */
  open(rootPath: string): Promise<boolean>;
  /** 清掉状态栏文案（恢复失败时把 openBookInto 留下的人话静音）。 */
  clearNotice(): void;
  /** 当前书的文稿清单（打开成功后读）。 */
  docs(): DocRef[];
  /** 当前书的章节次序（打开成功后读）。 */
  chapterOrder(): string[];
  /** 把一篇文稿开成文档标签。 */
  openDoc(relPath: string): Promise<void>;
}

/**
 * 按书的章节次序选「恢复落点」那一章：`chapterOrder` 排序后的第一枚正文章。
 * 没有任何章（空书 / 只有设定稿）返回 null，调用方就不开标签——空书开不了章是事实，不是错误。
 */
export function firstChapterRelPathOf(docs: DocRef[], chapterOrder: string[]): string | null {
  const first = sortDocsByOrder(docs, chapterOrder).find((doc) => doc.kind === "chapter");
  return first?.relPath ?? null;
}

/**
 * 跑一遍会话恢复。每一步失败都直接放弃剩下的步骤——恢复是锦上添花，
 * 任何一步都不值得为它把启动搞出动静。
 */
export async function restoreLastSession(deps: SessionRestoreDeps): Promise<void> {
  try {
    const { books } = await deps.listRecent();
    const first = books[0];
    if (first === undefined) return;
    const opened = await deps.open(first.rootPath);
    if (!opened) {
      // 开书失败（书被挪走/删了/盘坏了）：openBookInto 留下的失败文案在这里静音。
      // 同一微任务里清，渲染层没画过它——静默降级回首页空态。
      deps.clearNotice();
      return;
    }
    const relPath = firstChapterRelPathOf(deps.docs(), deps.chapterOrder());
    if (relPath === null) return;
    await deps.openDoc(relPath);
  } catch {
    // 恢复这条路自己就是兜底：清单读不到、IPC 抛了、标签开不了——全都按「没这个功能」处理。
    deps.clearNotice();
  }
}
