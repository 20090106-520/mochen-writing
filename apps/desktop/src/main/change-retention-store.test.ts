/**
 * 保留上限的落盘真身（2026-10-06 批次 5-⑧）。
 *
 * 钉的是三件容易出事的事：
 * ① `persisted` 答的是「这份是不是用户自己设的」，不是「解析成功了吗」；
 * ② 存失败时**缓存不许换**——正文已经按旧上限淘汰过了，缓存却换成新值，
 *    下一次自动保存就会按一个盘上并不存在的新上限删东西；
 * ③ 坏值一律退回默认档，不挡启动（与外观同一套错误策略）。
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CHANGE_RETENTION } from "@mochen/contracts";
import { createChangeRetentionStore } from "./change-retention-store.js";

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
