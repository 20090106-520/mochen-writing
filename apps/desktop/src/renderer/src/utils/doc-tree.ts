import type { DocRef } from "@mochen/contracts";
import { docRefSchema, sortDocs } from "@mochen/contracts";

/**
 * 把主进程算好的那一篇 `DocRef` 拼进渲染层的文稿树（P1-4 后半，2026-10-10）。
 *
 * 【这一刀省掉的是什么】建完一章 / 改完一个标题 / 智能体写完一章，渲染层过去要
 * `refreshDocs()`——那是又一次 `openBook`，也就是把**整本书**每篇正文再读一遍（夹具 1000 章 × 3000 字
 * 实测 99–136 ms，主进程那半边已经改成单点重算 1 ms，剩下这一半在同一条链上，而智能体一轮写 N 篇时
 * 它是 N×整本）。现在主进程随 `doc:create` / `doc:refresh` 带回**这一篇**的 `DocRef`，这里只拼它一根。
 *
 * 【为什么拼出来的一定与整本重扫等价】落位用的是 contracts 的 `sortDocs`——与主进程 `scanBook`
 * 之后那次排序**同一个函数**（判据只有一份，铁律 6；两份判据并存正是这一刀过去切不下去的原因）。
 * 顺序、去重、以及「未登记的按名字序」全部由那一份决定，这里一条都不重写。
 *
 * 【三种出去的方式】
 * ① 带回来的东西认不出形状 / 不是我们要的那一篇 ⇒ **null**，调用方退回整本重扫。
 *    宁可慢一次，也不在屏上挂一根盘上可能没有的稿件——那等于把「界面有这一章」和「盘上有这一章」
 *    分家，是 P0 那一批（静默丢稿 / 假控件）反复钉过的病。
 * ② 同 `relPath` 已在树里（外力删过又建回、改名后重算）⇒ 以新值替换，不出现两条。
 * ③ 正常 ⇒ 新数组，**绝不就地改动传入的 docs**（那一格被 Vue 响应式包着，就地 sort 绕过变更追踪）。
 *
 * 【`raw` 为什么是 unknown】它是跨进程字段，渲染层没见过生产端；验形状用 contracts 的
 * `docRefSchema`（先例：`main/quit-flush.ts` 对退出握手回话做同样的事）。
 */
export function applyDocRef(
  docs: DocRef[],
  chapterOrder: string[] | undefined,
  raw: unknown,
  requestedRelPath: string
): DocRef[] | null {
  const parsed = docRefSchema.safeParse(raw);
  if (!parsed.success) return null;
  // 「是不是我们要的那一篇」也在这儿问：跨进程字段连 relPath 都不能默认对得上。
  if (parsed.data.relPath !== requestedRelPath) return null;
  // zod 的 `.optional()` 输出把「缺席的键」带成 `undefined`，与 `DocRef` 的可选键
  // （exactOptionalPropertyTypes）对不上：这里把 undefined 键剥掉再进树——
  // 消费处本来就按 `?? ""` / `?? 0` 读，剥不剥值不变，剥的只是键的形状。
  const fresh: DocRef = {
    relPath: parsed.data.relPath,
    kind: parsed.data.kind,
    title: parsed.data.title,
    ...(parsed.data.excerpt === undefined ? {} : { excerpt: parsed.data.excerpt }),
    ...(parsed.data.chars === undefined ? {} : { chars: parsed.data.chars })
  };
  // ② 同一篇已在树里：以盘上刚算出的新值为准，只留一条。
  const rest = docs.filter((doc) => doc.relPath !== parsed.data.relPath);
  return sortDocs([...rest, fresh], chapterOrder ?? []);
}

/**
 * `useBookStore` 里被这一层动得到的那三枚（写成结构最小形状，用例才不必造一整份 store）。
 *
 * `meta` 只用到 `chapterOrder` 这一枚，所以这里就只声明这一枚：
 * 声明成整份 `BookMeta` 会让用例被迫造一堆与落位无关的字段，而那些字段一多就藏得住错。
 */
export interface DocTreeBook {
  docs: DocRef[];
  meta: { chapterOrder: string[] } | null;
  refreshDocs(): Promise<void>;
}

/**
 * 「拼得进就不重扫，拼不进才重扫」这一个分支（建章 / 改标题 / 吸收智能体写入三处共用）。
 *
 * 为什么只写一遍：那三处过去各写一句 `await this.refreshDocs()`，等于把「什么时候需要整本再读一遍」
 * 抄了三遍。三份口径迟早会有一份忘了改——这一刀的全部意义就是让那三处都不必再读整本。
 */
export async function syncDocRef(book: DocTreeBook, relPath: string, raw: unknown): Promise<void> {
  const next = applyDocRef(book.docs, book.meta?.chapterOrder, raw, relPath);
  if (next === null) {
    await book.refreshDocs();
    return;
  }
  book.docs = next;
}

/**
 * 问主进程重算那一篇（`doc:refresh`），再把结果落进树。
 *
 * 抛错不在这里吞：`renameDocTitle` / `absorbAgentWrite` 过去那句 `refreshDocs()` 一样会把
 * 主进程边界的拒绝上抛给调用方，静默在这儿兜住只会让「树没更新」变成谁也都看不见的第三态（铁律 6）。
 */
export async function refreshDocRef(book: DocTreeBook, relPath: string): Promise<void> {
  const result = await window.mochen.refreshDoc(relPath);
  // `ok` 是唯一的成败判据：失败回话里就算塞来一根形状完全合法的 doc 也不许拼——
  // 主进程说没算成，那根东西盘上就没有，挂上屏等于把界面和盘上分家（先例见文件头①）。
  await syncDocRef(book, relPath, result.ok ? result.doc : null);
}
