import path from "node:path";
import { tmpdir } from "node:os";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  APP_DEV_DIR_NAME,
  APP_DIR_NAME,
  appDirNameFor,
  devSeedNotice,
  resolveAppDataDir,
  type DevSeedDeps
} from "./app-dirs.js";

/**
 * 清单第 6 项：开发态与打包版的设置目录分离。
 *
 * 这个文件钉三件事，顺序与重要性一致：
 * ① **只复制，不搬走**——打包版（用户真身）那份目录在开发态第一次启动之后必须还在原地、
 *    还读得到。所以每条用例都断言调用序列里**没有** rename / unlink / rm，
 *    只有 readdir、对开发目录的 mkdir 与 copyFile。
 *    这条判据来自 `app-data-migration.ts` 的同一条铁律：旧目录永远只改名、不删除；
 *    这里更进一步——连改名都不做，因为打包版还在用那个目录，改名等于把别人的家搬走。
 * ② **只搬已知的那几个文件**（复用迁移那份 `MIGRATED_FILES`，不另立第二份清单）。
 * ③ **幂等**：开发目录一旦存在就一个字不碰。用户在开发版里删掉 config.json，
 *    下次启动不许把它从打包版「复活」回来——那样「删掉」这个动作在开发版里等于没发生。
 *
 * 路径一律用 `path.join` 拼（Windows 上是 `\`，写死正斜杠的断言在这台机上永远匹配不上，
 * 那不是通过，是没跑到）。
 */
const APPDATA = path.join("C:", "Users", "me", "AppData", "Roaming");
const PACKAGED = path.join(APPDATA, APP_DIR_NAME);
const DEV = path.join(APPDATA, APP_DEV_DIR_NAME);

/**
 * 假文件系统：只认识用例摆进去的那几个目录，其余一律 ENOENT。
 *
 * `copyFile` 这里**照真 fs 的规矩失败**：目标目录不存在就抛 ENOENT。
 * 这条不是讲究——真 `fs.copyFile` 不会替你建目录，第一版实现就是这么写出了一条
 * 永远不可能成功的复制。桩若宽容，用例就测不到「忘了 mkdir」。
 */
function fsStub(over: {
  /** 目录 → 里面的文件名；目录不在表里 ⇒ readdir 抛 ENOENT。 */
  dirs: Record<string, string[]>;
  /** 让第 N 次 copyFile 抛（从 1 开始数）；不填就全成功。 */
  failCopyAt?: number | undefined;
}): DevFs {
  const calls: string[] = [];
  const known = new Set(Object.keys(over.dirs));
  let copies = 0;
  return {
    calls,
    async readdir(dir) {
      calls.push(`readdir:${dir}`);
      const entries = over.dirs[dir];
      if (entries === undefined) {
        throw Object.assign(new Error(`no such file or directory, scandir '${dir}'`), {
          code: "ENOENT"
        });
      }
      return [...entries];
    },
    async mkdir(dir) {
      calls.push(`mkdir:${dir}`);
      known.add(dir);
    },
    async copyFile(src, dest) {
      copies += 1;
      calls.push(`copy:${src}->${dest}`);
      const destDir = path.dirname(dest);
      if (!known.has(destDir)) {
        throw Object.assign(new Error(`ENOENT: no such file or directory, open '${dest}'`), {
          code: "ENOENT"
        });
      }
      if (over.failCopyAt === copies) {
        throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      }
    }
  };
}

interface DevFs extends Pick<DevSeedDeps, "readdir" | "copyFile" | "mkdir"> {
  calls: string[];
}

function setup(over: {
  isPackaged?: boolean;
  dirs?: Record<string, string[]>;
  failCopyAt?: number;
}): { deps: DevSeedDeps; fs: DevFs } {
  const fs = fsStub({
    dirs: over.dirs ?? {},
    failCopyAt: over.failCopyAt
  });
  return {
    deps: {
      appDataBase: APPDATA,
      isPackaged: over.isPackaged ?? false,
      packagedActiveDir: PACKAGED,
      readdir: fs.readdir,
      copyFile: fs.copyFile,
      mkdir: fs.mkdir
    },
    fs
  };
}

describe("appDirNameFor · 目录名的唯一判据", () => {
  it("打包态 ⇒ 品牌目录 mochen-ai（用户真身那一份）", () => {
    expect(appDirNameFor(true)).toBe("mochen-ai");
  });

  it("非打包态 ⇒ 另一份目录名，绝不与打包态同名", () => {
    expect(appDirNameFor(false)).toBe("mochen-ai-dev");
    expect(appDirNameFor(false)).not.toBe(appDirNameFor(true));
  });

  it("常量与判据同真身：改了名字，判据跟着变，不许在别处写死第二串", () => {
    expect(appDirNameFor(true)).toBe(APP_DIR_NAME);
    expect(appDirNameFor(false)).toBe(APP_DEV_DIR_NAME);
  });
});

describe("resolveAppDataDir · 打包态什么都不动", () => {
  it("打包版 ⇒ 用的就是迁移算出那份目录，且一次 fs 调用都不发", async () => {
    const { deps, fs } = setup({
      isPackaged: true,
      dirs: { [PACKAGED]: ["config.json"], [DEV]: [] }
    });
    const out = await resolveAppDataDir(deps);
    expect(out.dir).toBe(PACKAGED);
    expect(out.seed.status).toBe("packaged");
    // 这条是「打包版永不复制」的反向用例：判据一旦写反，这里就会多出 copy。
    expect(fs.calls).toEqual([]);
  });

  it("打包版即使迁移停在 kept-old，也照旧用旧目录（这条真身不属于本模块）", async () => {
    const legacy = path.join(APPDATA, "mochen-writing");
    const { deps } = setup({ isPackaged: true });
    const out = await resolveAppDataDir({ ...deps, packagedActiveDir: legacy });
    expect(out.dir).toBe(legacy);
  });
});

describe("resolveAppDataDir · 开发态第一次才复制", () => {
  it("开发目录不存在、打包目录有我们的文件 ⇒ 逐个拷进开发目录，源目录一个字不碰", async () => {
    const { deps, fs } = setup({
      dirs: { [PACKAGED]: ["config.json", "appearance.json", "笔记.txt"] }
    });
    const out = await resolveAppDataDir(deps);
    expect(out.dir).toBe(DEV);
    if (out.seed.status !== "seeded") throw new Error(`期望 seeded，实得 ${out.seed.status}`);
    expect(out.seed.copiedFiles).toEqual(["config.json", "appearance.json"]);
    expect(fs.calls).toEqual([
      `readdir:${DEV}`,
      `readdir:${PACKAGED}`,
      // mkdir 只发生在「确实要拷」的这一次：不拷的时候一个字节都不写盘。
      `mkdir:${DEV}`,
      `copy:${path.join(PACKAGED, "config.json")}->${path.join(DEV, "config.json")}`,
      `copy:${path.join(PACKAGED, "appearance.json")}->${path.join(DEV, "appearance.json")}`
    ]);
  });

  it("没有我们的文件可拷 ⇒ 连开发目录都不建：不拷的时候一个字节都不写盘", async () => {
    const { deps, fs } = setup({ dirs: { [PACKAGED]: ["笔记.txt"] } });
    expect((await resolveAppDataDir(deps)).seed.status).toBe("empty-source");
    expect(fs.calls.filter((c) => c.startsWith("mkdir:"))).toEqual([]);
    expect(fs.calls.filter((c) => c.startsWith("copy:"))).toEqual([]);
  });

  it("拷贝方向不许反：目标写进源目录就等于覆写了用户真身那份", async () => {
    const { deps, fs } = setup({ dirs: { [PACKAGED]: ["secrets.enc"] } });
    await resolveAppDataDir(deps);
    const copy = fs.calls.find((c) => c.startsWith("copy:"));
    expect(copy).toBeDefined();
    const [src, dest] = copy!.slice("copy:".length).split("->");
    expect(src).toBe(path.join(PACKAGED, "secrets.enc"));
    expect(dest).toBe(path.join(DEV, "secrets.enc"));
    expect(dest).not.toContain(path.basename(PACKAGED) + path.sep);
  });

  it("开发目录已存在（哪怕是空的）⇒ 一个字不拷：用户在开发版删掉的配置不许被复活", async () => {
    const { deps, fs } = setup({
      dirs: { [PACKAGED]: ["config.json"], [DEV]: [] }
    });
    const out = await resolveAppDataDir(deps);
    expect(out.dir).toBe(DEV);
    expect(out.seed.status).toBe("exists");
    expect(fs.calls.filter((c) => c.startsWith("copy:"))).toEqual([]);
  });

  it("打包目录也不存在 ⇒ 开发版从零开始，不建目录也不拷", async () => {
    const { deps, fs } = setup({ dirs: {} });
    const out = await resolveAppDataDir(deps);
    expect(out.dir).toBe(DEV);
    expect(out.seed.status).toBe("no-source");
    expect(fs.calls.filter((c) => c.startsWith("copy:"))).toEqual([]);
  });

  it("打包目录里只有来历不明的字节 ⇒ 一个都不搬（沿用迁移那条清单）", async () => {
    const { deps, fs } = setup({ dirs: { [PACKAGED]: ["随手放的备份.zip", "笔记.txt"] } });
    const out = await resolveAppDataDir(deps);
    expect(out.seed.status).toBe("empty-source");
    expect(fs.calls.filter((c) => c.startsWith("copy:"))).toEqual([]);
  });

  it("列序跟着已知清单走，不跟着目录里的乱序走", async () => {
    const { deps } = setup({
      dirs: { [PACKAGED]: ["appearance.json", "secrets.enc", "config.json"] }
    });
    const out = await resolveAppDataDir(deps);
    if (out.seed.status !== "seeded") throw new Error("不是 seeded");
    expect(out.seed.copiedFiles).toEqual(["config.json", "secrets.enc", "appearance.json"]);
  });
});

describe("resolveAppDataDir · 复制失败不许变成搬运", () => {
  it("第二个文件拷失败 ⇒ 如实报 copy-failed，已拷的留在开发目录，源目录只被读没被动过", async () => {
    const { deps, fs } = setup({
      dirs: { [PACKAGED]: ["config.json", "secrets.enc", "appearance.json"] },
      failCopyAt: 2
    });
    const out = await resolveAppDataDir(deps);
    expect(out.dir).toBe(DEV);
    if (out.seed.status !== "copy-failed") throw new Error("不是 copy-failed");
    expect(out.seed.copiedFiles).toEqual(["config.json"]);
    expect(out.seed.reason).toContain("secrets.enc");
    expect(out.seed.reason).toContain("EACCES");
    // 全部 fs 动作只有 readdir、对开发目录的 mkdir 与 copyFile：没有改名、没有删除，打包版那份完好。
    expect(
      fs.calls.every(
        (c) => c.startsWith("readdir:") || c.startsWith("mkdir:") || c.startsWith("copy:")
      )
    ).toBe(true);
    expect(fs.calls.some((c) => c.startsWith(`mkdir:${DEV}`))).toBe(true);
  });

  it("读打包目录时不是 ENOENT 的错误 ⇒ 报 source-unreadable 的人话，不许当成「没有配置」", async () => {
    const { deps } = setup({ dirs: {} });
    // 开发目录照常「不存在」（ENOENT 走通到下一步），只有打包目录是盘读不动。
    const out = await resolveAppDataDir({
      ...deps,
      readdir: async (dir) => {
        if (dir === PACKAGED) {
          throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
        }
        throw Object.assign(new Error(`no such file or directory, scandir '${dir}'`), {
          code: "ENOENT"
        });
      }
    });
    expect(out.dir).toBe(DEV);
    expect(out.seed.status).toBe("source-unreadable");
    if (out.seed.status !== "source-unreadable") return;
    expect(out.seed.reason).toContain("EPERM");
  });

  it("认不出开发目录存不存在（readdir 抛非 ENOENT）⇒ 一律不拷：宁可让用户手动配，也不覆写一份说不清状态的目录", async () => {
    const { deps, fs } = setup({ dirs: { [PACKAGED]: ["config.json"] } });
    const out = await resolveAppDataDir({
      ...deps,
      readdir: async (dir) => {
        if (dir === DEV) throw Object.assign(new Error("EPERM: 锁着"), { code: "EPERM" });
        return deps.readdir(dir);
      }
    });
    expect(out.dir).toBe(DEV);
    expect(out.seed.status).toBe("dev-dir-unreadable");
    expect(fs.calls.filter((c) => c.startsWith("copy:"))).toEqual([]);
  });
});

/**
 * 真 fs 那一组：桩里的 `copyFile` 是假的，「目录到底建没建」「字节到底有没有过去」
 * 只有真盘能回答。上一版实现就是靠这组用例才暴露出「忘了 mkdir」——
 * `fs.copyFile` 不会替你创建目标目录，第一次开发启动会当场抛 ENOENT。
 * 临时目录用 `mkdtemp` 开在系统 tmp 里，不碰 `%APPDATA%`：这一组不许动用户真身那份配置。
 */
describe("resolveAppDataDir · 真 fs：第一次开发启动到底落在盘上", () => {
  const KNOWN = ["config.json", "secrets.enc", "appearance.json"];
  const CONTENTS: Record<string, string> = {
    "config.json": '{"connections":[1]}',
    "secrets.enc": "enc:密文",
    "appearance.json": '{"mode":"light"}',
    "笔记.txt": "这个不是我们的字节"
  };

  /** 起一个假的 appData：里面有打包目录，开发目录**不存在**（第一次启动的现场）。 */
  async function fixture(): Promise<{ base: string; packaged: string; dev: string }> {
    const base = await mkdtemp(path.join(tmpdir(), "mochen-app-dirs-"));
    const packaged = path.join(base, APP_DIR_NAME);
    const dev = path.join(base, APP_DEV_DIR_NAME);
    await mkdir(packaged, { recursive: true });
    for (const [name, text] of Object.entries(CONTENTS)) {
      await writeFile(path.join(packaged, name), text, "utf8");
    }
    return { base, packaged, dev };
  }

  /** 真 fs 的三个缝，与 `main/index.ts` 里递进去的那一份同形状。 */
  const realDeps = (base: string, packaged: string) => ({
    appDataBase: base,
    isPackaged: false,
    packagedActiveDir: packaged,
    readdir: async (p: string) => (await readdir(p)) as unknown as string[],
    copyFile: (src: string, dest: string) => copyFile(src, dest),
    // fs/promises 的 mkdir 返回 Promise<string | undefined>（建出来的那一级路径），
    // 这里按缝的形状收成 void：装配层递进去的是同一个写法。
    mkdir: async (p: string) => {
      await mkdir(p, { recursive: true });
    }
  });

  it("开发目录从不存在到存在：三份已知文件逐字拷过去，来历不明的那份不拷", async () => {
    const { base, packaged, dev } = await fixture();
    try {
      const out = await resolveAppDataDir(realDeps(base, packaged));
      expect(out.dir).toBe(dev);
      if (out.seed.status !== "seeded") throw new Error(`实得 ${out.seed.status}`);
      expect(out.seed.copiedFiles).toEqual(KNOWN);
      for (const name of KNOWN) {
        expect(await readFile(path.join(dev, name), "utf8")).toBe(CONTENTS[name]);
      }
      // 来历不明的字节不进会被读取的位置（与迁移同一条规矩）。
      await expect(readFile(path.join(dev, "笔记.txt"), "utf8")).rejects.toThrow();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("源目录原地完好：appData 下面只有那两个名字，没有任何改名产物", async () => {
    const { base, packaged, dev } = await fixture();
    try {
      await resolveAppDataDir(realDeps(base, packaged));
      expect((await readdir(packaged)).sort()).toEqual(Object.keys(CONTENTS).sort());
      for (const name of Object.keys(CONTENTS)) {
        expect(await readFile(path.join(packaged, name), "utf8")).toBe(CONTENTS[name]);
      }
      // 迁移那套会留下 `*.migrated-日期`；这里连一个多余目录都不该有。
      expect((await readdir(base)).sort()).toEqual([APP_DIR_NAME, APP_DEV_DIR_NAME].sort());
      expect(await readdir(dev)).toEqual(expect.arrayContaining(KNOWN));
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("第二次启动不再拷：开发版里改过的配置不会被打包版那一份盖回去", async () => {
    const { base, packaged, dev } = await fixture();
    try {
      await resolveAppDataDir(realDeps(base, packaged));
      const edited = '{"connections":[2]}';
      await writeFile(path.join(dev, "config.json"), edited, "utf8");

      const again = await resolveAppDataDir(realDeps(base, packaged));
      expect(again.seed.status).toBe("exists");
      expect(await readFile(path.join(dev, "config.json"), "utf8")).toBe(edited);
      expect(await readFile(path.join(packaged, "config.json"), "utf8")).toBe(
        CONTENTS["config.json"]
      );
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("打包态跑真 fs ⇒ 一个字节都不新增（不许开发版的判断渗进打包版）", async () => {
    const { base, packaged } = await fixture();
    try {
      const before = (await readdir(base)).sort();
      const out = await resolveAppDataDir({ ...realDeps(base, packaged), isPackaged: true });
      expect(out.dir).toBe(packaged);
      expect(out.seed.status).toBe("packaged");
      expect((await readdir(base)).sort()).toEqual(before);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

describe("devSeedNotice · 搬了就要说出来", () => {
  it("拷过 ⇒ info，说清开发目录、源目录与「互不覆盖」", () => {
    const n = devSeedNotice({ status: "seeded", copiedFiles: ["config.json"] }, DEV, PACKAGED);
    expect(n?.type).toBe("info");
    expect(n?.text).toContain(DEV);
    expect(n?.text).toContain(PACKAGED);
    expect(n?.text).toContain("互不覆盖");
    expect(n?.text).toContain("config.json");
  });

  it("拷失败 ⇒ warning，不许静默", () => {
    const n = devSeedNotice(
      { status: "copy-failed", copiedFiles: [], reason: "secrets.enc 没拷过去：EACCES" },
      DEV,
      PACKAGED
    );
    expect(n?.type).toBe("warning");
    expect(n?.text).toContain("secrets.enc");
  });

  it("读目录读坏了 ⇒ 同样是 warning：读不懂盘的时候必须让用户看见", () => {
    for (const status of ["source-unreadable", "dev-dir-unreadable"] as const) {
      const n = devSeedNotice({ status, reason: "EPERM: 锁着" }, DEV, PACKAGED);
      expect(n?.type).toBe("warning");
      expect(n?.text).toContain("EPERM");
    }
  });

  it("没动过盘的那些状态 ⇒ 不打扰（四处都返回 null）", () => {
    for (const status of ["packaged", "exists", "no-source", "empty-source"] as const) {
      expect(devSeedNotice({ status }, DEV, PACKAGED)).toBeNull();
    }
  });
});

describe("装配层接线：目录判据只有 app-dirs 那一份", () => {
  it("index.ts 的 store 目录来自 resolveAppDataDir，不再自己拼品牌目录名", async () => {
    const src = await readFile(new URL("./index.ts", import.meta.url), "utf8");
    expect(src).toContain("resolveAppDataDir(");
    expect(src).toContain("appDirNameFor(app.isPackaged)");
    // 迁移那条链的目标仍是打包品牌目录：开发态不许把旧品牌目录迁进开发目录，
    // 否则「先跑一次 dev」会把 legacy 吃掉，打包版下次就再也迁不到。
    expect(src).toContain("const newSecretDir = path.join(appDataBase, APP_DIR_NAME)");
    expect(src).not.toContain("path.join(appDataBase, APP_DEV_DIR_NAME)");
  });

  it("装配层把三个 fs 缝都递齐（少一个 mkdir 就是一条永远失败的复制）", async () => {
    const src = await readFile(new URL("./index.ts", import.meta.url), "utf8");
    const call = src.slice(src.indexOf("resolveAppDataDir({"));
    const args = call.slice(0, call.indexOf("});"));
    expect(args).not.toBe("");
    for (const seam of [
      "appDataBase",
      "isPackaged: app.isPackaged",
      "packagedActiveDir",
      "readdir",
      "copyFile",
      "mkdir"
    ]) {
      expect(args).toContain(seam);
    }
  });
});
