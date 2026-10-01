import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DocWriteResult } from "@abyss/contracts";
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
  let current: string | null = null;
  try {
    current = await readFile(target, "utf8");
  } catch {
    current = null;
  }

  const currentFingerprint = makeFingerprint(current ?? "");
  if (currentFingerprint !== expectedFingerprint)
    return { ok: false, reason: "stale", currentFingerprint };

  let backupRelPath: string | null = null;
  if (current !== null) {
    const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
    backupRelPath = `.abyss/changes/${stamp}/${safe}.bak`;
    const backupTarget = path.join(root, ...backupRelPath.split("/"));
    await mkdir(path.dirname(backupTarget), { recursive: true });
    await writeFile(backupTarget, current, "utf8");
  }

  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return { ok: true, fingerprint: makeFingerprint(content), backupRelPath };
}
