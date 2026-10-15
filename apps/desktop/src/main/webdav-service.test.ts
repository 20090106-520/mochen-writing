import { describe, expect, it, vi } from "vitest";
import type { BookBackupCreateResult, WebdavConfigSnapshot } from "@mochen/contracts";
import { createWebdavService, type WebdavServiceDeps } from "./webdav-service.js";
import type { WebdavFetch } from "./webdav-client.js";
import type { WebdavConfigStore } from "./webdav-config-store.js";
import type { BackupFs } from "./book-backup.js";

/**
 * WebDAV 服务层（2026-10-15）。verify / push / list / pull 四流程的判档是这一刀的本体：
 * 不连真服务器——fetch 注入「按 url / 方法回固定状态码与 body」，逐条钉分类与回执。
 * 配置与 backupService 全用内存件。
 */

const META_ID = "11111111-2222-3333-4444-555555555555";

function configuredSnapshot(over: Partial<WebdavConfigSnapshot> = {}): WebdavConfigSnapshot {
  return {
    persisted: true,
    url: "https://nas.local/dav/",
    username: "alice",
    hasPassword: true,
    ...over
  };
}

function configStoreMock(
  snapshot: WebdavConfigSnapshot,
  password: string | null
): WebdavConfigStore {
  return {
    async read() {
      return snapshot;
    },
    async save() {},
    async readPassword() {
      return password;
    }
  };
}

function memBackupFs(): BackupFs {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  return {
    async mkdir(p) {
      dirs.add(p);
    },
    async readdir(p) {
      if (!dirs.has(p) && !files.has(p)) throw new Error(`ENOENT ${p}`);
      return [...files.keys()]
        .filter((k) => k.startsWith(`${p}/`))
        .map((k) => k.slice(p.length + 1).split("/")[0]!);
    },
    async readFile(p) {
      const data = files.get(p);
      if (data === undefined) throw new Error(`ENOENT ${p}`);
      return data;
    },
    async writeFile(p, data) {
      files.set(p, data);
    },
    async rm() {},
    async exists(p) {
      return files.has(p) || dirs.has(p);
    }
  };
}

const BACKUP_NAME = "book-2026-10-15-12-00-00";

function makeDeps(over: Partial<WebdavServiceDeps> = {}): WebdavServiceDeps {
  return {
    bookSnapshot: () => ({ root: "/book", metaId: META_ID }),
    configStore: configStoreMock(configuredSnapshot(), "secret"),
    fetch: vi.fn(async () => ({ status: 201, text: "" })) as unknown as WebdavFetch,
    backupService: {
      async create(): Promise<BookBackupCreateResult> {
        return { ok: true, name: BACKUP_NAME, fileCount: 3 };
      }
    },
    backupFs: memBackupFs(),
    randomProbe: () => "deadbeef",
    ...over
  };
}

describe("webdavService · verify", () => {
  it("MKCOL 探活成功后立刻 DELETE，回 ok + server 标签", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    const fetch: WebdavFetch = async (init) => {
      calls.push({ method: init.method, url: init.url });
      if (init.method === "MKCOL") return { status: 201, text: "" };
      if (init.method === "DELETE") return { status: 204, text: "" };
      return { status: 500, text: "" };
    };
    const service = createWebdavService({ ...makeDeps({ fetch }) });
    const result = await service.verify();
    expect(result).toEqual({ ok: true, server: "nas.local" });
    // 探活目录名带随机串
    const mkcolCall = calls.find((c) => c.method === "MKCOL");
    expect(mkcolCall?.url).toContain(".mochen-probe-deadbeef");
    // 紧接着 DELETE 同一目录
    const deleteCall = calls.find((c) => c.method === "DELETE");
    expect(deleteCall?.url).toContain(".mochen-probe-deadbeef");
  });

  it("MKCOL 回 401 ⇒ auth-failed", async () => {
    const fetch = vi.fn(async () => ({ status: 401, text: "Unauthorized" })) as WebdavFetch;
    const service = createWebdavService({ ...makeDeps({ fetch }) });
    const result = await service.verify();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("auth-failed");
  });

  it("MKCOL 回 403 ⇒ forbidden（连得上但被拒绝）", async () => {
    const fetch = vi.fn(async () => ({ status: 403, text: "Forbidden" })) as WebdavFetch;
    const service = createWebdavService({ ...makeDeps({ fetch }) });
    const result = await service.verify();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("forbidden");
  });

  it("MKCOL 抛网络错 ⇒ io-error", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as WebdavFetch;
    const service = createWebdavService({ ...makeDeps({ fetch }) });
    const result = await service.verify();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("io-error");
  });
});

describe("webdavService · verify 的前置判", () => {
  it("没配过（persisted=false）⇒ no-config", async () => {
    const store = configStoreMock(
      configuredSnapshot({ persisted: false, url: "", username: "" }),
      null
    );
    const service = createWebdavService({ ...makeDeps({ configStore: store }) });
    const result = await service.verify();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-config");
  });

  it("密码那一栏没填（hasPassword=false）⇒ no-config", async () => {
    const store = configStoreMock(configuredSnapshot({ hasPassword: false }), null);
    const service = createWebdavService({ ...makeDeps({ configStore: store }) });
    const result = await service.verify();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-config");
  });

  it("地址不是 https 也不是本机回环 ⇒ io-error（明文 http 拒绝）", async () => {
    const store = configStoreMock(configuredSnapshot({ url: "http://nas.local/dav/" }), "secret");
    const service = createWebdavService({ ...makeDeps({ configStore: store }) });
    const result = await service.verify();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("io-error");
  });
});

describe("webdavService · push", () => {
  it("没开书 ⇒ no-book（push 依赖 bookId 拼 path）", async () => {
    const service = createWebdavService({
      ...makeDeps({ bookSnapshot: () => null })
    });
    const result = await service.push();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-book");
  });

  it("本地备份失败 ⇒ local-backup-failed，不递归自己写复制树", async () => {
    const service = createWebdavService({
      ...makeDeps({
        backupService: {
          async create(): Promise<BookBackupCreateResult> {
            return { ok: false, reason: "io-error", message: "盘空间不足" };
          }
        }
      })
    });
    const result = await service.push();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("local-backup-failed");
  });

  it("本地备份没产出新一份（name=null）⇒ local-backup-failed", async () => {
    const service = createWebdavService({
      ...makeDeps({
        backupService: {
          async create(): Promise<BookBackupCreateResult> {
            return { ok: true, name: null, fileCount: 0 };
          }
        }
      })
    });
    const result = await service.push();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("local-backup-failed");
  });

  it("MKCOL 书根目录回 401 ⇒ auth-failed（push 表里允许）", async () => {
    const fetch = vi.fn(async (init) => {
      if (init.method === "MKCOL") return { status: 401, text: "Unauthorized" };
      return { status: 500, text: "" };
    }) as unknown as WebdavFetch;
    const service = createWebdavService({ ...makeDeps({ fetch }) });
    const result = await service.push();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("auth-failed");
  });

  it("MKCOL 书根目录回 403 ⇒ io-error（push 表里没有 forbidden，被压成 io-error）", async () => {
    const fetch = vi.fn(async (init) => {
      if (init.method === "MKCOL") return { status: 403, text: "Forbidden" };
      return { status: 500, text: "" };
    }) as unknown as WebdavFetch;
    const service = createWebdavService({ ...makeDeps({ fetch }) });
    const result = await service.push();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("io-error");
  });

  it("全流程成功：MKCOL 两层目录 + PUT 每个文件，回 ok + 计数", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    const fetch: WebdavFetch = async (init) => {
      calls.push({ method: init.method, url: init.url });
      if (init.method === "MKCOL") return { status: 201, text: "" };
      if (init.method === "PUT") return { status: 201, text: "" };
      return { status: 500, text: "" };
    };
    const fsWithDir: BackupFs = {
      async mkdir() {},
      async readdir(p) {
        // 归一去分隔符后比（Windows 用 \，POSIX 用 /）
        const norm = p.replace(/[\\/]+/g, "/");
        if (norm === "/book/.mochen/backups/" + BACKUP_NAME) return ["book.json", "chapters"];
        if (norm === "/book/.mochen/backups/" + BACKUP_NAME + "/chapters") return ["01.md"];
        throw new Error(`ENOENT ${p}`);
      },
      async readFile(p) {
        const norm = p.replace(/[\\/]+/g, "/");
        if (norm === "/book/.mochen/backups/" + BACKUP_NAME + "/book.json")
          return new TextEncoder().encode('{"title":"书"}');
        if (norm === "/book/.mochen/backups/" + BACKUP_NAME + "/chapters/01.md")
          return new TextEncoder().encode("正文");
        throw new Error(`ENOENT ${p}`);
      },
      async writeFile() {},
      async rm() {},
      async exists() {
        return true;
      }
    };
    const service = createWebdavService({
      ...makeDeps({ fetch, backupFs: fsWithDir })
    });
    const result = await service.push();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.name).toBe(BACKUP_NAME);
      expect(result.fileCount).toBe(3);
      expect(result.pushedFiles).toBeGreaterThan(0);
    }
    // MKCOL 至少两次：书根目录 + 这次备份目录（再加 chapters 子目录共 3 次）
    const mkcolCalls = calls.filter((c) => c.method === "MKCOL");
    expect(mkcolCalls.length).toBeGreaterThanOrEqual(2);
    // PUT 至少两次：book.json + 01.md
    const putCalls = calls.filter((c) => c.method === "PUT");
    expect(putCalls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("webdavService · list", () => {
  it("没开书 ⇒ no-book", async () => {
    const service = createWebdavService({
      ...makeDeps({ bookSnapshot: () => null })
    });
    const result = await service.list();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-book");
  });

  it("PROPFIND 回 401 ⇒ auth-failed", async () => {
    const fetch = vi.fn(async () => ({ status: 401, text: "" })) as unknown as WebdavFetch;
    const service = createWebdavService({ ...makeDeps({ fetch }) });
    const result = await service.list();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("auth-failed");
  });

  it("PROPFIND 回 403 ⇒ forbidden（list 表里允许）", async () => {
    const fetch = vi.fn(async () => ({ status: 403, text: "" })) as unknown as WebdavFetch;
    const service = createWebdavService({ ...makeDeps({ fetch }) });
    const result = await service.list();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("forbidden");
  });

  it("PROPFIND 404 ⇒ 空列表（书根目录还没建过）", async () => {
    const fetch = vi.fn(async () => ({ status: 404, text: "" })) as unknown as WebdavFetch;
    const service = createWebdavService({ ...makeDeps({ fetch }) });
    const result = await service.list();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entries).toEqual([]);
  });

  it("PROPFIND 207 + 多条子项 ⇒ 只留合 BACKUP_NAME_RE 形状的，按名字降序", async () => {
    const xml = `<D:multistatus xmlns:D="DAV:">
  <D:response><D:href>/dav/${META_ID}/</D:href></D:response>
  <D:response><D:href>/dav/${META_ID}/book-2026-10-15-12-00-00/</D:href></D:response>
  <D:response><D:href>/dav/${META_ID}/book-2025-12-31-23-59-59/</D:href></D:response>
  <D:response><D:href>/dav/${META_ID}/not-a-backup-name/</D:href></D:response>
</D:multistatus>`;
    const fetch = vi.fn(async () => ({ status: 207, text: xml })) as unknown as WebdavFetch;
    const service = createWebdavService({ ...makeDeps({ fetch }) });
    const result = await service.list();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries.map((e) => e.name)).toEqual([
        "book-2026-10-15-12-00-00",
        "book-2025-12-31-23-59-59"
      ]);
    }
  });
});

/** 记下写盘与删目录的 fs：pull 的「落到哪 / 半截是否清掉」都要能被断言。 */
function recordingBackupFs(): BackupFs & { written: string[]; removed: string[] } {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  const written: string[] = [];
  const removed: string[] = [];
  return {
    written,
    removed,
    async mkdir(p) {
      dirs.add(p);
    },
    async readdir() {
      return [];
    },
    async readFile(p) {
      const data = files.get(p);
      if (data === undefined) throw new Error(`ENOENT ${p}`);
      return data;
    },
    async writeFile(p, data) {
      files.set(p, data);
      written.push(p);
    },
    async rm(p) {
      removed.push(p);
      files.delete(p);
      dirs.delete(p);
    },
    async exists(p) {
      return files.has(p) || dirs.has(p);
    }
  };
}

/** 归一去分隔符后比（Windows 用 \、POSIX 用 /），与 push 那条用例同一手法。 */
function slashed(value: string): string {
  return value.replace(/[\\/]+/g, "/");
}

describe("webdavService · pull 的前置判", () => {
  it("没配过 ⇒ no-config（连请求都不发）", async () => {
    const store = configStoreMock(
      configuredSnapshot({ persisted: false, url: "", username: "" }),
      null
    );
    const fetch = vi.fn(async () => ({ status: 207, text: "" })) as unknown as WebdavFetch;
    const service = createWebdavService({ ...makeDeps({ configStore: store, fetch }) });
    const result = await service.pull(BACKUP_NAME);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-config");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("没开书 ⇒ no-book（落点跟着当前这本书走）", async () => {
    const service = createWebdavService({ ...makeDeps({ bookSnapshot: () => null }) });
    const result = await service.pull(BACKUP_NAME);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-book");
  });

  it("名字不合备份形状 ⇒ not-found，连请求都不发（渲染层递不出别的路径）", async () => {
    const fetch = vi.fn(async () => ({ status: 207, text: "" })) as unknown as WebdavFetch;
    const service = createWebdavService({ ...makeDeps({ fetch }) });
    for (const bad of [
      "",
      "not-a-backup",
      "../book-2026-10-15-12-00-00",
      42 as unknown as string
    ]) {
      const result = await service.pull(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("not-found");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("远程 404 / 空的一格 ⇒ not-found（push 出来的一格必有内容）", async () => {
    for (const text of [
      "",
      `<D:multistatus xmlns:D="DAV:"><D:response><D:href>/dav/${META_ID}/${BACKUP_NAME}</D:href></D:response></D:multistatus>`
    ]) {
      const fetch = vi.fn(async () => ({ status: 404, text })) as unknown as WebdavFetch;
      const service = createWebdavService({ ...makeDeps({ fetch }) });
      const result = await service.pull(BACKUP_NAME);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("not-found");
    }
  });

  it("PROPFIND 401 / 403 ⇒ auth-failed / forbidden", async () => {
    for (const [status, reason] of [
      [401, "auth-failed"],
      [403, "forbidden"]
    ] as const) {
      const fetch = vi.fn(async () => ({ status, text: "" })) as unknown as WebdavFetch;
      const service = createWebdavService({ ...makeDeps({ fetch }) });
      const result = await service.pull(BACKUP_NAME);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe(reason);
    }
  });
});

describe("webdavService · pull 的搬运", () => {
  /** 假远程：根一格（book.json + chapters/），chapters 里一件 01.md。 */
  function remoteTreeFetch(): WebdavFetch {
    return async (init) => {
      const url = init.url;
      if (init.method === "GET") {
        if (url.endsWith("/book.json"))
          return {
            status: 200,
            text: '{"title":"书"}',
            bytes: new TextEncoder().encode('{"title":"书"}')
          };
        if (url.endsWith("/01.md")) return { status: 200, text: "正文" };
        return { status: 404, text: "" };
      }
      const selfEntry = (href: string, isDir: boolean): string =>
        `<D:response><D:href>${href}</D:href><D:propstat><D:prop><D:resourcetype>${
          isDir ? "<D:collection/>" : ""
        }</D:resourcetype></D:prop></D:propstat></D:response>`;
      const base = `/dav/${META_ID}/${BACKUP_NAME}`;
      if (url.endsWith(BACKUP_NAME)) {
        return {
          status: 207,
          text: `<D:multistatus xmlns:D="DAV:">${selfEntry(base, true)}${selfEntry(
            `${base}/book.json`,
            false
          )}${selfEntry(`${base}/chapters/`, true)}</D:multistatus>`
        };
      }
      if (url.endsWith("/chapters")) {
        return {
          status: 207,
          text: `<D:multistatus xmlns:D="DAV:">${selfEntry(`${base}/chapters/`, true)}${selfEntry(
            `${base}/chapters/01.md`,
            false
          )}</D:multistatus>`
        };
      }
      return { status: 404, text: "" };
    };
  }

  it("两层递归搬完：落在书的旁边一份新目录，fileCount 与写盘路径都对", async () => {
    const fs = recordingBackupFs();
    const service = createWebdavService({
      ...makeDeps({ fetch: remoteTreeFetch(), backupFs: fs })
    });
    const dest = `book-恢复自远程备份-${BACKUP_NAME.slice(5)}`;
    const result = await service.pull(BACKUP_NAME);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.destName).toBe(dest);
      expect(result.fileCount).toBe(2);
    }
    expect(fs.written.map(slashed).sort()).toEqual([
      `/${dest}/book.json`,
      `/${dest}/chapters/01.md`
    ]);
    // 落点在书的旁边（同父目录），不在书里
    expect(fs.written.every((p) => slashed(p).startsWith(`/${dest}/`))).toBe(true);
  });

  it("落点重名 ⇒ 顺位加 -2，绝不盖写", async () => {
    const base = `/book-恢复自远程备份-${BACKUP_NAME.slice(5)}`;
    const fs = recordingBackupFs();
    const service = createWebdavService({
      ...makeDeps({
        fetch: remoteTreeFetch(),
        backupFs: {
          ...fs,
          async exists(p) {
            return slashed(p) === base;
          }
        }
      })
    });
    const result = await service.pull(BACKUP_NAME);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.destName).toBe(`${base.slice(1)}-2`);
  });

  it("GET 半途失败 ⇒ io-error 且把书旁那半截目录清掉", async () => {
    const fs = recordingBackupFs();
    const fetch = remoteTreeFetch();
    const service = createWebdavService({
      ...makeDeps({
        backupFs: fs,
        fetch: async (init) =>
          init.method === "GET" && init.url.endsWith("/01.md")
            ? { status: 500, text: "boom" }
            : fetch(init)
      })
    });
    const result = await service.pull(BACKUP_NAME);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("io-error");
    // 已写的 book.json 所在目录被清掉（书旁不留「看起来像还原」的残件）
    expect(fs.removed.map(slashed)).toContain(`/book-恢复自远程备份-${BACKUP_NAME.slice(5)}`);
  });

  it("写盘抛错 ⇒ io-error，同样清半截", async () => {
    const fs = recordingBackupFs();
    const service = createWebdavService({
      ...makeDeps({
        fetch: remoteTreeFetch(),
        backupFs: {
          ...fs,
          async writeFile() {
            throw new Error("disk full");
          }
        }
      })
    });
    const result = await service.pull(BACKUP_NAME);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("io-error");
      expect(result.message).toContain("disk full");
    }
    expect(fs.removed.length).toBeGreaterThan(0);
  });
});

describe("webdavService · IPC 注册", () => {
  it("registerWebdavServiceIpc 注册四条：verify / push / list / pull", async () => {
    const { registerWebdavServiceIpc } = await import("./webdav-service.js");
    const { IPC_CHANNELS } = await import("@mochen/contracts");
    const registered = new Map<string, (...args: unknown[]) => unknown>();
    const handle = (channel: string, fn: (...args: unknown[]) => unknown): void => {
      registered.set(channel, fn);
    };
    registerWebdavServiceIpc(handle, createWebdavService(makeDeps()));
    expect(registered.has(IPC_CHANNELS.webdavVerify)).toBe(true);
    expect(registered.has(IPC_CHANNELS.webdavPush)).toBe(true);
    expect(registered.has(IPC_CHANNELS.webdavList)).toBe(true);
    expect(registered.has(IPC_CHANNELS.webdavPull)).toBe(true);
  });
});
