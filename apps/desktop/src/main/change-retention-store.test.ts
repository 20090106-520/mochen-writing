/**
 * 保留上限的落盘真身（2026-10-06 批次 5-⑧）。
 *
 * 钉的是三件容易出事的事：
 * ① `persisted` 答的是「这份是不是用户自己设的」，不是「解析成功了吗」；
 * ② 存失败时**缓存不许换**——正文已经按旧上限淘汰过了，缓存却换成新值，
 *    下一次自动保存就会按一个盘上并不存在的新上限删东西；
 * ③ 坏值一律退回默认档，不挡启动（与外观同一套错误策略）。
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CHANGE_RETENTION } from "@mochen/contracts";
import { createChangeRetentionStore } from "./change-retention-store.js";
import { atomicFsBrokenAt } from "./atomic-write-fs-fixture.js";

let dir = "";

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mochen-retention-store-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const file = () => path.join(dir, "change-retention.json");

describe("没存过时", () => {
  it("回默认档并说清这不是用户设的", async () => {
    const store = createChangeRetentionStore({ dir: path.join(dir, "空目录") });
    const snapshot = await store.read();
    expect(snapshot.persisted).toBe(false);
    expect(snapshot.retention).toEqual(DEFAULT_CHANGE_RETENTION);
    expect(store.current()).toEqual(DEFAULT_CHANGE_RETENTION);
  });
});

describe("存过又读回", () => {
  it("原样回来且 persisted 为真", async () => {
    const store = createChangeRetentionStore({ dir });
    const wanted = { maxCount: 10, maxBytes: 5 * 1024 * 1024 };
    expect(await store.save(wanted)).toEqual(wanted);
    const snapshot = await store.read();
    expect(snapshot.persisted).toBe(true);
    expect(snapshot.retention).toEqual(wanted);
    // current() 必须与盘上一致：写盘淘汰那条路读的是它，不一致就是「界面说一套、盘上做一套」。
    expect(store.current()).toEqual(wanted);
  });

  it("落盘的 JSON 就是这两项，没有夹带别的东西", async () => {
    const raw = JSON.parse(await readFile(file(), "utf8"));
    expect(raw).toEqual({ maxCount: 10, maxBytes: 5 * 1024 * 1024 });
  });
});

describe("盘上那份坏了或被人手改坏", () => {
  it("不是合法 JSON ⇒ 退回默认档，且 persisted 说成 false", async () => {
    await writeFile(file(), "{这不是 JSON", "utf8");
    const store = createChangeRetentionStore({ dir });
    const snapshot = await store.read();
    expect(snapshot.persisted).toBe(false);
    expect(snapshot.retention).toEqual(DEFAULT_CHANGE_RETENTION);
  });

  it('字段类型不对（"很多"）⇒ 夹回默认档，**且 persisted 为 false**', async () => {
    // 这一条最容易漏：JSON 解析成功 ≠ 用户设过。被夹过的值要说成「不是用户设的」，
    // 否则界面上那句「当前这档是墨宸的默认档，不是你设过的」就永远不显形。
    await writeFile(file(), JSON.stringify({ maxCount: "很多", maxBytes: null }), "utf8");
    const store = createChangeRetentionStore({ dir });
    const snapshot = await store.read();
    expect(snapshot.persisted).toBe(false);
    expect(snapshot.retention).toEqual(DEFAULT_CHANGE_RETENTION);
  });

  it("空文件 ⇒ 退回默认档", async () => {
    await writeFile(file(), "   \n", "utf8");
    const store = createChangeRetentionStore({ dir });
    expect((await store.read()).persisted).toBe(false);
  });
});

describe("存的时候", () => {
  it("递进来的坏值被夹住，且回给调用方的是夹完之后那份", async () => {
    const store = createChangeRetentionStore({ dir });
    const saved = await store.save({ maxCount: 0, maxBytes: 10 });
    // 回真值而不是原值：调用方据此更新界面，显示的必须是盘上真存着的那份。
    expect(saved).toEqual(store.current());
    expect(JSON.parse(await readFile(file(), "utf8"))).toEqual(saved);
  });

  it("写盘失败时缓存不换（否则下一次自动保存会按一个不存在的上限删东西）", async () => {
    const store = createChangeRetentionStore({ dir });
    await store.save({ maxCount: 25, maxBytes: 20 * 1024 * 1024 });
    expect(store.current().maxCount).toBe(25);
    // 落盘目标指向一个必然建不出来的路径（NUL 字符在路径里是非法的）。
    const failing = createChangeRetentionStore({ dir: path.join(dir, "坏\0路径") });
    // 先让它成功读过一次，好让「缓存本来有个值」这个前提成立。
    await failing.read();
    await expect(failing.save({ maxCount: 100, maxBytes: 100 * 1024 * 1024 })).rejects.toThrow();
    // 失败之后 current() 仍停在读回来那一份，而不是那个根本没存上的 100。
    expect(failing.current()).toEqual(DEFAULT_CHANGE_RETENTION);
  });
});

/**
 * P0-5 同族（2026-10-09 全仓扫描）：保留上限这份配置也必须原子落盘。
 *
 * 这份文件管的是「写盘时删掉多少用户的历史」，所以它半截特别坏：
 * 截断成 `{ "maxCou` 之后再读就过不了 zod ⇒ 退默认档 ⇒ 用户设的 25 份变成默认的 50 份，
 * 于是**按一个盘上并不存在、用户也没选过的上限开始删改稿历史**。
 * 上一条用例已经钉住「存失败缓存不换」，这里钉的是「失败不许把文件本身弄坏」。
 */
describe("保留上限落盘的原子性（P0-5 同族）", () => {
  it("改名那步失败 ⇒ 盘上仍是原来那一份，且从没直接写过目标文件", async () => {
    const good = createChangeRetentionStore({ dir });
    await good.save({ maxCount: 25, maxBytes: 20 * 1024 * 1024 });
    const before = await readFile(file(), "utf8");

    const broken = atomicFsBrokenAt("rename", "盘满了，写入没完成");
    const store = createChangeRetentionStore({ dir, fs: broken.fs });
    await expect(store.save({ maxCount: 5, maxBytes: 1024 * 1024 })).rejects.toThrow(/盘满/);

    expect(await readFile(file(), "utf8")).toBe(before);
    expect(JSON.parse(before).maxCount).toBe(25);
    expect(broken.writeTargets).toHaveLength(1);
    expect(broken.writeTargets[0]).not.toBe(file());
    // 上限读回来仍是用户设的那一档：半截文件会让它悄悄退回 50，那才是真正删东西的一步。
    expect((await store.read()).retention.maxCount).toBe(25);
    const residue = (await readdir(dir)).filter((name) => name.includes("mochen-tmp"));
    expect(residue).toEqual([]);
  });

  it("写成功时走的是同一条通路：目标只被改名盖住，没被直接写过", async () => {
    const broken = atomicFsBrokenAt("unlink", "不该被用到");
    const store = createChangeRetentionStore({ dir, fs: broken.fs });
    await store.save({ maxCount: 10, maxBytes: 5 * 1024 * 1024 });
    expect(broken.writeTargets).toEqual([expect.stringContaining("mochen-tmp")]);
    expect(broken.renameFrom).toEqual([broken.writeTargets[0]]);
    expect(JSON.parse(await readFile(file(), "utf8")).maxCount).toBe(10);
  });
});
