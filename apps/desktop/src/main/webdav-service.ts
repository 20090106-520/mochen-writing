import path from "node:path";
import {
  IPC_CHANNELS,
  type BookBackupCreateResult,
  type WebdavListResult,
  type WebdavPullResult,
  type WebdavPushResult,
  type WebdavRemoteEntry,
  type WebdavVerifyResult
} from "@mochen/contracts";
import { isWriteScratchName } from "@mochen/fs-store";
import { BACKUP_NAME_RE, backupCreatedAtLabel, type BackupFs } from "./book-backup.js";
import { handleTrusted, type IpcRegistrar } from "./ipc-guard.js";
import {
  basicAuthHeader,
  deleteResource,
  getFile,
  isWebdavUrlAllowed,
  joinWebdavUrl,
  mkcolDir,
  propfindChildren,
  propfindEntries,
  putFile,
  type WebdavFetch
} from "./webdav-client.js";
import type { WebdavConfigStore } from "./webdav-config-store.js";

/**
 * WebDAV 远程备份服务（2026-10-15）。
 *
 * 【铁律 6 暂时豁免】
 * `provider-fetch.ts:assertUpstreamUrlAllowed` 与 `webdav-client.ts:isWebdavUrlAllowed` 是
 * 同一份判据的两处复述——provider 那份抛 `ProviderError`，而 webdav-client 不应依赖
 * agent-runtime（包边界检查会红）。本刀先就地复述，下一刀抽到 `upstream-url.ts` 一并归一。
 * 取舍记在台账第六十八节。
 *
 * 【verify 不要求开书】
 * push / list / pull 要落到 `<url>/<bookId>/<name>/`，没书就没有 bookId；但 verify 只是探活，
 * 建的临时目录在 `<url>/.mochen-probe-<random>/`，与 bookId 无关——所以 verify 允许在
 * 没开书时跑（用户刚配好地址与密钥想验一下能不能写很合理）。三条入口检查因此分两套。
 */
export interface WebdavServiceDeps {
  /** 现取当前书快照；没开书回 null。push / list / pull 用，verify 不用。 */
  bookSnapshot(): { root: string; metaId: string } | null;
  /** 配置存读真身（自带密钥读取）。 */
  configStore: WebdavConfigStore;
  /** 出网的 fetch；产品装配点注入真 fetch，测试注入假 fetch。 */
  fetch: WebdavFetch;
  /** 做新本地备份（push 复用 book-backup 的 create("manual")）。 */
  backupService: { create(mode: "manual" | "daily"): Promise<BookBackupCreateResult> };
  /** 备份目录的 fs（读本地备份字节、递归遍历）。复用 book-backup 的 BackupFs。 */
  backupFs: BackupFs;
  /** 探活目录名要带随机串，避免多机并发探活时撞同一名字。默认 crypto.randomBytes。 */
  randomProbe?: () => string;
}

export interface WebdavService {
  verify(): Promise<WebdavVerifyResult>;
  push(): Promise<WebdavPushResult>;
  list(): Promise<WebdavListResult>;
  pull(name: unknown): Promise<WebdavPullResult>;
}

/** 从 URL 取 host:port 作为「连上了哪个服务器」的人话标签。解不出来回原 url。 */
function serverLabelOf(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return parsed.host;
  } catch {
    return rawUrl;
  }
}

/**
 * verify / list 的状态码分类：401 ⇒ auth-failed，403 ⇒ forbidden，其余 ⇒ io-error。
 * verify 的探活与 list 的列举都允许「连得上但被拒绝」一档——这一档在两个表里都有位置。
 */
function classifyHttpStatusForList(status: number): "auth-failed" | "forbidden" | "io-error" {
  if (status === 401) return "auth-failed";
  if (status === 403) return "forbidden";
  return "io-error";
}

/**
 * push 的状态码分类：401 ⇒ auth-failed，其余（含 403）一律 io-error。
 *
 * 【为什么 push 不带 forbidden】
 * push 的契约 reason 表里没有 forbidden——只有 auth-failed / io-error。
 * 撞到 403 时把它压成 io-error 是诚实的：写不进去那一句笼统的「io」就够，不必在 push 这条
 * 专门细分「服务端拒绝」与「其他 io」——用户拿到的下一步动作是一样的（去 NAS 看权限）。
 */
function classifyHttpStatusForPush(status: number): "auth-failed" | "io-error" {
  if (status === 401) return "auth-failed";
  return "io-error";
}

/**
 * PROPFIND 回的路径 → 这一层的名字。取法与 `list()` 里那份**同一口径**（解码后取最后一段）：
 * 服务端可能回 `/dav/<id>/<name>/chapters/` 也可能回绝对 URL，两种都归一成最后一段。
 */
function leafNameOf(hrefPath: string): string {
  const trimmed = hrefPath.replace(/^\/+|\/+$/g, "");
  if (trimmed === "") return "";
  return decodeURIComponent(trimmed).split("/").pop() ?? "";
}

/**
 * 递归把远程一格搬进本地 `destDir`（pull 的搬运本体）。
 *
 * 【为什么逐层 Depth:1 而不是 Depth: infinity】
 * Depth: infinity 的 PROPFIND 多数服务端默认禁用（会 403），且整棵树的响应一次性进内存；
 * 逐层走与 `push` 的递归 readdir 是同一套形状（那边也是 `stack` + 一层层 readdir）。
 *
 * 任何一步失败回失败档（带状态码），**落点的清理由调用方负责**——
 * 这里只搬字节，不决定「半截目录怎么办」。
 */
async function pullTree(
  fetch: WebdavFetch,
  headers: Record<string, string>,
  remoteRoot: string,
  destDir: string,
  fs: BackupFs
): Promise<{ ok: true; fileCount: number } | { ok: false; status: number; message: string }> {
  let fileCount = 0;
  const stack: string[] = [""];
  while (stack.length > 0) {
    const rel = stack.pop()!;
    // rel 为空＝还没往下走，用 remoteRoot 本身；`joinWebdavUrl(base, "")` 会回 `base/`
    // （末尾多一条斜杠），有些服务端把那当成另一个资源，所以空层不拼。
    const listed = await propfindEntries(
      fetch,
      rel === "" ? remoteRoot : joinWebdavUrl(remoteRoot, rel),
      headers
    );
    if (!listed.ok) {
      return {
        ok: false,
        status: listed.status,
        message: `列远程 ${rel === "" ? "根" : rel} 失败：${listed.message}`
      };
    }
    for (const entry of listed.entries) {
      const leaf = leafNameOf(entry.path);
      if (leaf === "") continue;
      const childRel = rel === "" ? leaf : `${rel}/${leaf}`;
      if (entry.isDir) {
        await fs.mkdir(path.join(destDir, childRel), { recursive: true });
        stack.push(childRel);
        continue;
      }
      const got = await getFile(fetch, joinWebdavUrl(remoteRoot, childRel), headers);
      if (!got.ok) {
        return {
          ok: false,
          status: got.status,
          message: `拉 ${childRel} 失败：${got.message}`
        };
      }
      await fs.writeFile(path.join(destDir, childRel), got.data);
      fileCount += 1;
    }
  }
  return { ok: true, fileCount };
}

/** 清掉半截落点。只有「我们刚在书外新建、建之前确认过不存在」的那一个目录会走到这儿。 */
async function discardHalfPull(fs: BackupFs, destDir: string): Promise<void> {
  try {
    await fs.rm(destDir, { recursive: true, force: true });
  } catch {
    // 清不掉不改变回执：失败档照回，人话里已经说明是哪一步失败。
  }
}

/** 真随机探活目录名。不进 webdav-client 是因为这是「装配选择」而不是「协议判定」。 */
function defaultRandomProbe(): string {
  // 不引 crypto 也能活——但如果将来要并发探活，这就不是浪费。Buffer 是 node 标准件。
  return Buffer.from(Array.from({ length: 8 }, () => Math.floor(Math.random() * 256))).toString(
    "hex"
  );
}

export function createWebdavService(deps: WebdavServiceDeps): WebdavService {
  const randomProbe = deps.randomProbe ?? defaultRandomProbe;

  /**
   * 读配置 + URL 白名单，返回 `null` = 配置或 URL 不合法（带 reason 走），
   * 否则返回 `{ url, username, password, authHeader, server }`。
   * 三条通道都先走它，判据只有这一处。
   */
  async function prepare(): Promise<
    | {
        ok: true;
        url: string;
        username: string;
        password: string;
        authHeader: string;
        server: string;
        fetch: WebdavFetch;
      }
    | { ok: false; reason: "no-config" | "io-error"; message: string }
  > {
    const snapshot = await deps.configStore.read();
    if (!snapshot.persisted || snapshot.url === "" || snapshot.username === "") {
      return {
        ok: false,
        reason: "no-config",
        message: "WebDAV 还没配置好：先在设置里填地址与用户名。"
      };
    }
    if (!snapshot.hasPassword) {
      return {
        ok: false,
        reason: "no-config",
        message: "WebDAV 还没配置好：密码那一栏还没填。"
      };
    }
    if (!isWebdavUrlAllowed(snapshot.url)) {
      return {
        ok: false,
        reason: "io-error",
        message:
          "WebDAV 地址必须是 https://，或本机地址（localhost、127.0.0.1、::1）——" +
          "明文 http 会把密码与全书原样裸送给链路上的任何一台设备。"
      };
    }
    // 密钥在这里读：config-store.read 不回明文，service 是真正出网的那一层。
    // 读失败由调用方上层判成 io-error——配置看着在但出不了网，那是 io 而不是 no-config。
    let password: string | null;
    try {
      password = await deps.configStore.readPassword();
    } catch (error) {
      return {
        ok: false,
        reason: "io-error",
        message: `密钥读取失败：${error instanceof Error ? error.message : String(error)}`
      };
    }
    if (password === null) {
      // 与 read() 同步判过的 hasPassword 在异步竞态下可能短暂错位：read 时刚存上、
      // readPassword 时被清掉。这种情况下 truth 仍然是「没有可用密钥」。
      return {
        ok: false,
        reason: "no-config",
        message: "WebDAV 还没配置好：密码那一栏还没填。"
      };
    }
    return {
      ok: true,
      url: snapshot.url,
      username: snapshot.username,
      password,
      authHeader: basicAuthHeader(snapshot.username, password),
      server: serverLabelOf(snapshot.url),
      fetch: deps.fetch
    };
  }

  return {
    async verify(): Promise<WebdavVerifyResult> {
      const prep = await prepare();
      if (!prep.ok) {
        return { ok: false, reason: prep.reason, message: prep.message };
      }
      const probeDir = joinWebdavUrl(prep.url, `.mochen-probe-${randomProbe()}`);
      const mk = await mkcolDir(prep.fetch, probeDir, {
        Authorization: prep.authHeader
      });
      if (!mk.ok) {
        return {
          ok: false,
          reason: classifyHttpStatusForList(mk.status),
          message: mk.message
        };
      }
      // 探活目录立刻删——留着等于在用户的 NAS 上堆垃圾。
      await deleteResource(prep.fetch, probeDir, { Authorization: prep.authHeader });
      return { ok: true, server: prep.server };
    },

    async push(): Promise<WebdavPushResult> {
      const prep = await prepare();
      if (!prep.ok) {
        return { ok: false, reason: prep.reason, message: prep.message };
      }
      const snapshot = deps.bookSnapshot();
      if (snapshot === null) {
        return {
          ok: false,
          reason: "no-book",
          message: "还没打开作品——远程备份跟着当前这本书走。"
        };
      }
      // 复用 book-backup：先做一份新本地整书备份，再把那份备份的字节 PUT 上去。
      // 本地备份失败 ⇒ local-backup-failed，不递归自己写一份新的复制树。
      const localBackup = await deps.backupService.create("manual");
      if (!localBackup.ok || localBackup.name === null) {
        return {
          ok: false,
          reason: "local-backup-failed",
          message:
            localBackup.ok === false
              ? localBackup.message
              : "本地备份没有产出新的一份，远程没有推送。"
        };
      }
      const name = localBackup.name;
      const fileCount = localBackup.fileCount;

      // MKCOL `<url>/<bookId>/`——书根目录可能已存在（之前推过别的备份），405 也算成功。
      const bookDir = joinWebdavUrl(prep.url, snapshot.metaId);
      const mkBook = await mkcolDir(prep.fetch, bookDir, { Authorization: prep.authHeader });
      if (!mkBook.ok) {
        return {
          ok: false,
          reason: classifyHttpStatusForPush(mkBook.status),
          message: mkBook.message
        };
      }
      // MKCOL `<url>/<bookId>/<name>/`——这次备份的目录。405（已存在）当作成功：
      // 唯一会撞的情形是同一秒内的并发推（毫秒精度），那种情形下重推同一份就是它的本意。
      const backupDir = joinWebdavUrl(prep.url, snapshot.metaId, name);
      const mkBackup = await mkcolDir(prep.fetch, backupDir, { Authorization: prep.authHeader });
      if (!mkBackup.ok) {
        return {
          ok: false,
          reason: classifyHttpStatusForPush(mkBackup.status),
          message: mkBackup.message
        };
      }
      // 递归 PUT 本地备份的字节——路径片段 joinWebdavUrl 自动编码中文文件名。
      // 字节不进渲染层：备份字节在主进程手里，PUT 由主进程的 fetch 出网。
      const localBackupRoot = path.join(snapshot.root, ".mochen", "backups", name);
      const headers = { Authorization: prep.authHeader };
      let pushedFiles = 0;
      const stack: string[] = [""];
      while (stack.length > 0) {
        const rel = stack.pop()!;
        const abs = path.join(localBackupRoot, rel);
        const names = await deps.backupFs.readdir(abs);
        for (const child of names) {
          // 复用 fs-store 的 isWriteScratchName（与 book-backup.ts 的 copyTree 同一份）：
          // 原子写半成品既不进本地备份，也不进远程——再写一份判据就违铁律 6。
          if (isWriteScratchName(child)) continue;
          const childRel = rel === "" ? child : `${rel}/${child}`;
          const childAbs = path.join(abs, child);
          const isDir = await deps.backupFs.readdir(childAbs).then(
            () => true,
            () => false
          );
          if (isDir) {
            await mkcolDir(prep.fetch, joinWebdavUrl(prep.url, snapshot.metaId, name, childRel), {
              ...headers
            });
            stack.push(childRel);
          } else {
            const data = await deps.backupFs.readFile(childAbs);
            const put = await putFile(
              prep.fetch,
              joinWebdavUrl(prep.url, snapshot.metaId, name, childRel),
              headers,
              data
            );
            if (!put.ok) {
              return {
                ok: false,
                reason: classifyHttpStatusForPush(put.status),
                message: `推送 ${childRel} 失败：${put.message}`
              };
            }
            pushedFiles += 1;
          }
        }
      }
      return { ok: true, name, fileCount, pushedFiles };
    },

    async list(): Promise<WebdavListResult> {
      const prep = await prepare();
      if (!prep.ok) {
        return { ok: false, reason: prep.reason, message: prep.message };
      }
      const snapshot = deps.bookSnapshot();
      if (snapshot === null) {
        return {
          ok: false,
          reason: "no-book",
          message: "还没打开作品——远程备份列表跟着当前这本书走。"
        };
      }
      const bookDir = joinWebdavUrl(prep.url, snapshot.metaId);
      const propfind = await propfindChildren(prep.fetch, bookDir, {
        Authorization: prep.authHeader
      });
      if (!propfind.ok) {
        return {
          ok: false,
          reason: classifyHttpStatusForList(propfind.status),
          message: propfind.message
        };
      }
      // 只认合 book-backup 形状的目录名（铁律 6：BACKUP_NAME_RE 那一份真身住 book-backup.ts）。
      const entries: WebdavRemoteEntry[] = propfind.children
        .map((child) => decodeURIComponent(child.replace(/^\/+|\/+$/g, "")))
        .map((leaf) => leaf.split("/").pop() ?? "")
        .filter((leaf) => BACKUP_NAME_RE.test(leaf))
        .map((leaf) => ({ name: leaf, createdAt: backupCreatedAtLabel(leaf) }))
        .sort((a, b) => (a.name < b.name ? 1 : -1));
      return { ok: true, entries };
    },

    async pull(name: unknown): Promise<WebdavPullResult> {
      const prep = await prepare();
      if (!prep.ok) {
        return { ok: false, reason: prep.reason, message: prep.message };
      }
      const snapshot = deps.bookSnapshot();
      if (snapshot === null) {
        return {
          ok: false,
          reason: "no-book",
          message: "还没打开作品——从远程拉回跟着当前这本书走。"
        };
      }
      if (typeof name !== "string" || BACKUP_NAME_RE.test(name) === false) {
        return { ok: false, reason: "not-found", message: "认不出这份远程备份。" };
      }
      const headers = { Authorization: prep.authHeader };
      const remoteRoot = joinWebdavUrl(prep.url, snapshot.metaId, name);
      // 先探这一份在不在（多一趟 PROPFIND，换一个说得出口的 not-found）：
      // 404 与「空的一格」都判成「远程没有这一份」——push 出来的一格必有 book.json，不可能是空的。
      const probe = await propfindEntries(prep.fetch, remoteRoot, headers);
      if (!probe.ok) {
        return {
          ok: false,
          reason: classifyHttpStatusForList(probe.status),
          message: probe.message
        };
      }
      if (probe.entries.length === 0) {
        return { ok: false, reason: "not-found", message: `远程没有这一份备份：${name}` };
      }
      // 落点照 `restoreBookBackup` 同款：书的**旁边**（同父目录），不在书里——恢复出来的东西
      // 混进正被扫描的书树才是事故。已存在就顺位加号，绝不盖写任何已有内容。
      // `name.slice(5)` 去掉 `book-` 前缀，与本地 restore 的命名对齐（两边看到的是同一个时间戳）。
      const parent = path.dirname(snapshot.root);
      const base = `${path.basename(snapshot.root)}-恢复自远程备份-${name.slice(5)}`;
      let destDir = path.join(parent, base);
      for (let n = 2; await deps.backupFs.exists(destDir); n += 1) {
        destDir = path.join(parent, `${base}-${n}`);
      }
      let fileCount: number;
      try {
        await deps.backupFs.mkdir(destDir, { recursive: true });
        const walked = await pullTree(prep.fetch, headers, remoteRoot, destDir, deps.backupFs);
        if (!walked.ok) {
          // 搬运中途失败：这个半截目录是我们刚建出来的，清掉再回 io 档——
          // 书旁躺一份「看起来像还原」的残件，比明说失败更难分辨。
          await discardHalfPull(deps.backupFs, destDir);
          return {
            ok: false,
            reason: classifyHttpStatusForList(walked.status),
            message: walked.message
          };
        }
        fileCount = walked.fileCount;
      } catch (error) {
        await discardHalfPull(deps.backupFs, destDir);
        return {
          ok: false,
          reason: "io-error",
          message: `拉回本地失败：${error instanceof Error ? error.message : String(error)}`
        };
      }
      return { ok: true, destName: path.basename(destDir), fileCount };
    }
  };
}

/** 注册 verify / push / list / pull 四条；config 那两条由 config-store 自己注册。 */
export function registerWebdavServiceIpc(register: IpcRegistrar, service: WebdavService): void {
  handleTrusted(register, IPC_CHANNELS.webdavVerify, () => service.verify());
  handleTrusted(register, IPC_CHANNELS.webdavPush, () => service.push());
  handleTrusted(register, IPC_CHANNELS.webdavList, () => service.list());
  handleTrusted(register, IPC_CHANNELS.webdavPull, (_event, name) => service.pull(name));
}
