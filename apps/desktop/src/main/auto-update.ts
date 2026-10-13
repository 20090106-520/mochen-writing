import type { UpdateCheckResult } from "@mochen/contracts";

/**
 * 自动更新检查（2026-10-10）。主进程这条线刻意**不 import electron**：
 * electron-updater 的真身只在装配层（`main/index.ts`）碰，这里只认下面这个结构——
 * 单测注入假件就能把五档结果全部走到，不用真起 Electron。
 *
 * 口径（铁律：文案诚实）：
 * - 检查只「说」，不下载：`autoDownload` 默认关，装不装、什么时候装是用户的决定；
 * - 没配更新源回 `disabled` 而不是报错——没配是常态；
 * - 网络失败把 reason 原文带回来，不编「已是最新」。
 */

/** electron-updater `autoUpdater` 的结构子集（装配层负责把真身适配成这一份）。 */
export interface UpdaterLike {
  setFeedURL(options: { provider: "generic"; url: string }): void;
  checkForUpdates(): Promise<{ updateInfo: { version?: string } } | null>;
  currentVersion: { version: string };
  /** 检查是否顺手下载。本模块每次检查都会把它显式设一遍（默认 false=只报告不动手）。 */
  autoDownload?: boolean;
}

export interface AutoUpdateDeps {
  updater: UpdaterLike;
  /** 开发版不检查：dev 产品的版本号跟发布物对不上，比出来全是噪音。 */
  isPackaged: boolean;
  /** 更新源（放 latest.yml 的目录）。null 或空串 = 没配，检查回 disabled。 */
  feedUrl: string | null;
  /** 是否允许 electron-updater 自动下载。默认 false：检查只报告，不动手。 */
  autoDownload?: boolean;
  log?: (line: string) => void;
}

export interface AutoUpdateService {
  check(): Promise<UpdateCheckResult>;
}

export function createAutoUpdateService(deps: AutoUpdateDeps): AutoUpdateService {
  const { updater, isPackaged, feedUrl } = deps;
  const log = deps.log ?? (() => {});
  const current = (): string => updater.currentVersion.version;

  return {
    async check(): Promise<UpdateCheckResult> {
      const version = current();
      if (!isPackaged) {
        return {
          status: "dev",
          version,
          latestVersion: null,
          note: "现在是开发版，不走更新检查——发布后这里会按更新源报告新版本。"
        };
      }
      const url = feedUrl?.trim() ?? "";
      if (url === "") {
        return {
          status: "disabled",
          version,
          latestVersion: null,
          note: "还没配置更新源（环境变量 MOCHEN_UPDATE_URL 指到放 latest.yml 的目录，重启即启用）。"
        };
      }
      // 每次现设：feedUrl 与 autoDownload 都可能在两次检查之间被改，缓存会拿着旧配置出网。
      updater.autoDownload = deps.autoDownload ?? false;
      updater.setFeedURL({ provider: "generic", url });
      log(`[更新] 检查更新：${url}`);
      try {
        const result = await updater.checkForUpdates();
        const latest =
          typeof result?.updateInfo?.version === "string" ? result.updateInfo.version : null;
        if (latest === null || latest === version) {
          return {
            status: "up-to-date",
            version,
            latestVersion: latest,
            note: `已是最新版本（${version}）。`
          };
        }
        return {
          status: "available",
          version,
          latestVersion: latest,
          note: `发现新版本 ${latest}（当前 ${version}）。下载新的安装包覆盖安装即可，书稿与设置都会保留。`
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`[更新] 检查失败：${message}`);
        return {
          status: "error",
          version,
          latestVersion: null,
          note: `检查更新失败：${message}。多半是网络不通或更新源地址不可达，稍后再试。`
        };
      }
    }
  };
}

/** 启动自动检查的那一档（2026-10-10）：配了源才查，查到新版本弹系统通知，其余只写日志。 */
export async function checkOnBoot(
  service: AutoUpdateService,
  io: {
    notify: (title: string, body: string) => void;
    log: (line: string) => void;
  }
): Promise<void> {
  const result = await service.check();
  if (result.status === "available") {
    io.notify("墨宸 AI · 发现新版本", result.note);
  } else {
    io.log(
      `[更新] 启动检查：${result.status}${result.latestVersion ? `（远端 ${result.latestVersion}）` : ""}`
    );
  }
}
