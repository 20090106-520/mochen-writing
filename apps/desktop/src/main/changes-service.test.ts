import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CHANGE_RETENTION, IPC_CHANNELS, type ChangeEntry } from "@mochen/contracts";
import { listChanges, makeFingerprint, writeDocFile } from "@mochen/fs-store";
import { createChangesService, registerChangesIpc } from "./changes-service.js";
import type { ChangeRetentionStore } from "./change-retention-store.js";

/**
 * 改稿历史的主进程真身。
 *
 * 这一层只钉三件事：没开书时的语义（list 给空表，read/restore 给中文）、
 * 通道一条不多一条不少、以及**回滚那条必须把指纹原样透下去**——
 * 守卫在 fs-store 那边，主进程要是把实参吞了或改了，闸就形同虚设。
 *
 * 2026-10-06 批次 5-⑧ 追加：保留上限三枚走的是同一片领域，所以通道白名单从 3 条变 5 条；
 * 多出来的两条不许在别处注册——同一片领域散在两个注册函数里，下次加通道的人只看见一个。
 */

let root = "";
let open = true;
/** 存的那份上限：这组用例要能改它，才能验「上限真的按用户设的来」。 */
let retention: { maxCount: number; maxBytes: number } = { ...DEFAULT_CHANGE_RETENTION };
const handlers = new Map<string, (...args: unknown[]) => unknown>();
const handle = (channel: string, fn: (...args: unknown[]) => unknown): void => {
  handlers.set(channel, fn);
};

/** 落盘那一侧换成极简实现即可：这一组验的是**编排**（谁读、谁传、谁拦），不是落盘。 */
const retentionStore = (): ChangeRetentionStore => ({
  read: async () => ({ persisted: true, retention: { ...retention } }),
  current: () => ({ ...retention }),
  save: async (next) => {
    retention = { ...next };
    return { ...retention };
  }
});

const CHAPTER = "chapters/01-开局.md";
const V1 = "第一章\n\n雾从海面涌上来。\n";
const V2 = "第一章\n\n海雾涌上来，铁锈味很冲。\n";

const service = () =>
  createChangesService({ bookRoot: () => (open ? root : null), retention: retentionStore() });

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mochen-changes-svc-"));
  open = true;
  retention = { ...DEFAULT_CHANGE_RETENTION };
  handlers.clear();
  await mkdir(path.join(root, "chapters"), { recursive: true });
  await writeFile(path.join(root, CHAPTER), V1, "utf8");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("没打开作品目录", () => {
  it("list 给空表而不是抛：面板刚开、书还没选那一阵本来就没什么可说", async () => {
    open = false;
    expect(await service().list()).toEqual([]);
  });

  it("read / restore 都给中文，且说清是「没开书」而不是别的错", async () => {
    open = false;
    await expect(service().read(".mochen/changes/x/chapters/a.md.bak")).rejects.toThrow(
      /还没打开作品目录/
    );
    await expect(service().restore(".mochen/changes/x/chapters/a.md.bak", "fp")).rejects.toThrow(
      /还没打开作品目录/
    );
  });
});

describe("通路", () => {
  it("写一次盘就能列出那条历史（走真写盘，不用手搓目录）", async () => {
    const written = await writeDocFile(root, CHAPTER, V2, makeFingerprint(V1));
    if (!written.ok || written.backupRelPath === null) throw new Error("夹具没造出备份");

    const list = await service().list();
    expect(list).toHaveLength(1);
    const entry = list[0] as ChangeEntry;
    expect(entry.backupRelPath).toBe(written.backupRelPath);
    expect(entry.docRelPath).toBe(CHAPTER);
    // 备份里装的是「改前」那份
    expect((await service().read(entry.backupRelPath)).content).toBe(V1);
  });

  it("restore 把正文换回去", async () => {
    const written = await writeDocFile(root, CHAPTER, V2, makeFingerprint(V1));
    if (!written.ok || written.backupRelPath === null) throw new Error("夹具没造出备份");

    const result = await service().restore(written.backupRelPath, makeFingerprint(V2));
    expect(result.ok).toBe(true);
    expect(await readFile(path.join(root, CHAPTER), "utf8")).toBe(V1);
  });

  it("restore 的指纹闸在主进程这一侧也生效（实参原样透到 fs-store）", async () => {
    const written = await writeDocFile(root, CHAPTER, V2, makeFingerprint(V1));
    if (!written.ok || written.backupRelPath === null) throw new Error("夹具没造出备份");

    // 传一个错的指纹 ⇒ 必须 stale，正文一个字不动
    const result = await service().restore(written.backupRelPath, makeFingerprint("对不上"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("stale");
    expect(await readFile(path.join(root, CHAPTER), "utf8")).toBe(V2);
  });
});

describe("保留上限三枚（2026-10-06 批次 5-⑧）", () => {
  /** 攒出 8 份备份。写入那一轮把上限挂在 10（够宽），保证**攒的阶段一条都不被删**。 */
  async function seedEight(): Promise<void> {
    let content = V1;
    for (let i = 1; i <= 8; i++) {
      const next = `${content}-${i}`;
      const r = await writeDocFile(root, CHAPTER, next, makeFingerprint(content), {
        maxCount: 10,
        maxBytes: 1024 * 1024 * 1024
      });
      if (!r.ok) throw new Error(`第 ${i} 次写盘失败`);
      content = next;
    }
    expect(await listChanges(root)).toHaveLength(8);
  }

  it("pruneNow 按**当前存着的那份**上限清，不按默认档", async () => {
    await seedEight();
    // 上限存成 5（默认档是 50，那样一条都不会删）。存进 store，而不是递给 pruneNow：
    // 通道上根本没有这个实参——这就是「上限只有一份」的意思。
    await service().retentionSave({ maxCount: 5, maxBytes: 5 * 1024 * 1024 });
    const report = await service().pruneNow();
    expect(report.removed).toBe(3);
    expect(report.kept).toBe(5);
    expect(report.freedBytes).toBeGreaterThan(0);
    expect(report.keptBytes).toBeGreaterThan(0);
    expect(await listChanges(root)).toHaveLength(5);
  });

  it("上限宽于现状时清掉 0 条，但仍报得出还剩多少（不是一句没有信息的「已清理」）", async () => {
    await seedEight();
    await service().retentionSave({ maxCount: 10, maxBytes: 5 * 1024 * 1024 });
    const report = await service().pruneNow();
    expect(report.removed).toBe(0);
    expect(report.kept).toBe(8);
    expect(report.keptBytes).toBeGreaterThan(0);
    expect(await listChanges(root)).toHaveLength(8);
  });

  it("没开书时 pruneNow **抛中文**而不是回一份「清掉 0 条」", async () => {
    open = false;
    // 回 removed:0 会被界面显示成「已清理，删掉 0 条」——用户以为刚才是白按了一次。
    await expect(service().pruneNow()).rejects.toThrow("还没打开作品目录");
  });

  it("retentionGet 原样回 store 那份（含 persisted 标志）", async () => {
    expect(await service().retentionGet()).toEqual({
      persisted: true,
      retention: DEFAULT_CHANGE_RETENTION
    });
  });

  it("retentionSave 把值交给 store 落盘，并回它存下的那一份", async () => {
    const saved = await service().retentionSave({ maxCount: 10, maxBytes: 5 * 1024 * 1024 });
    expect(saved).toEqual({ maxCount: 10, maxBytes: 5 * 1024 * 1024 });
    expect(retention).toEqual(saved);
  });
});

describe("registerChangesIpc", () => {
  it("只注册白名单里的五条，一条不多一条不少", () => {
    registerChangesIpc(handle, service());
    expect([...handlers.keys()].sort()).toEqual(
      [
        IPC_CHANNELS.changesList,
        IPC_CHANNELS.changesRead,
        IPC_CHANNELS.changesRestore,
        IPC_CHANNELS.changesRetentionGet,
        IPC_CHANNELS.changesRetentionSave,
        IPC_CHANNELS.changesPruneNow
      ].sort()
    );
  });

  it("read / restore 的实参按位置原样出网（句柄、指纹都不能被吞掉）", async () => {
    registerChangesIpc(handle, service());
    const written = await writeDocFile(root, CHAPTER, V2, makeFingerprint(V1));
    if (!written.ok || written.backupRelPath === null) throw new Error("夹具没造出备份");

    const readBack = (await handlers.get(IPC_CHANNELS.changesRead)?.(
      {},
      written.backupRelPath
    )) as {
      content: string;
    };
    expect(readBack.content).toBe(V1);

    const restored = (await handlers.get(IPC_CHANNELS.changesRestore)?.(
      {},
      written.backupRelPath,
      makeFingerprint(V2)
    )) as { ok: boolean };
    expect(restored.ok).toBe(true);
    expect(await readFile(path.join(root, CHAPTER), "utf8")).toBe(V1);
  });
});
