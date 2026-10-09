import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DocWriteResult } from "@mochen/contracts";
import { makeFingerprint } from "./fingerprint.js";
import { defaultAtomicFs, writeFileAtomic, type AtomicWriteFs } from "./atomic-write.js";
import { assertSafeRelPath } from "./paths.js";
import { resolveRetention } from "./retention-defaults.js";
import { listChanges, pruneChanges } from "./changes.js";
import type { ChangeEntry } from "@mochen/contracts";

/** 只取某一篇的备份：`listChanges` 给的是全书，淘汰要按篇算（铁律：同一判定只有一份实现）。 */
async function listChangesForDoc(root: string, docRelPath: string): Promise<ChangeEntry[]> {
  return (await listChanges(root)).filter((entry) => entry.docRelPath === docRelPath);
}

export { resolveRetention };

export async function readDocFile(
  root: string,
  relPath: string
): Promise<{ content: string; fingerprint: string }> {
  const safe = assertSafeRelPath(relPath);
  const content = await readFile(path.join(root, ...safe.split("/")), "utf8");
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
  fs: AtomicWriteFs = defaultAtomicFs
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
  try {
    await writeFileAtomic(target, content, fs);
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

  return { ok: true, fingerprint: makeFingerprint(content), backupRelPath };
}
