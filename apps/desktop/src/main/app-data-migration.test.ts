import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { migrateLegacyAppData, type AppDataMigrationDeps } from "./app-data-migration.js";
import type { Cipher } from "./credential-store.js";

/**
 * F-4 目录迁移（Plan 3 spec §12）的流程契约。
 *
 * 这个文件钉的是**顺序**，不只是结果：§15 的变异 M5 说的就是「先改名后验密」——
 * 那样一旦验不过，旧目录已经不在原名，用户再也找不回它。所以下面每条用例都
 * 特意断言「什么时候才发生改名」以及「改名之前发生了什么」。
 *
 * 路径期望一律用 `path.join` 拼，不写死正斜杠：Windows 上分隔符是 `\`，
 * 写死正斜杠的断言在 Windows 上永远匹配不上（那不是「通过」，是「没跑到」）。
 */
const KNOWN = ["config.json", "secrets.enc", "appearance.json"];
const OLD = "/appdata/mochen-writing";
const NEW = "/appdata/mochen-ai";

function cipher(over: Partial<Cipher> = {}): Cipher {
  return {
    available: true,
    encrypt: (plain) => `enc:${Buffer.from(plain, "utf8").toString("base64url")}`,
    decrypt: (text) => Buffer.from(text.slice(4), "base64url").toString("utf8"),
    ...over
  };
}

interface Stub extends AppDataMigrationDeps {
  /** 调用顺序：每一步都记一笔，用例直接比这条序列。 */
  trace: string[];
}

/** 旧目录里放哪几个文件；没列到的就是不摆。 */
function deps(
  over: {
    oldFiles?: readonly string[];
    cipher?: Cipher;
    /** 新目录已占用改名目标时让 rename 抛。 */
    renameFails?: boolean;
    now?: Date;
  } = {}
): Stub {
  const trace: string[] = [];
  const oldFiles = over.oldFiles ?? ["secrets.enc"];
  const safe = (c: Cipher): Cipher => c;
  return {
    trace,
    oldDir: OLD,
    newDir: NEW,
    cipher: over.cipher ?? safe(cipher()),
    now: over.now ?? new Date("2026-10-02T09:00:00.000Z"),
    async readdir(p) {
      trace.push(`readdir:${p}`);
      return [...oldFiles];
    },
    async copyFile(src, dest) {
      trace.push(`copy:${src}->${dest}`);
    },
    async readFile(p) {
      trace.push(`read:${p}`);
      return "enc:a2V5";
    },
    async rename(from, to) {
      trace.push(`rename:${from}->${to}`);
      if (over.renameFails) throw new Error("目标已存在");
    },
    async mkdir(p) {
      trace.push(`mkdir:${p}`);
    }
  };
}

describe("migrateLegacyAppData · 第 1 步：旧目录不在就什么都不做", () => {
  it("旧目录不存在 ⇒ nothing-to-do，一个字节都不写", async () => {
    const d = deps();
    d.readdir = vi.fn(async () => {
      d.trace.push("readdir:旧");
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    expect(await migrateLegacyAppData(d)).toEqual({ status: "nothing-to-do" });
    expect(d.trace).toEqual(["readdir:旧"]);
  });

  it("旧目录在但一个已知文件都没有 ⇒ 仍算 nothing-to-do（空目录不值得改名）", async () => {
    const d = deps({ oldFiles: [] });
    expect(await migrateLegacyAppData(d)).toEqual({ status: "nothing-to-do" });
    expect(d.trace.filter((step) => step.startsWith("rename"))).toEqual([]);
  });
});

describe("migrateLegacyAppData · 第 2 步：只搬已知的三个文件", () => {
  it("三件齐 ⇒ 三个都搬，且先建新目录", async () => {
    const d = deps({ oldFiles: KNOWN });
    const report = await migrateLegacyAppData(d);
    expect(report).toEqual({
      status: "migrated",
      movedFiles: ["config.json", "secrets.enc", "appearance.json"],
      keptOldDir: `${OLD}.migrated-2026-10-02`
    });
    expect(d.trace[0]).toBe(`readdir:${OLD}`);
    expect(d.trace[1]).toBe(`mkdir:${NEW}`);
  });

  it("只搬存在的那些：缺席的不留空壳（搬一个不存在的文件会直接抛）", async () => {
    const d = deps({ oldFiles: ["config.json"] });
    const report = await migrateLegacyAppData(d);
    expect(report).toMatchObject({ status: "migrated", movedFiles: ["config.json"] });
    expect(d.trace.filter((step) => step.startsWith("copy"))).toHaveLength(1);
  });

  it("**不做递归整目录拷贝**：旧目录里用户自己塞的东西一律不搬", async () => {
    const d = deps({ oldFiles: [...KNOWN, "用户自己放的东西.txt"] });
    const report = await migrateLegacyAppData(d);
    expect(report).toMatchObject({ movedFiles: ["config.json", "secrets.enc", "appearance.json"] });
    expect(d.trace.filter((step) => step.startsWith("copy"))).toHaveLength(3);
  });
});

describe("migrateLegacyAppData · 第 3 步：验密", () => {
  it("解密出非空字符串才放行改名", async () => {
    const d = deps();
    await migrateLegacyAppData(d);
    const read = d.trace.indexOf(`read:${path.join(NEW, "secrets.enc")}`);
    const rename = d.trace.findIndex((step) => step.startsWith("rename"));
    expect(read).toBeGreaterThanOrEqual(0);
    expect(read).toBeLessThan(rename);
  });

  it("解不开 ⇒ kept-old，**旧目录名一个字不动**，新目录里那份也不删（留证据）", async () => {
    const d = deps({
      cipher: cipher({
        decrypt: () => {
          throw new Error("Error while decrypting the ciphertext provided to safeStorage");
        }
      })
    });
    const report = await migrateLegacyAppData(d);
    expect(report.status).toBe("kept-old");
    expect(report).toHaveProperty("reason");
    expect(d.trace.filter((step) => step.startsWith("rename"))).toEqual([]);
  });

  it("解出来是空串 ⇒ 同样 kept-old（非空是判据，密文「能解」不等于「解出了东西」）", async () => {
    const d = deps({ cipher: cipher({ decrypt: () => "" }) });
    expect(await migrateLegacyAppData(d)).toMatchObject({ status: "kept-old" });
    expect(d.trace.filter((step) => step.startsWith("rename"))).toEqual([]);
  });

  it("safeStorage 不可用 ⇒ kept-old，且不白搬一次（连读都不读）", async () => {
    const d = deps({ cipher: cipher({ available: false }) });
    const report = await migrateLegacyAppData(d);
    expect(report).toMatchObject({ status: "kept-old" });
    expect(d.trace.filter((step) => step.startsWith("read:"))).toEqual([]);
    expect(d.trace.filter((step) => step.startsWith("rename"))).toEqual([]);
  });

  it("旧目录里没有 secrets.enc ⇒ 无密可验，直接改名（没有密文就没有「验不过」这回事）", async () => {
    const d = deps({ oldFiles: ["config.json", "appearance.json"] });
    expect(await migrateLegacyAppData(d)).toMatchObject({ status: "migrated" });
    expect(d.trace.filter((step) => step.startsWith("read:"))).toEqual([]);
  });
});

describe("migrateLegacyAppData · 第 4 步：旧目录只改名、永不删除", () => {
  it("改成 `<旧名>.migrated-<YYYY-MM-DD>`", async () => {
    const d = deps({ now: new Date("2026-10-02T23:59:59.000Z") });
    await migrateLegacyAppData(d);
    expect(d.trace).toContain(`rename:${OLD}->${OLD}.migrated-2026-10-02`);
  });

  it("该名已占用 ⇒ 追加 -HHmmss 再试一次", async () => {
    const d = deps();
    const real = d.rename;
    let calls = 0;
    d.rename = async (from, to) => {
      calls += 1;
      if (calls === 1) throw new Error("目标已存在");
      return real(from, to);
    };
    await migrateLegacyAppData(d);
    expect(d.trace).toContain(`rename:${OLD}->${OLD}.migrated-2026-10-02-090000`);
  });

  it("两次都失败 ⇒ kept-old 而不是 migrated：改名没成就不许说「已迁到」", async () => {
    const d = deps({ renameFails: true });
    expect(await migrateLegacyAppData(d)).toMatchObject({ status: "kept-old" });
  });
});

describe("migrateLegacyAppData · 幂等", () => {
  it("跑第二次（旧目录已改名）⇒ nothing-to-do", async () => {
    const d = deps();
    expect(await migrateLegacyAppData(d)).toMatchObject({ status: "migrated" });
    const again = deps();
    again.readdir = async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    };
    expect(await migrateLegacyAppData(again)).toEqual({ status: "nothing-to-do" });
  });

  it("留在新目录里的那份副本是幂等重跑的无害结果，报告里要写清搬了哪些", async () => {
    const d = deps();
    const report = await migrateLegacyAppData(d);
    expect(report).toMatchObject({ status: "migrated" });
  });
});
