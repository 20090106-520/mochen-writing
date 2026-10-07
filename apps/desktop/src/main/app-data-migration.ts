import path from "node:path";
import type { Cipher } from "./credential-store.js";

/**
 * F-4 · 设置目录迁移（Plan 3 spec §12）：`mochen-writing` → `mochen-ai`。
 *
 * 为什么不是改一行目录名就完事：旧目录里躺着 `secrets.enc`，内容是 Electron `safeStorage`
 * （Windows DPAPI）的密文。搬完解不开 = 用户的 API Key 没了，而那串东西**无法重建**
 * （拿不回明文）。所以这里定的顺序是硬的：**先拷 → 验密 → 才改名**，
 * 而且旧目录永远只改名、不删除——本文件里没有、也不会有删除旧目录的码路。
 *
 * 全部依赖注入（fs 与 cipher 都从外面递进来），所以这套流程能在 node 里逐条测，
 * 不必真的起 Electron，也不必真的有 safeStorage。
 */

/** 只搬这三个。旧目录里用户自己塞的东西不搬——来历不明的字节不该被搬到会被读取的位置。 */
export const MIGRATED_FILES = ["config.json", "secrets.enc", "appearance.json"] as const;

export interface AppDataMigrationDeps {
  oldDir: string;
  newDir: string;
  copyFile(src: string, dest: string): Promise<void>;
  readFile(path: string): Promise<string>;
  readdir(path: string): Promise<string[]>;
  rename(oldPath: string, newPath: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  cipher: Cipher;
  /** 改名后缀里的日期来源；默认取当下。注入是为了让断言不依赖「今天是哪天」。 */
  now?: Date;
}

export type AppDataMigrationReport =
  | { status: "nothing-to-do" }
  | { status: "migrated"; movedFiles: string[]; keptOldDir: string }
  /** 永不返回「已删除」——本文件没有删除旧目录的码路，这是刻意的。 */
  | { status: "kept-old"; reason: string };

function stamp(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function timeStamp(date: Date): string {
  return date.toISOString().slice(11, 19).replaceAll(":", "");
}

export async function migrateLegacyAppData(
  deps: AppDataMigrationDeps
): Promise<AppDataMigrationReport> {
  const now = deps.now ?? new Date();
  // ① 旧目录不存在 ⇒ 什么都不做。新装用户与已迁移过的用户都走这一条。
  let entries: string[];
  try {
    entries = await deps.readdir(deps.oldDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "nothing-to-do" };
    return { status: "kept-old", reason: `旧目录读不到：${(error as Error).message}` };
  }
  const present = MIGRATED_FILES.filter((name) => entries.includes(name));
  if (present.length === 0) return { status: "nothing-to-do" };

  // ② 只搬已知的几个，存在才搬。搬之前先建新目录。
  await deps.mkdir(deps.newDir);
  const movedFiles: string[] = [];
  for (const name of present) {
    try {
      await deps.copyFile(path.join(deps.oldDir, name), path.join(deps.newDir, name));
      movedFiles.push(name);
    } catch (error) {
      return { status: "kept-old", reason: `${name} 没有搬过去：${(error as Error).message}` };
    }
  }

  // ③ 验密：读**新目录**那份，能解出非空串才算数。
  //    safeStorage 不可用 / 解不开 / 解出空串，都停在原地（kept-old）。
  if (present.includes("secrets.enc")) {
    if (!deps.cipher.available) {
      return { status: "kept-old", reason: "密钥保管当前不可用，已保持原目录，未做任何改名。" };
    }
    let plain: string;
    try {
      plain = await deps.cipher.decrypt(await deps.readFile(path.join(deps.newDir, "secrets.enc")));
    } catch (error) {
      return {
        status: "kept-old",
        reason: `旧目录里的密钥在新目录中解不开（${(error as Error).message}），已保持原目录，未做任何改名。`
      };
    }
    if (plain === "") {
      return {
        status: "kept-old",
        reason: "旧目录里的密钥解出来是空的，已保持原目录，未做任何改名。"
      };
    }
  }

  // ④ 只有验密过了才把旧目录改名。同名已占用就补时分秒再试一次；两次都不成 ⇒ kept-old，
  //    绝不报「已迁到」——那个名字还指着旧目录时这么说就是骗人。
  const base = `${deps.oldDir}.migrated-${stamp(now)}`;
  for (const target of [base, `${base}-${timeStamp(now)}`]) {
    try {
      await deps.rename(deps.oldDir, target);
      return { status: "migrated", movedFiles, keptOldDir: target };
    } catch {
      // 目标已占用：换带时分秒的那个再试一次。两次都失败就走下面那句 kept-old。
    }
  }
  return {
    status: "kept-old",
    reason: "旧目录改不了名（目标已占用），设置已拷到新目录，但应用仍在使用旧目录。"
  };
}

/** 迁移结果的中文播报（spec §12：不加 IPC 通道，直接用 dialog.showMessageBox）。 */
export function migrationNotice(
  report: AppDataMigrationReport,
  newDir: string
): { type: "info" | "warning"; text: string } | null {
  if (report.status === "nothing-to-do") return null;
  if (report.status === "migrated") {
    return {
      type: "info",
      text:
        `墨宸 AI 的设置目录已迁到 ${newDir}；旧目录已保留为 ${report.keptOldDir}，` +
        `确认无误后可自行删除。`
    };
  }
  return {
    type: "warning",
    text: `设置目录迁移没有进行（${report.reason}），应用仍在使用旧目录。`
  };
}
