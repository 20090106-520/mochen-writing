import type { BookOpenResult } from "@mochen/contracts";
import { bookDataFlushNotice, withBookDataFlush } from "./bookDataRegistry";
import { openFailureText } from "../utils/book-open-failure";

/**
 * 「打开作品」这一族的落点（2026-11-12，从 `useBookStore` 搬出来）。
 *
 * 【为什么搬】`book:open` 是**抛错语义**（读不到 `book.json` 就 throw），而 `book:create`
 * 返回 `{ ok, message }`——两条通道两种口径。原先 `openBook` 既没 catch 也不看返回值，
 * 于是「作品库里点一条目录已经不在的书」= 一个没人处理的 promise rejection：
 * 界面没有任何变化，用户不知道是书没了还是软件坏了。补上失败分支要加几行，
 * 而 `useBookStore.ts` 已经贴着 800 行预算——正好这时候该拆，不该压。
 *
 * 【为什么用「目标对象」而不是把 store 传进来】这一层只需要三样东西：写一句 notice、
 * 把打开结果填进去、调 `book:pick`。传整个 store 会让这个模块反过来依赖 store 的类型，
 * 与「composable 不认识具体 store」这条既有分层相反。
 */
export interface BookOpenTarget {
  /** 一句话提示（store 里那块 notice）。 */
  notice: string;
  /** 把打开结果填进 store（`openBook` 与 `createBook` 共用的那一段）。 */
  applyOpened(opened: BookOpenResult): void;
}

/**
 * 打开一本作品。成功填进去并报「已打开」，失败只说一句人话。
 *
 * 失败时**不动任何状态**：主进程的 `snapshot` 只在成功后才换，也就是说打开失败时
 * 当前这本书原样还在——这里顺手清空 rootPath / docs 等于把用户在写的那本也弄没了。
 */
export async function openBookInto(target: BookOpenTarget, rootPath: string): Promise<void> {
  try {
    // 换书前先把上一本未落盘的设定交回**上一本**：主进程的当前书在这次 IPC 落地那一刻就换了。
    const opened = await withBookDataFlush(() => window.mochen.openBook(rootPath));
    target.applyOpened(opened);
    target.notice = bookDataFlushNotice(`已打开《${opened.meta.title}》`);
  } catch (error) {
    target.notice = openFailureText(error);
  }
}

/**
 * 选一个目录再打开。用户取消时**什么都不做**——已打开的作品、草稿、标签一律保持原样，
 * 只在 notice 上说一句「未选择」，别让界面看起来像失败了。
 */
export async function pickAndOpenInto(target: BookOpenTarget): Promise<void> {
  const picked = await window.mochen.pickBookDirectory();
  if (!picked) {
    target.notice = "未选择作品目录";
    return;
  }
  await openBookInto(target, picked);
}
