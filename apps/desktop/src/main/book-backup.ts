import path from "node:path";
import {
  IPC_CHANNELS,
  type BookBackupCreateResult,
  type BookBackupEntry,
  type BookBackupListResult,
  type BookBackupRestoreResult
} from "@mochen/contracts";
import type { IpcRegistrar } from "./ipc-guard.js";
import { handleTrusted } from "./ipc-guard.js";
import { isWriteScratchName } from "@mochen/fs-store";

/**
 * 整书备份（2026-10-10）。真相是**复制**：把整本书（`.mochen/` 除外）复制一份到
 * `<书>/.mochen/backups/book-<时间戳>/`。
 *
 * 【为什么不是 zip】EPUB 那份 zip.ts 是「内部名全 ASCII、条目全是文本」的专用实现，
 * 它的注释把「不做 Unicode 文件名标志位」钉成刻意的——书里的目录名是中文
 * （`chapters/第一章.md`），拿它打包就要往那个模块里加 UTF-8 标志位与二进制条目，
 * 「EPUB 专用」就名存实亡。而普通目录 Explorer 直开直拷、还原零工具，
 * 防丢稿需要的只是「另一份放在别的抽屉里」，压缩收益（纯文本 md 本来就小）不值那个险。
 *
 * 【为什么放 `.mochen/`】与回收站同一口径：运行时目录，扫描器不进，
 * 备份里不叠备份（复制时 `.mochen` 整个跳过——递归备份是事故）。
 *
 * 每日自动一份的判定也在这里：`daily` 档发现今天的备份已存在就**什么都不做**，
 * 由渲染层在开书那刻调一次——一天一份的上限来自「开书才触发」，
 * 不需要常驻定时器（应用没开的那天本来也不可能有新字）。
 */

/** 备份落在书内的哪一格（单一真身：主进程写、测试钉）。 */
export function backupDirOf(root: string): string {
  return path.join(root, ".mochen", "backups");
}

/** 备份目录名形状：`book-<yyyy-MM-dd-HH-mm-ss>`。还原/清理只认这一份正则。 */
export const BACKUP_NAME_RE = /^book-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/;

/** 从备份目录名解出人话时间（`2026-10-10 19:52:30`）；不合形状的返回空串。 */
export function backupCreatedAtLabel(name: string): string {
  const match = BACKUP_NAME_RE.exec(name);
  if (match === null) return "";
  const body = name.slice("book-".length);
  return `${body.slice(0, 10)} ${body.slice(11).replaceAll("-", ":")}`;
}

/** 备份目录名里「哪一天」的部分（daily 去重键）。 */
function dayOf(name: string): string {
  return name.slice("book-".length, "book-".length + "yyyy-MM-dd".length);
}

/** 默认保留份数：20 份。一天一份能回看三周，一份纯文本书也就几 MB。 */
export const BACKUP_RETAIN_DEFAULT = 20;

/** 备份需要的窄 fs 面：真实现绑 node:fs/promises，测试注入内存件。 */
export interface BackupFs {
  mkdir(dir: string, opts: { recursive: true }): Promise<void>;
  readdir(dir: string): Promise<string[]>;
  readFile(p: string): Promise<Uint8Array>;
  writeFile(p: string, data: Uint8Array): Promise<void>;
  rm(p: string, opts: { recursive: true; force: true }): Promise<void>;
  exists(p: string): Promise<boolean>;
}

export const backupFs: BackupFs = {
  mkdir: (dir, opts) =>
    import("node:fs/promises").then((fs) => fs.mkdir(dir, opts).then(() => undefined)),
  readdir: (dir) => import("node:fs/promises").then((fs) => fs.readdir(dir)),
  readFile: (p) => import("node:fs/promises").then((fs) => fs.readFile(p)),
  writeFile: (p, data) =>
    import("node:fs/promises").then((fs) => fs.writeFile(p, data).then(() => undefined)),
  rm: (p, opts) => import("node:fs/promises").then((fs) => fs.rm(p, opts).then(() => undefined)),
  exists: (p) =>
    import("node:fs/promises").then(async (fs) => {
      try {
        await fs.access(p);
        return true;
      } catch {
        return false;
      }
    })
};

export interface BookBackupServiceDeps {
  /** 现取当前书根；没开书回 null（每次现取，换书后旧句柄自动失效）。 */
  bookRoot(): string | null;
  fs?: BackupFs;
  now?: () => Date;
  retain?: number;
}

export interface BookBackupService {
  create(mode: "manual" | "daily"): Promise<BookBackupCreateResult>;
  list(): Promise<BookBackupListResult>;
  restore(name: unknown): Promise<BookBackupRestoreResult>;
}

/** 单文件复制返回拷过的文件数；目录递归。`skipTop` 是顶层要整个跳过的目录名。 */
async function copyTree(
  fs: BackupFs,
  src: string,
  dest: string,
  skipTop: string | null
): Promise<number> {
  const names = await fs.readdir(src);
  let count = 0;
  for (const name of names) {
    if (skipTop !== null && name === skipTop) continue;
    // 原子写留下的半成品不是书稿：抄进备份就是一份「看起来有备份」的假象，还会把
    // fileCount 算歪（对话框那行「已备份 N 个文件」就靠它）。形状的真身在 fs-store
    // 生产临时件名的那一处，这里不自己再写一遍（2026-10-11 真机：备份里躺过
    // `chapters/01.md.mochen-tmp-9e4a8d8c`，见 .mochen-tmp/p545/backup-count.mjs）。
    // 还原走的是同一个 copyTree ⇒ 旧备份里已有的半成品也不会被放生到书旁的新目录。
    if (isWriteScratchName(name)) continue;
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const children = await fs.readdir(from).then(
      () => true,
      () => false
    );
    if (children) {
      await fs.mkdir(to, { recursive: true });
      count += await copyTree(fs, from, to, null);
    } else {
      await fs.writeFile(to, await fs.readFile(from));
      count += 1;
    }
  }
  return count;
}

/** 时间戳 → 备份目录名（`book-2026-10-10-19-52-30`）。 */
export function backupNameFor(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `book-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(
    date.getHours()
  )}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

export function createBookBackupService(deps: BookBackupServiceDeps): BookBackupService {
  const fs = deps.fs ?? backupFs;
  const now = deps.now ?? (() => new Date());
  const retain = deps.retain ?? BACKUP_RETAIN_DEFAULT;

  const ioError = (what: string, error: unknown): string => {
    const message = error instanceof Error ? error.message : String(error);
    return `${what}失败：${message}`;
  };

  /** 列出（并按名字降序）现存的备份名；目录不存在 = 还没备过。 */
  async function listNames(root: string): Promise<string[]> {
    const names = await fs.readdir(backupDirOf(root)).catch((): string[] => []);
    return names.filter((name) => BACKUP_NAME_RE.test(name)).sort((a, b) => (a < b ? 1 : -1));
  }

  return {
    async create(mode): Promise<BookBackupCreateResult> {
      const root = deps.bookRoot();
      if (root === null) {
        return {
          ok: false,
          reason: "no-book",
          message: "还没打开作品——备份跟着当前这本书走。"
        };
      }
      let names: string[];
      try {
        names = await listNames(root);
      } catch (error) {
        return { ok: false, reason: "io-error", message: ioError("读备份目录", error) };
      }
      if (mode === "daily" && names.some((name) => dayOf(name) === dayOf(backupNameFor(now())))) {
        return { ok: true, name: null, fileCount: 0 };
      }
      const name = backupNameFor(now());
      const dest = path.join(backupDirOf(root), name);
      try {
        await fs.mkdir(dest, { recursive: true });
        const fileCount = await copyTree(fs, root, dest, ".mochen");
        // 超限清旧：只动自己命名的目录，别人放进 backups 的东西一根手指都不碰。
        for (const stale of names.slice(retain - 1)) {
          await fs.rm(path.join(backupDirOf(root), stale), { recursive: true, force: true });
        }
        return { ok: true, name, fileCount };
      } catch (error) {
        // 半途失败的备份目录拆掉：留着一份缺胳膊少腿的「备份」比没有更危险。
        await fs.rm(dest, { recursive: true, force: true }).catch(() => undefined);
        return { ok: false, reason: "io-error", message: ioError("整书备份", error) };
      }
    },

    async list(): Promise<BookBackupListResult> {
      const root = deps.bookRoot();
      if (root === null) {
        return {
          ok: false,
          reason: "no-book",
          message: "还没打开作品——备份跟着当前这本书走。"
        };
      }
      try {
        const entries: BookBackupEntry[] = (await listNames(root)).map((name) => ({
          name,
          createdAt: backupCreatedAtLabel(name)
        }));
        return { ok: true, entries };
      } catch (error) {
        return { ok: false, reason: "io-error", message: ioError("读备份目录", error) };
      }
    },

    async restore(name: unknown): Promise<BookBackupRestoreResult> {
      const root = deps.bookRoot();
      if (root === null) {
        return {
          ok: false,
          reason: "no-book",
          message: "还没打开作品——还原跟着当前这本书走。"
        };
      }
      if (typeof name !== "string" || BACKUP_NAME_RE.test(name) === false) {
        return { ok: false, reason: "not-found", message: "认不出这份备份。" };
      }
      const src = path.join(backupDirOf(root), name);
      if (!(await fs.exists(src))) {
        return { ok: false, reason: "not-found", message: `备份里没有这一份：${name}` };
      }
      // 落点在书的**旁边**（同父目录），不在书里：恢复出来的东西混进正扫描的书树才是事故。
      // 目标已存在就顺位加号，绝不盖写任何已有内容。
      const base = path.basename(root);
      let destDir = path.join(path.dirname(root), `${base}-恢复自备份-${name.slice(5)}`);
      for (let n = 2; await fs.exists(destDir); n += 1) {
        destDir = path.join(path.dirname(root), `${base}-恢复自备份-${name.slice(5)}-${n}`);
      }
      try {
        await fs.mkdir(destDir, { recursive: true });
        await copyTree(fs, src, destDir, null);
      } catch (error) {
        return { ok: false, reason: "io-error", message: ioError("恢复备份", error) };
      }
      return { ok: true, destName: path.basename(destDir) };
    }
  };
}

/** 整书备份三条 IPC 的注册点（与 doc-trash 同款：来源与形状判定只在 ipc-guard 那一份）。 */
export function registerBookBackupIpc(register: IpcRegistrar, service: BookBackupService): void {
  handleTrusted(register, IPC_CHANNELS.bookBackupCreate, (_event, mode) =>
    service.create(mode === "daily" ? "daily" : "manual")
  );
  handleTrusted(register, IPC_CHANNELS.bookBackupList, () => service.list());
  handleTrusted(register, IPC_CHANNELS.bookBackupRestore, (_event, name) => service.restore(name));
}
