/**
 * 全书替换（2026-10-15）：把当前这本书里每一篇的字面命中一次性换掉。
 *
 * 【这一刀为什么落在主进程】渲染层要自己换，就得先把全书正文拉进内存（3000 章＝3000 次
 * `doc:read` 外加一整本书的文本驻在渲染进程里），而「哪一篇里有这一处」本来只有盘上那份
 * 字节说了算。这里逐篇「读 → 换 → 写」，一篇正文都不往渲染层搬。
 *
 * 【安全面与 doc:write 一模一样】读走 `readDocFile`、写走 `writeDocFile`：
 *   - 写前 realpath 判「这一篇真在书目录里」（软链越界写不出去）；
 *   - 指纹守卫：传进去的是**我刚读到的那份字节**的指纹，谁在那之后改了它，这一篇就报
 *     `stale` 一个字都不动，绝不盖掉人家刚写的字；
 *   - 改前原文整篇进 `.mochen/changes/...`，写是原子的 —— 半途出事盘上也不会留半截正文。
 *
 * 【为什么没有「全有全无」】这个操作本来就是「很多篇各自的一次写」，不是一件事务。
 * 真出事时每篇改前的样子都在改稿历史里了，用户要的是**知道哪几篇没换成**，
 * 而不是「全书回滚」那一套——那会把期间用户自己保存的别的改动一起抹掉。
 *
 * 【判据只有一份】「什么叫字面命中」在 `@mochen/contracts` 的 `replaceLiteral`
 * 里（与文档内查找替换同一份），这里只负责搬运，绝不另写一套匹配。
 */
import type {
  BookReplaceInput,
  BookReplaceResult,
  BookReplaceSkipped,
  DocRef
} from "@mochen/contracts";
import { replaceLiteral } from "@mochen/contracts";
import { readDocFile, writeDocFile, type AtomicWriteFs } from "@mochen/fs-store";

export interface BookReplaceDeps {
  /** 当前这本书的根。 */
  root: string;
  /** 当前这本书的文稿快照（要动哪几篇由它决定，渲染层递不了清单）。 */
  docs: readonly DocRef[];
  /** 现取保留上限（与 `doc:write` 同一条：设置页随时可能改过）。 */
  retention(): { maxCount: number; maxBytes: number };
  /** 写盘用的那份 fs（与 `doc:write` 同一缝，测试靠它造「只坏一步」）。 */
  fs?: AtomicWriteFs;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 逐篇替换。**回执永远说真话**：
 * - `ok:true` 只说「这一趟跑完了」，不是说「每一篇都换成了」——没换成的都在 `skipped` 里点名；
 * - 一处都没命中的篇不算「改了」，于是「改了 0 篇」与「改过 3 篇」在界面上分得开。
 */
export async function replaceAcrossBook(
  input: unknown,
  deps: BookReplaceDeps
): Promise<BookReplaceResult> {
  const raw = (
    typeof input === "object" && input !== null ? input : {}
  ) as Partial<BookReplaceInput>;
  const query = typeof raw.query === "string" ? raw.query : "";
  const replacement = typeof raw.replacement === "string" ? raw.replacement : "";
  const caseSensitive = raw.caseSensitive === true;
  // 空查询在这里拦死：空模式会匹配每一处间隙，跑下去就是把全书切碎。入口那一侧的形状闸只看
  // 「是不是个对象」，语义判定归这一处——
  if (query === "")
    return {
      ok: false,
      reason: "invalid-input",
      message: "要找的内容是空的：空串会把每一篇切成无数段，这一条不做。"
    };

  // 上限现取（不缓存）；取不到就退回默认档，判定与 `doc:write` 用的是同一处 resolveRetention。
  let retention: { maxCount: number; maxBytes: number } | null = null;
  try {
    retention = deps.retention();
  } catch {
    // 装配没给好不等于替换失败：正文必须照写，淘汰退回默认档。
  }

  let changedDocs = 0;
  let replacedCount = 0;
  const skipped: BookReplaceSkipped[] = [];

  for (const doc of deps.docs) {
    let content: string;
    let fingerprint: string;
    try {
      ({ content, fingerprint } = await readDocFile(deps.root, doc.relPath));
    } catch (error) {
      skipped.push({
        relPath: doc.relPath,
        title: doc.title,
        reason: "failed",
        message: `读不到这一篇（${messageOf(error)}），没有动它。`
      });
      continue;
    }

    const { text: next, count } = replaceLiteral(content, query, replacement, { caseSensitive });
    // 没命中、或「换成的东西和原来一字不差」（例如 query 与 replacement 同一串）都不算改动：
    // 后者交给 writeDocFile 的幂等短路也行，但在这里就断掉更省事——盘上本来就不用动。
    if (count === 0 || next === content) continue;

    const written = await writeDocFile(
      deps.root,
      doc.relPath,
      next,
      fingerprint,
      retention,
      deps.fs
    );
    if (!written.ok) {
      const stale = written.reason === "stale";
      skipped.push({
        relPath: doc.relPath,
        title: doc.title,
        reason: stale ? "stale" : "failed",
        message: stale
          ? "我读它之后有人改过这一篇，没有覆盖（那一次改动留着了）。"
          : written.message
      });
      continue;
    }

    changedDocs += 1;
    replacedCount += count;
  }

  return { ok: true, scannedDocs: deps.docs.length, changedDocs, replacedCount, skipped };
}
