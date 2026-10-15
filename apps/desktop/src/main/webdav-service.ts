import path from "node:path";
import {
  IPC_CHANNELS,
  type BookBackupCreateResult,
  type WebdavListResult,
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
  isWebdavUrlAllowed,
  joinWebdavUrl,
  mkcolDir,
  propfindChildren,
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
 * push / list 要落到 `<url>/<bookId>/<name>/`，没书就没有 bookId；但 verify 只是探活，
 * 建的临时目录在 `<url>/.mochen-probe-<random>/`，与 bookId 无关——所以 verify 允许在
 * 没开书时跑（用户刚配好地址与密钥想验一下能不能写很合理）。三条入口检查因此分两套。
 */
export interface WebdavServiceDeps {
  /** 现取当前书快照；没开书回 null。push / list 用，verify 不用。 */
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
    }
  };
}

/** 注册 verify / push / list 三条；config 那两条由 config-store 自己注册。 */
export function registerWebdavServiceIpc(register: IpcRegistrar, service: WebdavService): void {
  handleTrusted(register, IPC_CHANNELS.webdavVerify, () => service.verify());
  handleTrusted(register, IPC_CHANNELS.webdavPush, () => service.push());
  handleTrusted(register, IPC_CHANNELS.webdavList, () => service.list());
}
