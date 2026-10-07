import { mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChangeEntry, DocWriteResult } from "@mochen/contracts";
import { makeFingerprint } from "./fingerprint.js";
import { assertSafeRelPath } from "./paths.js";
import { DEFAULT_CHANGE_RETENTION, resolveRetention } from "./retention-defaults.js";

/**
 * 改稿历史的读回与回滚（2026-10-05）。
 *
 * `writeDocFile` 每次覆盖正文前都会把改前内容存成 `.mochen/changes/<时间戳>/<原路径>.bak`，
 * 并把那条相对路径挂上 `DocWriteResult.backupRelPath` 一路传回渲染层——**但从头到尾没有任何一处
 * 读得回它**。于是「AI 动手改了稿，改坏了怎么办」在产品里没有答案，备份只是一堆躺在盘上的死文件。
 * 这个模块把那条回程补上。
 *
 * 路径安全比「读一篇文稿」严得多，因为**这里要写**：
 * ① 备份路径必须逐字形如 `.mochen/changes/<时间戳>/<文稿路径>.bak`；
 * ② 它的 realpath 必须仍在 `.mochen/changes/` 之下（符号链接可以指向书外）；
 * ③ 恢复的**目标文稿** realpath 必须仍在书根之下——`chapters/01.md` 完全可能是个指向别处的软链，
 *    逐字形状检查看不出来，只有 realpath 看得穿；
 * ④ 回滚走的是与批准同款的指纹闸：盘上这段被人手改过就不许盖。
 */

const CHANGES_DIR = path.join(".mochen", "changes");
/** 同一串的 posix 写法：备份句柄在 IPC 与 UI 上永远用正斜杠，别各处自己 replaceAll 一遍。 */
const CHANGES_POSIX = ".mochen/changes";

export type { ChangeEntry } from "@mochen/contracts";

/** Windows 上 realpath 可能回不同大小写或 8.3 短名（临时目录尤其明显），逐字相等会误伤合法路径。 */
function samePath(a: string, b: string): boolean {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function isUnder(child: string, parent: string): Promise<boolean> {
  try {
    const realParent = await realpath(parent);
    const realChild = await realpath(child);
    const prefix = realParent.endsWith(path.sep) ? realParent : realParent + path.sep;
    return samePath(realChild.slice(0, prefix.length), prefix);
  } catch {
    // 解不出真实路径 = 这一秒读不到它，按 skills 的同款口径当作不可用。
    return false;
  }
}

/** `.mochen/changes/<时间戳>/<文稿路径>.bak` → `{ stamp, docRelPath }`；形状不对一律 null。 */
function parseBackupRelPath(backupRelPath: string): { stamp: string; docRelPath: string } | null {
  const posix = backupRelPath.replaceAll("\\", "/");
  const prefix = `${CHANGES_POSIX}/`;
  if (!posix.startsWith(prefix) || !posix.endsWith(".bak")) return null;
  const rest = posix.slice(prefix.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const stamp = rest.slice(0, slash);
  // 时间戳目录名是 writeDocFile 用 ISO 串替换掉 : 与 . 得到的，形状固定；不认就当不是备份。
  if (!/^\d{4}-\d{2}-\d{2}T[\d-]+Z$/.test(stamp)) return null;
  const docRelPath = rest.slice(slash + 1, -".bak".length);
  if (docRelPath === "") return null;
  try {
    return { stamp, docRelPath: assertSafeRelPath(docRelPath) };
  } catch {
    return null;
  }
}

function backupAbs(root: string, backupRelPath: string): string {
  const parsed = parseBackupRelPath(backupRelPath);
  if (parsed === null)
    throw new Error(`invalid-path: 这不是一条改稿备份的路径，收到 ${backupRelPath}`);
  return path.join(root, CHANGES_DIR, parsed.stamp, ...parsed.docRelPath.split("/")) + ".bak";
}

/** 这次改动会把哪篇文稿盖掉（回滚句柄 → 目标文稿）。 */
export function targetOfBackup(backupRelPath: string): string {
  const parsed = parseBackupRelPath(backupRelPath);
  if (parsed === null)
    throw new Error(`invalid-path: 这不是一条改稿备份的路径，收到 ${backupRelPath}`);
  return parsed.docRelPath;
}

/**
 * 列出这本书的全部改稿历史，最新在前。
 * 只走 `.mochen/changes/` 这一棵目录树：别处的同名文件与本功能无关，不认。
 */
export async function listChanges(root: string): Promise<ChangeEntry[]> {
  const changesRoot = path.join(root, CHANGES_DIR);
  const out: ChangeEntry[] = [];

  const stamps = await readdir(changesRoot, { withFileTypes: true }).catch(() => []);
  for (const stampEntry of stamps) {
    if (!stampEntry.isDirectory()) continue;
    const stampDir = path.join(changesRoot, stampEntry.name);
    if (!/^\d{4}-\d{2}-\d{2}T[\d-]+Z$/.test(stampEntry.name)) continue;

    // 一次改动可能同时改多篇，所以每层还要再往下走一层目录树。
    const walk = async (dir: string, prefix: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        if (entry.isDirectory()) {
          await walk(full, rel);
          continue;
        }
        if (!entry.name.endsWith(".bak")) continue;
        const docRelPath = rel.slice(0, -".bak".length);
        try {
          assertSafeRelPath(docRelPath);
        } catch {
          continue;
        }
        if (!(await isUnder(full, changesRoot))) continue;
        const size = await stat(full).then(
          (s) => s.size,
          () => 0
        );
        out.push({
          stamp: stampEntry.name,
          docRelPath,
          backupRelPath: `${CHANGES_POSIX}/${stampEntry.name}/${rel}`,
          bytes: size
        });
      }
    };
    await walk(stampDir, "");
  }

  out.sort((a, b) =>
    a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : a.docRelPath < b.docRelPath ? -1 : 1
  );
  return out;
}

/** 读一条备份的正文（给回滚前预览用）。解不出形状 / 越界 / 读不到，一律抛错。 */
export async function readChange(
  root: string,
  backupRelPath: string
): Promise<{ content: string; fingerprint: string }> {
  const abs = backupAbs(root, backupRelPath);
  if (!(await isUnder(abs, path.join(root, CHANGES_DIR)))) {
    throw new Error(`outside-book: 备份路径越界 ${backupRelPath}`);
  }
  const content = await readFile(abs, "utf8");
  return { content, fingerprint: makeFingerprint(content) };
}

/**
 * 保留策略：每篇文稿留最近 N 份、总量不超过 M 字节。
 *
 * **为什么必须有**（2026-10-06 真机实测）：备份发生在 `writeDocFile` 的**每一次**写盘上，
 * 而默认自动保存档是停手 2 秒就存。实测在一篇 35 KB 正文上打 8 次字，
 * `.mochen/changes/` 就长出 8 个时间戳目录、8 份整篇备份，面板把「9 次改动」摆给用户。
 * 按一篇 10 万字长篇（约 300 KB）外推，一天 200 次自动保存 ≈ 54 MB，而**全仓原本没有任何淘汰**。
 * 界面上那层 `CHANGE_HISTORY_VISIBLE` 只是**显示**上限，滚出去的东西照样躺在盘上。
 *
 * **为什么按篇算而不是按全书算**：一章被反复改不该把另一章的回滚点一起清掉。
 *
 * **为什么写死在这里而不是做成配置**：这两个数是「回滚还能用」与「盘不会一直涨」之间的取舍点，
 * 改它要连带改面板上写给用户看的那句话（`CHANGE_RETENTION_NOTE`）。要让用户调，得先把
 * 「调到多少算合适」这件事在界面上讲清楚——那是另一批的事，这里先给一个说得出口的默认值。
 */
/**
 * 保留上限的**旧固定值**（2026-10-06 批次 5-⑦ 加的，5-⑧ 改成可配了）。
 *
 * 留着它们是因为**默认值不许变**：`DEFAULT_CHANGE_RETENTION` 仍然是 50 份 / 32 MB，
 * 没设置过的用户行为一字不变。这里只作为默认档的出处被引用，不再是「唯一可用值」。
 * 真身已搬到 `retention-defaults.ts`（fs-store 内部唯一出处）与 contracts（跨进程那一份）。
 */
export const CHANGE_KEEP_PER_DOC = DEFAULT_CHANGE_RETENTION.maxCount;
export const CHANGE_KEEP_BYTES_PER_DOC = DEFAULT_CHANGE_RETENTION.maxBytes;
/**
 * 算出该删哪些备份（纯函数，单测钉守卫）。
 *
 * `entries` 必须**已经是最新在前**（`listChanges` 的序就是）。判定只有这一份：
 * 渲染层那份「只显示 60 条」是显示口径，与这里不是同一件事，别拿它当保留策略。
 *
 * 两条都是「或」的关系——**任一条越线就开始删最旧的**：
 * 短文篇数先越线，长文字节先越线。都不越线时一条都不删。
 * 至少留一份：全删光等于没有回滚可言，那比多占几兆盘更糟。
 */
export function planChangePruning(
  entries: readonly ChangeEntry[],
  keep: { maxCount: number; maxBytes: number }
): ChangeEntry[] {
  const ordered = [...entries]; // 不改调用方的数组
  const drop: ChangeEntry[] = [];
  let keptBytes = 0;
  let keptCount = 0;
  for (const [index, entry] of ordered.entries()) {
    // 最新那条无条件留下：它就是刚刚写盘存下来的那份，删了等于没有回滚可言。
    const isNewest = index === 0;
    const overCount = !isNewest && keptCount >= keep.maxCount;
    const overBytes = !isNewest && keptBytes + entry.bytes > keep.maxBytes;
    if (overCount || overBytes) {
      drop.push(entry);
      continue;
    }
    keptCount += 1;
    keptBytes += entry.bytes;
  }
  return drop;
}

/**
 * 按 `planChangePruning` 的结论删掉多出来的备份，并收拾空掉的时间戳目录。
 *
 * 逐条删、**失败只跳过不抛**：清理是尽力而为，为它把一次成功的保存搞成失败是本末倒置。
 * 但删之前仍要过 `isUnder` 与形状检查——这是**删**盘上文件，判据必须与 `readChange` 一样严
 * （符号链接可以把一条备份句柄指向书外）。
 */
export async function pruneChanges(
  root: string,
  entries: readonly ChangeEntry[],
  keep: { maxCount: number; maxBytes: number }
): Promise<number> {
  const drop = planChangePruning(entries, keep);
  if (drop.length === 0) return 0;
  const changesRoot = path.join(root, CHANGES_DIR);
  const touchedStamps = new Set<string>();
  let removed = 0;
  for (const entry of drop) {
    const parsed = parseBackupRelPath(entry.backupRelPath);
    if (parsed === null) continue;
    const abs = backupAbs(root, entry.backupRelPath);
    if (!(await isUnder(abs, changesRoot))) continue;
    try {
      await rm(abs, { force: true });
      removed += 1;
      touchedStamps.add(entry.stamp);
    } catch {
      // 文件正被占用（Windows 上常见）：这一次留着，下一轮再删。不抛。
    }
  }
  // 顺手收掉空掉的时间戳目录：`.mochen/changes/` 下面全是空壳的话，listChanges 每轮都要白走一遍。
  //
  // **必须递归判空，不能只看 stamp 目录那一层**：备份路径是 `.mochen/changes/<stamp>/<文稿路径>.bak`，
  // 文稿在 `chapters/` 下时中间还有一层 `chapters/`。删掉 `.bak` 之后 stamp 目录里躺着的是
  // `chapters/`，`readdir(stamp).length` 仍是 1 —— 只看一层就会把空壳全留下（真机实测踩到：
  // 删到 50 份时盘上留着 61 个时间戳目录，多出来的 11 个全是空壳）。
  for (const stamp of touchedStamps) {
    const stampDir = path.join(changesRoot, stamp);
    try {
      if (await treeHasNoFiles(stampDir)) await rm(stampDir, { recursive: true, force: true });
    } catch {
      // 别的进程正在写同一个时间戳目录（同一毫秒里两次保存）：留着，下一轮再收。
    }
  }
  return removed;
}

/** 这棵目录树底下还有没有任何文件。目录本身不在不算数——空壳就是「只剩目录」。 */
async function treeHasNoFiles(dir: string): Promise<boolean> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) return false;
    if (!(await treeHasNoFiles(path.join(dir, entry.name)))) return false;
  }
  return true;
}

/**
 * 按当前上限把**整本书**清理一遍，返回真删掉多少（2026-10-06 批次 5-⑧，给设置页那个
 * 「立即清理」按钮用）。
 *
 * **按篇分别算，不按全书合计算**——与自动淘汰是同一条口径（`planChangePruning` 吃的是
 * 单篇的表）。一章被反复改不该把另一章的回滚点一起清掉，这件事在两个入口上必须一样，
 * 所以这里只是把全表按 `docRelPath` 分组后逐篇调同一个 `pruneChanges`，没有第二份判定。
 *
 * 逐篇删、失败只跳过：清理是尽力而为，为它把整次操作搞成失败是本末倒置。
 */
export async function pruneAllChanges(
  root: string,
  keep: { maxCount: number; maxBytes: number }
): Promise<ChangePruneReportShape> {
  const before = await listChanges(root);
  let removed = 0;
  let freedBytes = 0;
  const byDoc = new Map<string, ChangeEntry[]>();
  for (const entry of before) {
    const list = byDoc.get(entry.docRelPath);
    if (list === undefined) byDoc.set(entry.docRelPath, [entry]);
    else list.push(entry);
  }
  for (const entries of byDoc.values()) {
    // 删之前先把这几条的体积加起来：pruneChanges 只回条数，腾出多少要自己算。
    const bytesOf = (list: ChangeEntry[]): number =>
      list.reduce((sum, entry) => sum + entry.bytes, 0);
    const dropped = planChangePruning(entries, keep);
    removed += await pruneChanges(root, entries, keep);
    freedBytes += bytesOf(dropped);
  }
  const after = await listChanges(root);
  return {
    removed,
    kept: after.length,
    freedBytes,
    keptBytes: after.reduce((sum, entry) => sum + entry.bytes, 0)
  };
}

/** 与 contracts 的 `ChangePruneReport` 同形；fs-store 不能反向依赖 contracts 的运行时代码，
 *  但这份是纯数据形状，两边字段名必须一致（由接线测试对着钉）。 */
export interface ChangePruneReportShape {
  removed: number;
  kept: number;
  freedBytes: number;
  keptBytes: number;
}

/**
 * 把一篇文稿回滚到某条备份的内容。
 *
 * 走的是与批准同款的指纹闸：盘上这段的当前指纹必须等于调用方读到的那个，
 * 否则说明这之后还有人改过（含 AI 又写了一次），直接拒绝——回滚不是「盖掉别人」。
 * 覆盖之前照旧先给**当前**内容再存一份备份，于是回滚本身也可回滚。
 */
export async function restoreChange(
  root: string,
  backupRelPath: string,
  expectedFingerprint: string,
  /** 与 `writeDocFile` 同款的可选上限；不传用默认档（50 份 / 32 MB）。 */
  retention?: { maxCount?: unknown; maxBytes?: unknown } | null
): Promise<DocWriteResult & { restoredFrom: string }> {
  const abs = backupAbs(root, backupRelPath);
  if (!(await isUnder(abs, path.join(root, CHANGES_DIR)))) {
    throw new Error(`outside-book: 备份路径越界 ${backupRelPath}`);
  }
  const docRelPath = targetOfBackup(backupRelPath);
  const target = path.join(root, ...docRelPath.split("/"));

  const current = await readFile(target, "utf8").catch(() => null);
  // 顺序要紧：**先问「它在不在」再问「它指向哪」**。文件不在时 realpath 解不出来，
  // isUnder 会一律回 false，于是「这一篇被删了」会被误报成「越界」——两件完全不同的事。
  if (current === null) {
    return {
      ok: false,
      reason: "io-error",
      message: `${docRelPath} 现在不在盘上（已经被删了？），没有回滚任何东西。`,
      restoredFrom: backupRelPath
    };
  }
  // 目标文稿的 realpath 也要在书根之下：chapters/01.md 可能是个指向书外的软链。
  if (!(await isUnder(target, root))) {
    throw new Error(`outside-book: 目标文稿越界 ${docRelPath}`);
  }

  const backupContent = await readFile(abs, "utf8");
  if (makeFingerprint(current) !== expectedFingerprint) {
    return {
      ok: false,
      reason: "stale",
      currentFingerprint: makeFingerprint(current),
      restoredFrom: backupRelPath
    };
  }

  // 回滚本身也要留退路：先给当前内容再存一份，用户「撤销撤销」还能回来。
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const undoRelPath = `${CHANGES_POSIX}/${stamp}/${docRelPath}.bak`;
  const undoAbs = path.join(root, CHANGES_DIR, stamp, ...docRelPath.split("/")) + ".bak";
  await mkdir(path.dirname(undoAbs), { recursive: true });
  await writeFile(undoAbs, current, "utf8");

  await writeFile(target, backupContent, "utf8");
  // 回滚自己也占一份备份，所以这里同样要收口——否则「回滚 → 攒出一堆回滚」是一条绕过上限的路。
  // 失败不外抛：正文已经换回去了，为一次清理失败把回滚判成失败是本末倒置。
  try {
    await pruneChanges(
      root,
      (await listChanges(root)).filter((e) => e.docRelPath === docRelPath),
      resolveRetention(retention)
    );
  } catch {
    // 读不到目录就这一轮不收，下一次再试。
  }
  return {
    ok: true,
    fingerprint: makeFingerprint(backupContent),
    backupRelPath: undoRelPath,
    restoredFrom: backupRelPath
  };
}
