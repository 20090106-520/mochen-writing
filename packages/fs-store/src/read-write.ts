import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DocWriteResult } from "@mochen/contracts";
import { makeFingerprint } from "./fingerprint.js";
import { defaultAtomicFs, writeFileAtomic, type AtomicWriteFs } from "./atomic-write.js";
import { assertSafeRelPath, isPathUnderRoot, realPath, type LinkResolver } from "./paths.js";
import { normalizeWriteKey, runWriteExclusive } from "./write-queue.js";
import { resolveRetention } from "./retention-defaults.js";
import { listChanges, pruneChanges } from "./changes.js";
import type { ChangeEntry } from "@mochen/contracts";

/** 只取某一篇的备份：`listChanges` 给的是全书，淘汰要按篇算（铁律：同一判定只有一份实现）。 */
async function listChangesForDoc(root: string, docRelPath: string): Promise<ChangeEntry[]> {
  return (await listChanges(root)).filter((entry) => entry.docRelPath === docRelPath);
}

export { resolveRetention };

/**
 * 一篇稿子在盘上用的行尾（2026-10-10 扫描总单 P2-3）。
 * 判据只住这一处：`writeDocFile` 用它决定「写出去的那份字节长什么样」，
 * 备份 / 改稿历史 / 回滚用的都是盘上原文，不需要第二份口径。
 */
export type DocLineEnding = "crlf" | "lf" | "cr";

/**
 * **以第一个行结束符为准**：纯 LF 判成 lf、纯 CRLF 判成 crlf，这是本体要保的那两种。
 *
 * 混合行尾（现实里真会混：外部编辑器补过几行、从别处粘进来）没有一个「正确答案」，
 * 但必须有一个**确定**答案，否则同一篇稿子每次保存的行尾都在飘。取第一个结束符，
 * 理由是它与人打开这个文件时看到的第一眼一致。
 *
 * 整篇没有换行（空文件或单行文件）＝没有任何证据 ⇒ 按 lf 走新稿的口径，
 * 绝不无中生有加 `\r`。老的单 `\r`（经典 Mac）也认下来，理由同上：能保住就保住。
 */
export function detectLineEnding(text: string): DocLineEnding {
  const cr = text.indexOf("\r");
  const lf = text.indexOf("\n");
  if (cr === -1 && lf === -1) return "lf";
  if (cr === -1 || (lf !== -1 && lf < cr)) return "lf";
  return text.charAt(cr + 1) === "\n" ? "crlf" : "cr";
}

/**
 * 把正文换成指定行尾：先归一成 LF（渲染层的 `<textarea>` 交出来的本来就已经是 LF，
 * 见 HTML 规范的 value sanitization），再整篇换成目标那一种。
 * 先归一再换是关键：直接把 `\n` 换成 `\r\n` 会在原文已有 `\r\n` 时叠成 `\r\r\n`。
 */
export function applyLineEnding(text: string, ending: DocLineEnding): string {
  const unified = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (ending === "lf") return unified;
  return unified.replaceAll("\n", ending === "crlf" ? "\r\n" : "\r");
}

export async function readDocFile(
  root: string,
  relPath: string,
  /** 边界判定的真实路径解法；默认 `fs.realpath`，测试注入「解到书外」来造软链那一档。 */
  resolve?: LinkResolver
): Promise<{ content: string; fingerprint: string }> {
  const safe = assertSafeRelPath(relPath);
  const target = path.join(root, ...safe.split("/"));
  // 写法合法不代表人在书里：`chapters/01.md` 可以是个指向 `~/.ssh/id_ed25519` 的软链。
  // 这道闸原来只有改稿历史那条路有（`changes.ts`），读正文与写正文都没有（P2-2）。
  if (!(await isPathUnderRoot(target, root, resolve ?? realPath)))
    throw new Error(`outside-book: 这一篇的真实位置不在书目录内 ${relPath}`);
  const content = await readFile(target, "utf8");
  // 原样交回盘上那段字节（含它自己的行尾），指纹也算这份——P2-3 的「以盘上那一篇的行尾为准」
  // 靠的就是这里不做任何归一；渲染层 textarea 会把它抹成 LF，写回时由 writeDocFile 换回去。
  return { content, fingerprint: makeFingerprint(content) };
}

export async function writeDocFile(
  root: string,
  relPath: string,
  content: string,
  expectedFingerprint: string,
  /**
   * 这次留完备份后按什么上限收口（2026-10-06 批次 5-⑧）。
   *
   * **可选参数是刻意的**：不传就用默认档（50 份 / 32 MB），于是所有既有调用方与既有测试
   * 行为一字不变；`book-service` 把用户设置的那份传进来。
   * 坏值由 `resolveRetention` 退回默认档——返回 0 会让淘汰判定「全删光」，
   * 那等于把用户的历史一次清空，比配置坏掉严重得多。
   */
  retention?: { maxCount?: unknown; maxBytes?: unknown } | null,
  /**
   * 原子写的 fs 缝（2026-10-09 全仓扫描 P0-1）。默认走真文件系统，测试注入「只坏一步」的实现
   * 来证明失败时盘上仍是完整旧稿——见 `atomic-write.ts` 与 `test/atomic-write-fixture.ts`。
   */
  fs: AtomicWriteFs = defaultAtomicFs,
  /**
   * 位置闸的真实路径解法缝（P2-2）。默认 `fs.realpath`；本机是非开发者模式，`fs.symlink` 直接 EPERM，
   * 造不出真软链，所以测试注入「把这一篇解到书外」来实现软链那一档（口径同上面的 fs 缝）。
   */
  resolve?: LinkResolver
): Promise<DocWriteResult> {
  let safe: string;
  try {
    safe = assertSafeRelPath(relPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: message.startsWith("outside-book") ? "outside-book" : "invalid-path",
      message
    };
  }

  const target = path.join(root, ...safe.split("/"));
  // 同一文稿的并发写串行（2026-10-10 扫描总单 P1-6）：自动保存 / Ctrl+S / Agent 批准写盘三路
  // 都能并发进到这里，而下面「读盘 → 指纹闸 → 备份 → 原子写 → 淘汰」每步之间有 await 间隙。
  // 队列按**规范化目标路径**分 key：同路径一次做完，不同路径照旧并发——
  // 全局串行会把 1000 章的批量写拖死。返回契约不变：调用方只觉得自己慢了一点，结果仍是自己这一次的。
  return runWriteExclusive(normalizeWriteKey(target), () =>
    writeDocFileQueued(root, safe, target, content, expectedFingerprint, retention, fs, resolve)
  );
}

/** `writeDocFile` 的 critical section：只从队列里调用，运行期间同路径不会有另一笔写插进来。 */
async function writeDocFileQueued(
  root: string,
  safe: string,
  target: string,
  content: string,
  expectedFingerprint: string,
  retention: { maxCount?: unknown; maxBytes?: unknown } | null | undefined,
  fs: AtomicWriteFs,
  resolve?: LinkResolver
): Promise<DocWriteResult> {
  // 落盘前最后一道位置闸：路径写法合法（`assertSafeRelPath` 已经过了）不等于真实位置在书里，
  // `chapters/01.md` 完全可能是个指向书外的软链——顺着它写，盖掉的是书外面那个文件（P2-2）。
  // 放在队列**里面**：锁外判完再排队，等的这段时间里链接可能被换掉。
  if (!(await isPathUnderRoot(target, root, resolve ?? realPath)))
    return {
      ok: false,
      reason: "outside-book",
      message: `这一篇的真实位置不在书目录内，没有落盘：${safe}`
    };
  // 只有 ENOENT 才是「这份稿子还没写过」；EBUSY/EACCES/EISDIR 说「这一秒读不到」。
  // 把后者当成前者会跳过备份直接盖写，用户没备份的正文就没了——所以只窄化到 ENOENT，其余如实报 io。
  let current: string | null;
  try {
    current = await readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      return {
        ok: false,
        reason: "io-error",
        message:
          `读 ${safe} 失败（${error instanceof Error ? error.message : String(error)}），` +
          "没有覆盖任何内容。"
      };
    current = null;
  }

  const currentFingerprint = makeFingerprint(current ?? "");
  // 【P2-3：行尾跟着盘上那一篇走】渲染层的编辑器是 `<textarea :value>`，浏览器赋值时把 `\r\n`
  // 归一成 `\n`，于是「改一个字按保存」交回来的正文**整篇行尾都换了**：盘上 diff 变成整篇重写，
  // 而所有在途提案存的期望指纹是改前那段字节——一并变 stale，用户看到的是
  // 「我明明只改了一句，为什么所有提案都过期了」。
  // 修法：以**盘上这一篇**的行尾为准，把正文换成同一种再落盘。
  // 关键在后面那三处 `body`：备份存的是盘上原文 `current`（逐字），而**指纹必须对将要落盘的
  // 那份字节算**——拿 `content` 算就会自撞（回报的指纹与盘上那段不是同一串，下一笔保存立刻 stale）。
  const body = applyLineEnding(content, detectLineEnding(current ?? ""));
  // 幂等短路（P1-6 的另一半）：盘上内容与将要写入的内容一字不差 ⇒ 内容未变，不备份、不落盘，直接报成功。
  // 消掉的是「连点两次 Ctrl+S 自撞出的假冲突」：第二单排在第一单后面进场时，onDisk 已是第一单刚落盘的
  // 新稿，而它带的 expectedFingerprint 还是旧指纹——原样走下面的指纹闸会报出一个并不存在的冲突，
  // 逼用户手动处置。这一单本来什么都不写，也就没有什么可冲突的。
  // 比较的对象换成 `body`：于是「只打开没编辑就自动保存」这一档也落在这里——行尾被 textarea
  // 抹平过的正文，换回原行尾就是原文，盘上一个字节都不动、也不留一份假备份。
  // 放在指纹闸**之前**是有意的：哪怕这份相同内容来自外部改动，覆写它也是零变化的 no-op，不丢任何东西。
  if (current !== null && current === body)
    return { ok: true, fingerprint: currentFingerprint, backupRelPath: null };
  if (currentFingerprint !== expectedFingerprint)
    return { ok: false, reason: "stale", currentFingerprint };

  let backupRelPath: string | null = null;
  if (current !== null) {
    const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
    backupRelPath = `.mochen/changes/${stamp}/${safe}.bak`;
    const backupTarget = path.join(root, ...backupRelPath.split("/"));
    // 备份也必须原子写：半途而废的 .bak 比没有 .bak 更坏——回滚时会拿半截覆盖完好正文（P2-1）。
    try {
      await writeFileAtomic(backupTarget, current, fs);
    } catch (error) {
      return {
        ok: false,
        reason: "io-error",
        message:
          `存备份失败（${error instanceof Error ? error.message : String(error)}），` +
          "正文一个字都没动，这次保存没有落盘。"
      };
    }
  }

  // 顺序是「备份 → 写正文 → 淘汰」：正文没写成就不该按篇收口，否则淘汰掉的是唯一那份旧备份。
  // 写的是 `body`（换成这一篇原有行尾之后的那份正文）——盘上落的就是它，下面的指纹也算的它。
  try {
    await writeFileAtomic(target, body, fs);
  } catch (error) {
    // 原子写失败 ⇒ 盘上要么还是旧稿、要么还是那份刚存好的备份，**不存在半截正文**。
    // 这里如实报 io-error 而不是把错抛出去：调用方（主进程 book-service、渲染层保存路径）拿到的
    // 仍是统一的 DocWriteResult，界面上才摆得出那句理由。
    return {
      ok: false,
      reason: "io-error",
      message:
        `写 ${safe} 失败（${error instanceof Error ? error.message : String(error)}），` +
        "旧稿保持原样，没有写成半截。"
    };
  }

  if (backupRelPath !== null) {
    // 留完这一份就按篇收口（2026-10-06）：默认 2 秒自动保存档下，每一次停手都存一份整篇，
    // 而这块地方原本**没有任何淘汰**——一天 200 次就是 54 MB。判定在 changes.planChangePruning，
    // 与 `restoreChange` 那条路共用同一份，不在这里另写一套条数。
    // 失败不外抛：正文已经落盘了，为一次清理失败把这次保存判成失败是本末倒置（prune 内部也自己吞）。
    try {
      await pruneChanges(root, await listChangesForDoc(root, safe), resolveRetention(retention));
    } catch {
      // 读不到目录（权限、并发删）就这一轮不收，下一次保存再试。
    }
  }

  // 指纹算的是 `body`——也就是**即将落在盘上的那段字节**（`readDocFile` 读回来的同样是它）。
  // 这一句是 P2-3 最容易做错的地方：拿调用方递来的 `content` 算，回报的指纹与盘上内容就对不上，
  // 下一笔保存（以及在途提案的期望指纹）会立刻自撞成 stale。
  return { ok: true, fingerprint: makeFingerprint(body), backupRelPath };
}
