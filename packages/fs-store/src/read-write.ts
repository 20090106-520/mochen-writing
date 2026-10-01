import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DocWriteResult } from "@mochen/contracts";
import { makeFingerprint } from "./fingerprint.js";
import { assertSafeRelPath } from "./paths.js";

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
  expectedFingerprint: string
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
    await mkdir(path.dirname(backupTarget), { recursive: true });
    await writeFile(backupTarget, current, "utf8");
  }

  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return { ok: true, fingerprint: makeFingerprint(content), backupRelPath };
}
