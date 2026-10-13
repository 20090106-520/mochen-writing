import path from "node:path";
import {
  IPC_CHANNELS,
  type DocTrashResult,
  type TrashEntry,
  type TrashListResult,
  type TrashRestoreResult
} from "@mochen/contracts";
import { assertSafeRelPath } from "@mochen/fs-store";
import type { IpcRegistrar } from "./ipc-guard.js";
import { handleTrusted, relPathStaysInsideRoot } from "./ipc-guard.js";

/**
 * 书稿回收站（2026-10-10）。文稿「删除」的真相是**移动**：
 * 正文从 `书/<目录>/x.md` 搬进 `<书>/.mochen/trash/<id>.md`，旁边留一份 `<id>.json`
 * 记着原路径、标题与时间——还原就是按那份小抄搬回去。所以树行菜单上的「移入回收站」
 * 不需要确认弹窗：东西没消失，只是换了个抽屉。
 *
 * 为什么放 `.mochen/`：那里本来就是本书的运行时目录（book.json 备份、会话、技能），
 * 扫描器不进、git 默认忽略——回收站混进用户自己整理的目录树才是事故。
 *
 * 与 `changes:restore`（改稿历史回滚）的分工：那条管「一篇的**内容**回到过去」，
 * 这条管「整篇从回收站搬回树上」——两条不共用任何判定，谁也不替谁背书。
 */

/** 回收站落在书内的哪一格（单一真身：主进程写、测试钉）。 */
export function trashDirOf(root: string): string {
  return path.join(root, ".mochen", "trash");
}

/** id 形状：本模块自己生成的 `[A-Za-z0-9_-]+`。带路径分隔符或 `..` 的一律不是。 */
export function isTrashName(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);
}

/** 回收站需要的窄 fs 面：真实现绑 node:fs/promises，测试注入内存件。 */
export interface TrashFs {
  mkdir(dir: string, opts: { recursive: true }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  readdir(dir: string): Promise<string[]>;
  readFile(p: string, encoding: "utf8"): Promise<string>;
  writeFile(p: string, data: string, encoding: "utf8"): Promise<void>;
  rm(p: string, opts: { force: true }): Promise<void>;
  exists(p: string): Promise<boolean>;
}

export const trashFs: TrashFs = {
  mkdir: (dir, opts) =>
    import("node:fs/promises").then((fs) => fs.mkdir(dir, opts).then(() => undefined)),
  rename: (from, to) =>
    import("node:fs/promises").then((fs) => fs.rename(from, to).then(() => undefined)),
  readdir: (dir) => import("node:fs/promises").then((fs) => fs.readdir(dir)),
  readFile: (p, encoding) => import("node:fs/promises").then((fs) => fs.readFile(p, encoding)),
  writeFile: (p, data, encoding) =>
    import("node:fs/promises").then((fs) => fs.writeFile(p, data, encoding).then(() => undefined)),
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

export interface TrashSnapshot {
  root: string;
  /** 扫描在册的文稿：回收站只收这一份清单里的条目——递 book.json 或任意书内文件都会被拒。 */
  docs: readonly { relPath: string; title: string }[];
}

export interface TrashServiceDeps {
  /** 现取当前书快照；没开书回 null（每次现取，换书后旧句柄自动失效）。 */
  book(): TrashSnapshot | null;
  fs?: TrashFs;
  /** 回收条目 id；默认毫秒时间戳 + 递增序号，同一毫秒也不撞。 */
  newId?: () => string;
  now?: () => Date;
}

export interface TrashService {
  trashDoc(relPath: string): Promise<DocTrashResult>;
  list(): Promise<TrashListResult>;
  restore(trashName: unknown): Promise<TrashRestoreResult>;
}

/** 默认 id：时间戳（36 进制）+ 同毫秒内的序号。 */
function defaultNewId(): () => string {
  let seq = 0;
  const base = Date.now().toString(36);
  return (): string => `${base}-${(seq++).toString(36)}`;
}

export function createTrashService(deps: TrashServiceDeps): TrashService {
  const fs = deps.fs ?? trashFs;
  const newId = deps.newId ?? defaultNewId();
  const now = deps.now ?? (() => new Date());

  const ioError = (what: string, error: unknown): string => {
    const message = error instanceof Error ? error.message : String(error);
    return `${what}失败：${message}`;
  };

  return {
    async trashDoc(relPath: string): Promise<DocTrashResult> {
      const snapshot = deps.book();
      if (snapshot === null) {
        return { ok: false, reason: "no-book", message: "还没打开作品——先打开一本书再谈删文稿。" };
      }
      let rel: string;
      try {
        rel = assertSafeRelPath(relPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          reason: message.includes("outside-book") ? "outside-book" : "invalid-path",
          message: `这个路径进不了回收站：${message}`
        };
      }
      // 只收扫描在册的文稿：这一条同时挡掉 book.json、.mochen 里的一切、
      // 以及「书里躺着但扫描器没认」的文件——回收站的抽屉里不收杂物。
      // 放在 realpath 闸**前面**：不在册的陌生路径没必要先做软链判定（回收站不收它），
      // 而「在册但盘上刚被人删了」的文稿会在这里放行、到下面 rename 处如实回 io-error。
      const doc = snapshot.docs.find((one) => one.relPath === rel);
      if (doc === undefined || !rel.endsWith(".md")) {
        return {
          ok: false,
          reason: "not-a-doc",
          message: `回收站只收这本书文稿树里的 .md 文稿：${rel}`
        };
      }
      if (!(await relPathStaysInsideRoot(snapshot.root, rel))) {
        return {
          ok: false,
          reason: "outside-book",
          message: `这条路径落在书外（软链与越界都按进不了回收站处理）：${rel}`
        };
      }
      const trashDir = trashDirOf(snapshot.root);
      const id = newId();
      const meta = {
        relPath: rel,
        title: doc.title,
        trashedAt: now().toISOString()
      };
      try {
        await fs.mkdir(trashDir, { recursive: true });
        // 小抄先落、正文后搬：搬正文失败时小抄被删掉，方向反过来就成了没有小抄的孤儿——
        // 文件在回收站里躺着，回收站却列不出它，那才是真的丢。
        await fs.writeFile(path.join(trashDir, `${id}.json`), JSON.stringify(meta), "utf8");
        try {
          await fs.rename(path.join(snapshot.root, rel), path.join(trashDir, `${id}.md`));
        } catch (error) {
          await fs.rm(path.join(trashDir, `${id}.json`), { force: true });
          return { ok: false, reason: "io-error", message: ioError("移入回收站", error) };
        }
      } catch (error) {
        return { ok: false, reason: "io-error", message: ioError("写回收站小抄", error) };
      }
      return { ok: true, trashName: id };
    },

    async list(): Promise<TrashListResult> {
      const snapshot = deps.book();
      if (snapshot === null) {
        return { ok: false, reason: "no-book", message: "还没打开作品——回收站跟着当前这本书走。" };
      }
      const trashDir = trashDirOf(snapshot.root);
      let names: string[];
      try {
        names = await fs.readdir(trashDir);
      } catch {
        // 目录不存在 = 还没删过任何东西，空表是事实不是故障。
        return { ok: true, entries: [] };
      }
      const entries: TrashEntry[] = [];
      for (const name of names) {
        if (!name.endsWith(".json") || !isTrashName(name.slice(0, -".json".length))) continue;
        try {
          const raw = JSON.parse(await fs.readFile(path.join(trashDir, name), "utf8")) as {
            relPath?: unknown;
            title?: unknown;
            trashedAt?: unknown;
          };
          // 形状不对的条目跳过：列一行读不出原路径的「幽灵」只会误导人去按还原。
          if (typeof raw.relPath !== "string") continue;
          entries.push({
            trashName: name.slice(0, -".json".length),
            relPath: raw.relPath,
            title: typeof raw.title === "string" ? raw.title : raw.relPath,
            trashedAt: typeof raw.trashedAt === "string" ? raw.trashedAt : ""
          });
        } catch {
          continue;
        }
      }
      entries.sort((a, b) => (a.trashedAt < b.trashedAt ? 1 : a.trashedAt > b.trashedAt ? -1 : 0));
      return { ok: true, entries };
    },

    async restore(trashName: unknown): Promise<TrashRestoreResult> {
      const snapshot = deps.book();
      if (snapshot === null) {
        return { ok: false, reason: "no-book", message: "还没打开作品——还原跟着当前这本书走。" };
      }
      if (!isTrashName(trashName)) {
        return { ok: false, reason: "not-found", message: "认不出这条回收站条目。" };
      }
      const trashDir = trashDirOf(snapshot.root);
      const metaPath = path.join(trashDir, `${trashName}.json`);
      let rel: string;
      try {
        const raw = JSON.parse(await fs.readFile(metaPath, "utf8")) as { relPath?: unknown };
        if (typeof raw.relPath !== "string") throw new Error("小抄里没有原路径");
        rel = assertSafeRelPath(raw.relPath);
      } catch {
        return { ok: false, reason: "not-found", message: `回收站里没有这一条：${trashName}` };
      }
      // 小抄本身也要过词法闸：有人手改 .json 把 relPath 写成 `..`、绝对路径或保留名时，
      // 还原不能变成一次越界搬运。realpath 闸在这里**不适用**——还原的目标必然还不存在
      // （存在的话上面已经回 target-exists），不存在的路径没有软链可看穿；
      // 它会落在哪里由 `root/<rel>` 逐字决定，而父目录是我们自己 mkdir 出来的， fresh 无链。
      // lexical 判据与 trashDoc 同一份（assertSafeRelPath），不是第二份。
      const target = path.join(snapshot.root, rel);
      if (await fs.exists(target)) {
        return {
          ok: false,
          reason: "target-exists",
          message: `原位置已经有一篇同名文稿（${rel}）。想覆盖就先把它移进回收站，再来还原这条。`
        };
      }
      try {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.rename(path.join(trashDir, `${trashName}.md`), target);
        await fs.rm(metaPath, { force: true });
      } catch (error) {
        return { ok: false, reason: "io-error", message: ioError("还原", error) };
      }
      return { ok: true, relPath: rel };
    }
  };
}

/** 回收站三条 IPC 的注册点（与 book-service 同款：来源与形状判定只在 ipc-guard 那一份）。 */
export function registerTrashIpc(register: IpcRegistrar, service: TrashService): void {
  handleTrusted(register, IPC_CHANNELS.docTrash, (_event, relPath) =>
    service.trashDoc(relPath as string)
  );
  handleTrusted(register, IPC_CHANNELS.trashList, () => service.list());
  handleTrusted(register, IPC_CHANNELS.trashRestore, (_event, trashName) =>
    service.restore(trashName)
  );
}
