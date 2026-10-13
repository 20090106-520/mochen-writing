import { describe, expect, it } from "vitest";
import { createAutoUpdateService, type UpdaterLike } from "./auto-update.js";

/**
 * 自动更新检查的用例（2026-10-10）。五档结果全部在假件上走到——
 * electron-updater 真身在装配层，这里只验判定与文案。
 */

function fakeUpdater(version: string, result: { version?: string } | null | Error): UpdaterLike {
  return {
    setFeedURL: () => {},
    checkForUpdates: async () => {
      if (result instanceof Error) throw result;
      return result === null ? null : { updateInfo: result };
    },
    currentVersion: { version }
  };
}

describe("createAutoUpdateService", () => {
  it("开发版直接回 dev，不去碰更新源", async () => {
    const service = createAutoUpdateService({
      updater: fakeUpdater("0.1.0", { version: "9.9.9" }),
      isPackaged: false,
      feedUrl: "https://example.com/releases"
    });
    const result = await service.check();
    expect(result.status).toBe("dev");
    expect(result.note).toContain("开发版");
  });

  it("没配更新源回 disabled 而不是报错——没配是常态", async () => {
    for (const feedUrl of [null, "", "   "]) {
      const service = createAutoUpdateService({
        updater: fakeUpdater("0.1.0", { version: "9.9.9" }),
        isPackaged: true,
        feedUrl
      });
      const result = await service.check();
      expect(result.status).toBe("disabled");
      expect(result.note).toContain("MOCHEN_UPDATE_URL");
    }
  });

  it("远端版本比当前新 → available；相同 → up-to-date；读不到版本号 → up-to-date", async () => {
    const newer = createAutoUpdateService({
      updater: fakeUpdater("0.1.0", { version: "0.2.0" }),
      isPackaged: true,
      feedUrl: "https://example.com/releases"
    });
    expect((await newer.check()).status).toBe("available");

    const same = createAutoUpdateService({
      updater: fakeUpdater("0.1.0", { version: "0.1.0" }),
      isPackaged: true,
      feedUrl: "https://example.com/releases"
    });
    expect((await same.check()).status).toBe("up-to-date");

    const blind = createAutoUpdateService({
      updater: fakeUpdater("0.1.0", {}),
      isPackaged: true,
      feedUrl: "https://example.com/releases"
    });
    const result = await blind.check();
    expect(result.status).toBe("up-to-date");
    expect(result.latestVersion).toBeNull();
  });

  it("网络失败把原因带回来，不编「已是最新」", async () => {
    const service = createAutoUpdateService({
      updater: fakeUpdater("0.1.0", new Error("getaddrinfo ENOTFOUND")),
      isPackaged: true,
      feedUrl: "https://example.com/releases"
    });
    const result = await service.check();
    expect(result.status).toBe("error");
    expect(result.note).toContain("ENOTFOUND");
  });

  it("autoDownload 默认关：检查只报告，不许偷偷下载", async () => {
    let seenAutoDownload: boolean | undefined;
    const updater: UpdaterLike = {
      setFeedURL: () => {},
      checkForUpdates: async () => null,
      currentVersion: { version: "0.1.0" }
    };
    (updater as { autoDownload?: boolean }).autoDownload = true;
    const proxy = new Proxy(updater, {
      set(target, prop, value) {
        if (prop === "autoDownload") seenAutoDownload = value;
        return Reflect.set(target, prop, value);
      }
    });
    const service = createAutoUpdateService({
      updater: proxy,
      isPackaged: true,
      feedUrl: "https://example.com/releases"
    });
    await service.check();
    expect(seenAutoDownload).toBe(false);
  });

  it("feedUrl 两侧空白被裁掉后才交给 setFeedURL", async () => {
    const calls: unknown[] = [];
    const updater: UpdaterLike = {
      setFeedURL: (options) => calls.push(options),
      checkForUpdates: async () => null,
      currentVersion: { version: "0.1.0" }
    };
    const service = createAutoUpdateService({
      updater,
      isPackaged: true,
      feedUrl: " https://example.com/releases "
    });
    await service.check();
    expect(calls).toEqual([{ provider: "generic", url: "https://example.com/releases" }]);
  });
});

describe("checkOnBoot", () => {
  it("配了源且查到新版本 → 弹系统通知；其余档只写日志", async () => {
    const { checkOnBoot } = await import("./auto-update.js");
    const notifications: string[] = [];
    const logs: string[] = [];
    const io = {
      notify: (title: string, body: string) => notifications.push(`${title}|${body}`),
      log: (line: string) => logs.push(line)
    };
    const available = createAutoUpdateService({
      updater: fakeUpdater("0.1.0", { version: "0.2.0" }),
      isPackaged: true,
      feedUrl: "https://example.com/releases"
    });
    await checkOnBoot(available, io);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toContain("发现新版本");

    const disabled = createAutoUpdateService({
      updater: fakeUpdater("0.1.0", null),
      isPackaged: true,
      feedUrl: null
    });
    await checkOnBoot(disabled, io);
    expect(notifications).toHaveLength(1);
    expect(logs.some((line) => line.includes("disabled"))).toBe(true);
  });
});
