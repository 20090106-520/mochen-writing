import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import type { AtomicWriteFs } from "../src/atomic-write.js";
import { makeFingerprint } from "../src/fingerprint.js";
import { writeDocFile } from "../src/read-write.js";
import { normalizeWriteKey, runWriteExclusive } from "../src/write-queue.js";
import { realAtomicFs } from "./atomic-write-fixture.js";

/**
 * 扫描总单 P1-6：同一文稿的并发写必须互斥。
 *
 * 自动保存、手动 Ctrl+S、Agent 批准写盘三路都会并发进 `writeDocFile`，
 * 而「读盘 → 指纹闸 → 备份 → 原子写 → 淘汰」这一段 critical section 原本有间隙。
 * JSONL 侧在 agent-service 里已经用严格串行队列修过同款坑（同文件 131 行注释），
 * 这里把同一口径落到正文侧——**按规范化目标路径排队，不同路径照旧并发**。
 *
 * 断言全部落在**可观测顺序**上（注入 fs 的调用序列、备份文件里的内容），不断言锁对象本身。
 */

async function scratchRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mochen-wq-"));
  await mkdir(path.join(dir, "chapters"), { recursive: true });
  return dir;
}

/** 日志 token 里把临时文件名折回最终名，序列才可比对（tmp 后缀带随机 hex）。 */
function label(target: string): string {
  return path.basename(target).replace(/\.mochen-tmp-[0-9a-f]+$/, "");
}

/**
 * 真 fs 之上加两层观测：每次调用记一条 token，每次 rename 之后按 delayMs 停顿。
 * 停顿是给「没排队」的那次运行留出交错窗口——没有它，竞态窗口太窄，红不红全看运气。
 */
function instrumentedFs(delayMs: number, log: string[]): AtomicWriteFs {
  return {
    writeFile: async (target, data) => {
      log.push(`W:${label(target)}:${data.slice(0, 2)}`);
      await realAtomicFs.writeFile(target, data);
    },
    rename: async (from, to) => {
      log.push(`R:${label(to)}`);
      await realAtomicFs.rename(from, to);
      if (delayMs > 0) await sleep(delayMs);
    },
    unlink: (target) => realAtomicFs.unlink(target),
    mkdir: (dir) => realAtomicFs.mkdir(dir)
  };
}

describe("runWriteExclusive（按 key 串行队列）", () => {
  it("同 key 的两个任务即使并发派发也必须一前一后，不许交错", async () => {
    const log: string[] = [];
    const task = (name: string) => async () => {
      log.push(`${name}:start`);
      await sleep(10);
      log.push(`${name}:end`);
      return name;
    };
    const p1 = runWriteExclusive("k", task("t1"));
    const p2 = runWriteExclusive("k", task("t2"));
    expect(await p1).toBe("t1");
    expect(await p2).toBe("t2");
    expect(log).toEqual(["t1:start", "t1:end", "t2:start", "t2:end"]);
  });

  it("不同 key 必须照旧并发——不许退化成全局串行（1000 章批量写会被拖死）", async () => {
    const order: string[] = [];
    const task = (name: string) => async () => {
      order.push(`${name}:start`);
      await sleep(20);
      order.push(`${name}:end`);
    };
    const p1 = runWriteExclusive("pathA", task("t1"));
    const p2 = runWriteExclusive("pathB", task("t2"));
    await Promise.all([p1, p2]);
    expect(order).toEqual(["t1:start", "t2:start", "t1:end", "t2:end"]);
  });

  it("前一个任务抛错不许把队列锁死：后一个仍要能进", async () => {
    const boom = async () => {
      await sleep(5);
      throw new Error("第一单失败");
    };
    const done: string[] = [];
    const second = async () => {
      done.push("ran");
      return 42;
    };
    const p1 = runWriteExclusive("k", boom);
    // p2 排在 p1 后面：若实现把 release 漏在 catch 之外（没走 finally），p2 会永远等下去。
    const p2 = runWriteExclusive("k", second);
    await expect(p1).rejects.toThrow("第一单失败");
    // 用 race 限时而不是让 vitest 整体超时：死锁要表现为**断言失败**，才咬得住变异。
    const winner = await Promise.race([p2, sleep(500).then(() => "timeout" as const)]);
    expect(winner).toBe(42);
    expect(done).toEqual(["ran"]);
  });

  it("normalizeWriteKey 把同一目标的不同写法折成同一个 key", async () => {
    const dir = await scratchRoot();
    const target = path.join(dir, "chapters", "01.md");
    // path.resolve 折叠分隔符与 `.`；Windows 上再统一大小写（口径同 changes.ts 的 samePath）。
    expect(normalizeWriteKey(target)).toBe(
      normalizeWriteKey(path.join(dir, ".", "chapters", "01.md"))
    );
    if (process.platform === "win32") {
      const flipped = target.charAt(0).toLowerCase() + target.slice(1);
      expect(normalizeWriteKey(flipped)).toBe(normalizeWriteKey(target));
    }
  });
});

describe("writeDocFile 同路径并发写互斥", () => {
  it("两次并发写同一篇：第二次必须等第一次落盘后才读到 onDisk（备份装的是第一次的新稿）", async () => {
    const dir = await scratchRoot();
    await writeFile(path.join(dir, "chapters", "01.md"), "V0\n");
    const log: string[] = [];
    const fs = instrumentedFs(20, log);
    // 模拟两路写手同时进场：第二次写的 expected 是第一次的产物（Agent 基于刚保存的稿子批准覆写）。
    const w1 = writeDocFile(dir, "chapters/01.md", "V1\n", makeFingerprint("V0\n"), null, fs);
    const w2 = writeDocFile(dir, "chapters/01.md", "V2\n", makeFingerprint("V1\n"), null, fs);
    const r1 = await w1;
    const r2 = await w2;
    expect(r1.ok).toBe(true);
    // 没有队列时 w2 在 w1 落盘前就读走了 V0 → 指纹闸判 stale → 这里先红。
    expect(r2.ok).toBe(true);
    if (!r2.ok || r2.backupRelPath === null) throw new Error("不该走到这里");
    // 第二次备份里装的必须是 V1（第一次的新稿）——这是「第二次的 onDisk 读取发生在第一次落盘之后」的直接证据。
    expect(await readFile(path.join(dir, r2.backupRelPath), "utf8")).toBe("V1\n");
    // 调用序列也必须整块分开：w1 的四步全部完成后才轮到 w2 的四步。
    expect(log).toEqual([
      "W:01.md.bak:V0",
      "R:01.md.bak",
      "W:01.md:V1",
      "R:01.md",
      "W:01.md.bak:V1",
      "R:01.md.bak",
      "W:01.md:V2",
      "R:01.md"
    ]);
  });

  it("连点两次 Ctrl+S（同内容同 expected 并发进场）不自撞出假冲突，第二单幂等短路", async () => {
    const dir = await scratchRoot();
    await writeFile(path.join(dir, "chapters", "01.md"), "V0\n");
    const log: string[] = [];
    const fs = instrumentedFs(20, log);
    const fpOld = makeFingerprint("V0\n");
    const w1 = writeDocFile(dir, "chapters/01.md", "V1\n", fpOld, null, fs);
    const w2 = writeDocFile(dir, "chapters/01.md", "V1\n", fpOld, null, fs);
    const r1 = await w1;
    const r2 = await w2;
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r2.ok) throw new Error("不该走到这里");
    // 第二次进场时盘上已是同样的内容 ⇒ 内容未变：不备份、不落盘。
    expect(r2.backupRelPath).toBeNull();
    expect(log).toEqual(["W:01.md.bak:V0", "R:01.md.bak", "W:01.md:V1", "R:01.md"]);
  });

  it("内容与盘上相同的一次写是 no-op：不生成备份，指纹照报", async () => {
    const dir = await scratchRoot();
    await writeFile(path.join(dir, "chapters", "01.md"), "同稿\n");
    const result = await writeDocFile(dir, "chapters/01.md", "同稿\n", makeFingerprint("同稿\n"));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("不该走到这里");
    expect(result.fingerprint).toBe(makeFingerprint("同稿\n"));
    expect(result.backupRelPath).toBeNull();
    expect(existsSync(path.join(dir, ".mochen", "changes"))).toBe(false);
    expect(await readFile(path.join(dir, "chapters", "01.md"), "utf8")).toBe("同稿\n");
  });

  it("同一目标的不同写法（反斜杠 relPath + 盘符大小写不同的 root）必须排进同一条队", async () => {
    const dir = await scratchRoot();
    await writeFile(path.join(dir, "chapters", "01.md"), "V0\n");
    const log: string[] = [];
    const fs = instrumentedFs(20, log);
    // Windows 上盘符大小写不同、分隔符写法不同都指向同一个文件；key 若不规范化就是两条队。
    const altRoot = process.platform === "win32" ? dir.charAt(0).toLowerCase() + dir.slice(1) : dir;
    const w1 = writeDocFile(altRoot, "chapters\\01.md", "V1\n", makeFingerprint("V0\n"), null, fs);
    const w2 = writeDocFile(dir, "chapters/01.md", "V2\n", makeFingerprint("V1\n"), null, fs);
    const r1 = await w1;
    const r2 = await w2;
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r2.ok || r2.backupRelPath === null) throw new Error("不该走到这里");
    expect(await readFile(path.join(dir, r2.backupRelPath), "utf8")).toBe("V1\n");
    expect(log.slice(0, 4)).toEqual(["W:01.md.bak:V0", "R:01.md.bak", "W:01.md:V1", "R:01.md"]);
  });

  it("不同路径仍并发：第二篇不许等第一篇整段落盘才开始", async () => {
    const dir = await scratchRoot();
    await writeFile(path.join(dir, "chapters", "01.md"), "V0\n");
    await writeFile(path.join(dir, "chapters", "02.md"), "U0\n");
    const log: string[] = [];
    const fs = instrumentedFs(30, log);
    const w1 = writeDocFile(dir, "chapters/01.md", "V1\n", makeFingerprint("V0\n"), null, fs);
    const w2 = writeDocFile(dir, "chapters/02.md", "U1\n", makeFingerprint("U0\n"), null, fs);
    const [r1, r2] = await Promise.all([w1, w2]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    // 02 的第一步必须发生在 01 收尾之前：一旦退化成全局串行，这个索引关系立刻翻转。
    const firstB = log.indexOf("W:02.md.bak:U0");
    const lastA = log.lastIndexOf("R:01.md");
    expect(firstB).toBeGreaterThanOrEqual(0);
    expect(lastA).toBeGreaterThanOrEqual(0);
    expect(firstB).toBeLessThan(lastA);
  });

  it("第一次写失败（注入坏 rename）后，第二次仍能正常写、队列不留疤", async () => {
    const dir = await scratchRoot();
    await writeFile(path.join(dir, "chapters", "01.md"), "V0\n");
    const broken: AtomicWriteFs = {
      ...realAtomicFs,
      rename: async () => {
        throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
      }
    };
    const w1 = writeDocFile(dir, "chapters/01.md", "V1\n", makeFingerprint("V0\n"), null, broken);
    const w2 = writeDocFile(
      dir,
      "chapters/01.md",
      "V2\n",
      makeFingerprint("V0\n"),
      null,
      realAtomicFs
    );
    const r1 = await w1;
    // 第二单排在第一单后面：若失败的那一单没把队列交还（release 漏在 finally 之外），这里会一直等下去。
    // 用 race 限时而不是让整条用例挂死——死锁必须表现为断言失败，才咬得住变异。
    const r2 = await Promise.race([w2, sleep(3000).then(() => null)]);
    expect(r2).not.toBeNull();
    if (r2 === null) throw new Error("第二次写没被放行：队列在第一单失败后死锁了");
    expect(r1.ok).toBe(false);
    if (r1.ok) throw new Error("不该走到这里");
    expect(r1.reason).toBe("io-error");
    expect(r2.ok).toBe(true);
    if (!r2.ok) throw new Error("不该走到这里");
    // 第二单读到的 onDisk 仍是 V0（第一单没写成），备份照常、正文换成 V2。
    expect(await readFile(path.join(dir, "chapters", "01.md"), "utf8")).toBe("V2\n");
  });
});
