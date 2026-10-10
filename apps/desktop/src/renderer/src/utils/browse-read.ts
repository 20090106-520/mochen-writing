import type { DocContent } from "@mochen/contracts";
import { failureReasonOf } from "./draft-flush";

/**
 * 右栏「浏览」那一格的读盘通路（2026-10-09 扫描总单 P1-9）。
 *
 * **为什么单独一处**：这条路上有三道闸，旧写法一道都没有——一次 IPC 抛错就把那一格
 * 永久留在「正在读取…」上（而且屏幕上一个字都不说），换书后上一本书那次慢回包会按同一个
 * relPath 写进新书的缓存（`chapters/01.md` 这种键根本不带书标识），连点同一格会为同一篇发好几次读盘。
 * 三道闸都是**时序**上的规矩，和 pinia 的赋值缠在一起就得起了 store 才验得动；
 * 判定抽成注入 IO 的纯通路后逐条钉在 `browse-read.test.ts`，store 那边只钉接线。
 *
 * `useBookStore.browse()` 是本通路唯一的调用方：模式与 `openDocTab` 那一路同源
 * （世代令牌 + `failureReasonOf`），只是令牌各管各的事。
 */

/**
 * 换书的世代号：一次换书 +1（`resetBrowseReadGates`）。
 *
 * 为什么不复用中栏那枚 `docLoadToken`：它每打开一篇文稿都会 +1，而浏览的在途读
 * 不该因为用户在中栏切了个标签就跟着作废。两边作废的是不同的事，就该各有一枚号。
 */
let bookEpoch = 0;

/**
 * 这一格此刻有没有在途读盘。放模块级：它是记账用的，不是视图状态，
 * 进 pinia state 只会被响应式代理白白包一层（同 `autoSaveTimer` 的理由）。
 * 读成功、读失败、处理函数自己抛错，三条路都必须摘掉它——漏一次那一格就永久不再尝试。
 */
const browseInFlight = new Set<string>();

/**
 * 换书时把这条通路的记账整体作废（`applyOpened` 唯一调用点）：
 * ① 世代号 +1——上一本书那些还在途的回包回来时令牌对不上，一律丢弃；
 * ② 在途集合清空——上一本书那格还挂在 Set 里，这一本同 relPath 的那格就会被「已在途」挡掉，
 *    而挡住它的那次读又会被上面的世代号丢掉：那一格就永久读不出来了。
 */
export function resetBrowseReadGates(): void {
  bookEpoch += 1;
  browseInFlight.clear();
}

/**
 * 读不动时上屏那一句（点名是哪一格、为什么）。
 * 措辞只有一份：测试与渲染层都引这里，免得改措辞时只改了一半。
 */
export function browseFailureNotice(relPath: string, reason: string): string {
  return `没能读到正文：${relPath}（${reason}）`;
}

/** 本通路对渲染层状态的要求，逐条都是「把这一格摆成某样」——真身在 `useBookStore`。 */
export interface BrowseReadIO {
  /** 缓存里已有这一格的正文（含空串：空稿也是「读到了」，不该再发一次读盘）。 */
  hasCached(relPath: string): boolean;
  /** 这一格此刻还开着吗：中途关掉之后回包再回来也不许留缓存条目。 */
  isOpen(relPath: string): boolean;
  /** 读盘真身：`window.mochen.readDoc`，用例里换成可编程的假身。 */
  read(relPath: string): Promise<DocContent>;
  /** 新一轮尝试的起手：上一轮的失败理由不能留着和这一轮混在一起。 */
  clearFailure(relPath: string): void;
  /** 正文到手。只在世代号仍有效、且这一格仍开着时被调用。 */
  onResult(relPath: string, content: string): void;
  /** 读不动：理由与屏上那句话（`browseFailureNotice`）。 */
  onFailure(relPath: string, reason: string): void;
}

/**
 * 点一次浏览 = 请求把这一格的正文读回来。
 *
 * 三道闸的**顺序**也是判定的一部分：先问缓存（有就一个都不发），再问在途（连点只发一次），
 * 然后才记下在途、抹掉旧理由、发读盘。
 */
export function readBrowseBody(io: BrowseReadIO, relPath: string): void {
  if (io.hasCached(relPath)) return;
  if (browseInFlight.has(relPath)) return;
  browseInFlight.add(relPath);
  io.clearFailure(relPath);
  const epoch = bookEpoch;
  // 「在途」标记在**知道结果的那一刻**就摘掉，而不是留到 `.finally`：
  // `.finally` 比 `.catch` 晚一个微任务，用户看到失败理由后立刻再点一次会撞进那次还没散的在途，
  // 于是"重试"被自己上一次失败挡掉——正是要治的「永久空格」，不能靠多等一拍来绕。
  void io
    .read(relPath)
    .then(
      (loaded) => {
        browseInFlight.delete(relPath);
        if (epoch !== bookEpoch) return;
        // 中途关掉那一格同样不许写：重开那一格该看到新读，而不是这一轮的旧快照。
        if (!io.isOpen(relPath)) return;
        io.onResult(relPath, loaded.content);
      },
      (err: unknown) => {
        browseInFlight.delete(relPath);
        if (epoch !== bookEpoch) return;
        io.onFailure(relPath, failureReasonOf(err));
      }
    )
    .catch(() => {
      // 兜住上面两个处理函数自己抛错（比如状态代理层出错）：在途标记绝不能漏，
      // 那句拒绝也绝不能甩到进程上——渲染层弹一条「Uncaught (in promise)」不是给用户看的话。
      browseInFlight.delete(relPath);
    });
}
