import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CHANGE_KEEP_PER_DOC,
  listChanges,
  planChangePruning,
  pruneAllChanges,
  pruneChanges,
  readChange,
  restoreChange,
  targetOfBackup
} from "../src/changes.js";
import { makeFingerprint } from "../src/fingerprint.js";
import { writeDocFile } from "../src/read-write.js";
import { fsBrokenAt } from "./atomic-write-fixture.js";
import type { ChangeEntry } from "@mochen/contracts";

/**
 * 改稿历史的读回与回滚。
 *
 * 这条链的价值全在**它不许做的事**上，所以用例的重心是四道守卫：形状、备份 realpath、
 * 目标文稿 realpath、指纹闸。回滚能跑通只是一半——能跑通却能盖掉书外的东西是负分。
 */

let root = "";
let other = "";

const CHAPTER = "chapters/01-开局.md";
const CONTENT_V1 = "第一章\n\n雾从海面涌上来。\n";
const CONTENT_V2 = "第一章\n\n海雾涌上来，铁锈味很冲。\n";

/** 走真写盘造出一条备份——不用手搓目录结构，守卫验的是产品自己写出来的形状。 */
async function approve(content: string, expected: string): Promise<string> {
  const result = await writeDocFile(root, CHAPTER, content, expected);
  if (!result.ok || result.backupRelPath === null) {
    throw new Error(`夹具没造出备份：${JSON.stringify(result)}`);
  }
  return result.backupRelPath;
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "mochen-changes-"));
  other = await mkdtemp(path.join(tmpdir(), "mochen-changes-out-"));
  await mkdir(path.join(root, "chapters"), { recursive: true });
  await writeFile(path.join(root, CHAPTER), CONTENT_V1, "utf8");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(other, { recursive: true, force: true });
});

describe("listChanges", () => {
  it("列出每次改稿，最新在前，并带上当时那篇文稿与体积", async () => {
    const stampA = await approve(CONTENT_V2, makeFingerprint(CONTENT_V1));
    // 第二次改：读回当前指纹再写，制造两条历史
    const cur = await readFile(path.join(root, CHAPTER), "utf8");
    const stampB = await approve(`${CONTENT_V2}再来一句。\n`, makeFingerprint(cur));

    const all = await listChanges(root);
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all[0]!.backupRelPath).toBe(stampB);
    expect(all[1]!.backupRelPath).toBe(stampA);
    for (const entry of all) {
      expect(entry.docRelPath).toBe(CHAPTER);
      expect(entry.backupRelPath.startsWith(".mochen/changes/")).toBe(true);
      expect(entry.bytes).toBeGreaterThan(0);
    }
    // 最新在前：时间戳是定长 ISO 串，倒序即时间序
    expect(all[0]!.stamp >= all[1]!.stamp).toBe(true);
  });

  it("没有改稿历史时是空表，不抛异常", async () => {
    const empty = await mkdtemp(path.join(tmpdir(), "mochen-changes-empty-"));
    expect(await listChanges(empty)).toEqual([]);
    await rm(empty, { recursive: true, force: true });
  });

  it("目录缺失也算空表（第一次写盘之前根本没有 .mochen/changes）", async () => {
    const bare = await mkdtemp(path.join(tmpdir(), "mochen-changes-bare-"));
    expect(await listChanges(bare)).toEqual([]);
    await rm(bare, { recursive: true, force: true });
  });
});

describe("readChange", () => {
  it("读得回备份正文，指纹与它对得上", async () => {
    // 备份里装的是「这一次改之前」的正文，所以断言它等于改前那份，而不是改后。
    const before = await readFile(path.join(root, CHAPTER), "utf8");
    const backup = await approve(`${before}又动了一次。\n`, makeFingerprint(before));
    const read = await readChange(root, backup);
    expect(read.content).toBe(before);
    expect(read.fingerprint).toBe(makeFingerprint(before));
  });

  it("句柄不对时回的是**那一条**对不上的理由，不是一句笼统的拒", async () => {
    // 逐条钉真实理由（原来五条共用 /invalid-path|outside-book/ 一条正则糊过去）：
    // 形状不合法与盘上没有是两件事，混成一句用户就不知道该干什么。
    // 后两条原本也算「形状不对」，其实不是——`<文稿>.bak` 这种文稿名是合法相对路径，
    // 产品只是不会写出这种备份，所以真相由是「盘上没有这一份」。
    const cases: ReadonlyArray<readonly [string, RegExp, string]> = [
      ["chapters/01-开局.md", /invalid-path/, "不是备份"],
      [".mochen/changes/not-a-stamp/chapters/01-开局.md.bak", /invalid-path/, "时间戳目录名不合式"],
      [
        ".mochen/changes/2026-10-05T12-00-00-000Z/chapters/../../evil.md.bak",
        /invalid-path/,
        "想翻出书外"
      ],
      [
        ".mochen/changes/2026-10-05T12-00-00-000Z/01-开局.md.bak",
        /missing-backup/,
        "盘上没有这一份"
      ],
      [
        ".mochen/changes/2026-10-05T12-00-00-000Z/chapters/01-开局.md.bak.bak",
        /missing-backup/,
        "双后缀"
      ]
    ];
    for (const [bad, reason, why] of cases) {
      await expect(readChange(root, bad), why).rejects.toThrow(reason);
    }
  });

  it("读不到的备份回中文错，不把裸 ENOENT 甩到渲染层", async () => {
    const error = await readChange(
      root,
      ".mochen/changes/2026-10-05T12-00-00-000Z/chapters/01-开局.md.bak"
    ).catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/改稿历史里没有这一份备份/);
    expect((error as Error).message).not.toMatch(/ENOENT|no such file/i);
  });

  it("备份句柄解到书外 ⇒ outside-book，且书外那份内容一个字都不读回来", async () => {
    // 上面几条挡的是**写法**；这一条挡的是「写法逐字合法、真实位置在书外」。
    // 本机非开发者模式，fs.symlink 直接 EPERM，所以走 `readChange` 的解析器缝：
    // 注入一个把那条 .bak 解到书外的实现，等价于书目录里躺着一个指向书外的软链。
    const scratch = await mkdtemp(path.join(tmpdir(), "mochen-readlink-"));
    const stamp = "2026-10-05T12-00-00-000Z";
    const bakRel = path.join(".mochen", "changes", stamp, "chapters", "01-开局.md.bak");
    await mkdir(path.join(scratch, path.dirname(bakRel)), { recursive: true });
    await writeFile(path.join(scratch, bakRel), "书内的真备份。", "utf8");
    const outside = path.join(other, "private.bak");
    await writeFile(outside, "书外的私人内容。", "utf8");
    const handle = `.mochen/changes/${stamp}/chapters/01-开局.md.bak`;

    const resolved = path.join(scratch, bakRel);
    const linkOut = async (target: string) => (target === resolved ? outside : target);
    await expect(readChange(scratch, handle, linkOut)).rejects.toThrow(/outside-book/);
    // 逐字合法的那条句柄仍照常读得回——闸不许把日常预览判成越界。
    expect((await readChange(scratch, handle)).content).toBe("书内的真备份。");
    await rm(scratch, { recursive: true, force: true });
  });
});

describe("targetOfBackup", () => {
  it("句柄 → 当初被改的那篇文稿", async () => {
    expect(targetOfBackup(".mochen/changes/2026-10-05T12-00-00-000Z/chapters/a.md.bak")).toBe(
      "chapters/a.md"
    );
  });

  it("形状不对就抛", () => {
    expect(() => targetOfBackup("chapters/a.md")).toThrow(/invalid-path/);
  });
});

describe("restoreChange", () => {
  it("回滚把正文换回备份内容，并给当前内容留一条可再回滚的退路", async () => {
    const before = await readFile(path.join(root, CHAPTER), "utf8");
    const changed = `${before}又被改过一次。\n`;
    const backup = await approve(changed, makeFingerprint(before));
    expect(await readFile(path.join(root, CHAPTER), "utf8")).toBe(changed);

    const result = await restoreChange(root, backup, makeFingerprint(changed));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await readFile(path.join(root, CHAPTER), "utf8")).toBe(before);
    // 回滚本身也存了一份「回滚前」——撤销撤销还能回来
    expect(result.backupRelPath).not.toBeNull();
    const undo = await readChange(root, result.backupRelPath!);
    expect(undo.content).toBe(changed);
  });

  it("写失败时正文一字不变、报 io-error，且不许留下半截备份（P2-1）", async () => {
    const before = await readFile(path.join(root, CHAPTER), "utf8");
    const changed = `${before}又被改过一次。\n`;
    const backup = await approve(changed, makeFingerprint(before));
    expect(await readFile(path.join(root, CHAPTER), "utf8")).toBe(changed);

    // 回滚要动两次盘：先给当前内容存一份 undo 备份，再把正文换回备份内容。
    // 坏在「改名落定」这一步（Windows 上文件被占用就是这一族错误码），两次都不许写成半截。
    const result = await restoreChange(
      root,
      backup,
      makeFingerprint(changed),
      null,
      fsBrokenAt("rename", "EPERM: operation not permitted", "EPERM")
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("改名失败绝不能报称回滚成功了");
    if (result.reason !== "io-error")
      throw new Error(`写失败必须报 io-error，实际报了 ${result.reason}`);
    expect(result.message).toContain("EPERM");
    // 本体：盘上仍是**完整的那一份**，不是半截备份内容。
    expect(await readFile(path.join(root, CHAPTER), "utf8")).toBe(changed);
    const all = ((await readdir(root, { recursive: true })) as string[]).join("|");
    expect(all).not.toContain("mochen-tmp");
  });

  it("指纹对不上（这之后还有人改过）就拒绝，一个字都不盖", async () => {
    const current = await readFile(path.join(root, CHAPTER), "utf8");
    const backup = await approve(`${CONTENT_V1}又又改过一次。\n`, makeFingerprint(current));
    const wrongFingerprint = makeFingerprint("盘上早不是这个内容了");

    const result = await restoreChange(root, backup, wrongFingerprint);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("stale");
    // 拒绝之后正文必须一字未动
    expect(await readFile(path.join(root, CHAPTER), "utf8")).toBe(`${CONTENT_V1}又又改过一次。\n`);
  });

  it("目标文稿被删 ⇒ 报 io-error，不假装成功", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "mochen-restore-gone-"));
    await mkdir(path.join(scratch, "chapters"), { recursive: true });
    await writeFile(path.join(scratch, CHAPTER), CONTENT_V1, "utf8");
    const first = await writeDocFile(scratch, CHAPTER, CONTENT_V2, makeFingerprint(CONTENT_V1));
    if (!first.ok || first.backupRelPath === null) throw new Error("夹具坏了");

    await rm(path.join(scratch, CHAPTER));
    const result = await restoreChange(scratch, first.backupRelPath, makeFingerprint("任意"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("io-error");
    // message 只在「io-error / invalid-path / outside-book」这三档失败上存在，
    // 联合里另一档（stale）没有它——先判 reason 再摸 message，窄化到那一档里取。
    if (result.reason !== "io-error") return;
    expect(result.message).toContain("没有回滚");
    await rm(scratch, { recursive: true, force: true });
  });

  it.skipIf(process.platform === "win32")(
    "目标文稿是指向书外的软链 ⇒ 拒（形状检查看不出来，只有 realpath 看得穿）",
    async () => {
      // Windows 上建**文件**软链要管理员权限或开发者模式，本机 EPERM ⇒ 如实标成 skip 而不是
      // 写一条 `if (win32) return` 的恒绿假用例；同一道守卫在 Windows 上由注入解析器那条用例真跑。
      const scratch = await mkdtemp(path.join(tmpdir(), "mochen-restore-link-"));
      await mkdir(path.join(scratch, "chapters"), { recursive: true });
      await mkdir(path.join(scratch, ".mochen", "changes"), { recursive: true });
      const stamp = "2026-10-05T12-00-00-000Z";
      await mkdir(path.join(scratch, ".mochen", "changes", stamp, "chapters"), { recursive: true });
      await writeFile(
        path.join(scratch, ".mochen", "changes", stamp, "chapters", "01-开局.md.bak"),
        CONTENT_V1,
        "utf8"
      );
      // 库外那个文件绝不能被改
      const victim = path.join(other, "victim.md");
      await writeFile(victim, "库外原文，绝不能被动。", "utf8");
      await symlink(victim, path.join(scratch, "chapters", "01-开局.md"), "file");

      const handle = `.mochen/changes/${stamp}/chapters/01-开局.md.bak`;
      await expect(restoreChange(scratch, handle, makeFingerprint("任意"))).rejects.toThrow(
        /outside-book/
      );
      expect(await readFile(victim, "utf8")).toBe("库外原文，绝不能被动。");
      await rm(scratch, { recursive: true, force: true });
    }
  );

  it("备份区整个是指向书外的 junction ⇒ 拒（用目录链接代文件软链：Windows 不需要管理员权限）", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "mochen-restore-junction-"));
    await mkdir(path.join(scratch, ".mochen", "changes"), { recursive: true });
    await mkdir(path.join(scratch, "chapters"), { recursive: true });
    await writeFile(path.join(scratch, CHAPTER), CONTENT_V1, "utf8");

    // 库外那棵目录，形状与 .mochen/changes/<stamp> 完全一样，但整棵树在书外
    const outsideDir = path.join(other, "outside-stamp");
    await mkdir(path.join(outsideDir, "chapters"), { recursive: true });
    await writeFile(
      path.join(outsideDir, "chapters", "01-开局.md.bak"),
      "书外的备份内容。",
      "utf8"
    );
    const stamp = "2026-10-05T12-00-00-000Z";
    await symlink(outsideDir, path.join(scratch, ".mochen", "changes", stamp), "junction");

    const handle = `.mochen/changes/${stamp}/chapters/01-开局.md.bak`;
    await expect(readChange(scratch, handle)).rejects.toThrow(/outside-book/);
    // 库外那份一个字都没动
    expect(await readFile(path.join(outsideDir, "chapters", "01-开局.md.bak"), "utf8")).toBe(
      "书外的备份内容。"
    );
    await rm(scratch, { recursive: true, force: true });
  });

  it.skipIf(process.platform === "win32")("备份句柄自己是指向书外的软链 ⇒ 拒", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "mochen-restore-badlink-"));
    await mkdir(path.join(scratch, "chapters"), { recursive: true });
    await mkdir(path.join(scratch, ".mochen", "changes", "2026-10-05T12-00-00-000Z", "chapters"), {
      recursive: true
    });
    await writeFile(path.join(scratch, CHAPTER), CONTENT_V1, "utf8");
    const outside = path.join(other, "outside.bak");
    await writeFile(outside, "书外的内容。", "utf8");
    await symlink(
      outside,
      path.join(
        scratch,
        ".mochen",
        "changes",
        "2026-10-05T12-00-00-000Z",
        "chapters",
        "01-开局.md.bak"
      ),
      "file"
    );

    await expect(
      readChange(scratch, ".mochen/changes/2026-10-05T12-00-00-000Z/chapters/01-开局.md.bak")
    ).rejects.toThrow(/outside-book/);
    expect(await readFile(outside, "utf8")).toBe("书外的内容。");
    await rm(scratch, { recursive: true, force: true });
  });
});

/**
 * 保留策略（2026-10-06）。
 *
 * 起因是实测数据：默认 2 秒自动保存档下，打 8 次字就在 `.mochen/changes/` 里长出 8 份整篇备份，
 * 而全仓原本没有任何淘汰。这一段钉的是「多出来的那几份真的被删了、最新的那份永远留着」。
 */
describe("planChangePruning · 该删哪些（纯函数）", () => {
  const mk = (stamp: string, bytes: number, doc = "chapters/a.md"): ChangeEntry => ({
    stamp,
    docRelPath: doc,
    backupRelPath: `.mochen/changes/${stamp}/${doc}.bak`,
    bytes
  });
  /** 最新在前，与 listChanges 的序一致。 */
  const seq = (n: number, bytes = 100): ChangeEntry[] =>
    Array.from({ length: n }, (_, i) =>
      mk(`2026-10-05T12-00-0${i % 10}-${String(i).padStart(3, "0")}Z`, bytes)
    );

  it("不越线时一条都不删（保留策略不许动没超的东西）", () => {
    expect(planChangePruning(seq(10), { maxCount: 50, maxBytes: 1024 * 1024 })).toEqual([]);
  });

  it("份数越线 ⇒ 删最旧的，且保留最新的那条", () => {
    const entries = seq(12);
    const drop = planChangePruning(entries, { maxCount: 5, maxBytes: 1024 * 1024 });
    expect(drop).toHaveLength(7);
    // 删掉的应该是最旧那 7 条：保留的是数组的前 5 条
    expect(drop.map((e) => e.backupRelPath)).toEqual(entries.slice(5).map((e) => e.backupRelPath));
    // 最新那条（数组第 0 个）绝不能进删除名单
    expect(drop.map((e) => e.backupRelPath)).not.toContain(entries[0]!.backupRelPath);
  });

  it("字节越线 ⇒ 从最旧的开始删到落回上限内（长文靠这条）", () => {
    const entries = seq(10, 100); // 共 1000 字节
    const drop = planChangePruning(entries, { maxCount: 50, maxBytes: 550 });
    // 留 5 条（500 字节）后，第 6 条会把 600 > 550 ⇒ 后面全删
    expect(drop).toHaveLength(5);
    expect(1000 - 100 * 5).toBe(500);
  });

  it("两条是「或」：份数与字节任一越线就开始删（短文走份数，长文走字节）", () => {
    const small = seq(60, 10); // 600 字节：条数越线
    expect(planChangePruning(small, { maxCount: 50, maxBytes: 1024 })).toHaveLength(10);
    const big = seq(10, 1000); // 10 条 10KB：字节越线
    expect(planChangePruning(big, { maxCount: 50, maxBytes: 2500 })).toHaveLength(8);
  });

  it("单份就超过字节上限时仍至少留一份（删光等于没有回滚，比多占盘更糟）", () => {
    const entries = seq(3, 5000); // 上限只够一条
    const drop = planChangePruning(entries, { maxCount: 50, maxBytes: 100 });
    expect(drop).toHaveLength(2);
    expect(drop.map((e) => e.backupRelPath)).not.toContain(entries[0]!.backupRelPath);
  });

  it("不改调用方传进来的数组（纯函数不许有副作用）", () => {
    const entries = seq(10);
    const before = entries.map((e) => e.backupRelPath);
    planChangePruning(entries, { maxCount: 2, maxBytes: 1024 });
    expect(entries.map((e) => e.backupRelPath)).toEqual(before);
  });

  it("空表与上限为 0 都不炸（上限 0 仍留一条：那是刚刚写下的那份）", () => {
    expect(planChangePruning([], { maxCount: 0, maxBytes: 0 })).toEqual([]);
    const entries = seq(4);
    expect(planChangePruning(entries, { maxCount: 0, maxBytes: 0 })).toHaveLength(3);
  });
});

describe("pruneChanges · 真的把盘上多出来的删掉", () => {
  it("写盘超过上限 ⇒ 盘上条数收敛到上限，最新那条还在", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "mochen-prune-"));
    await mkdir(path.join(scratch, "chapters"), { recursive: true });
    await writeFile(path.join(scratch, CHAPTER), "0", "utf8");
    try {
      // 刻意跑够 `CHANGE_KEEP_PER_DOC + 5` 次：这条验的是**写盘链路上真的挂着淘汰**，
      // 用的就是产品默认的那个上限，不是测试自己塞进去的小数字。
      let content = "0";
      for (let i = 1; i <= CHANGE_KEEP_PER_DOC + 5; i++) {
        const next = `${content}-${i}`;
        const r = await writeDocFile(scratch, CHAPTER, next, makeFingerprint(content));
        if (!r.ok) throw new Error(`第${i}次写盘失败：${JSON.stringify(r)}`);
        content = next;
      }
      const all = await listChanges(scratch);
      expect(all.length).toBeLessThanOrEqual(CHANGE_KEEP_PER_DOC);
      // 没白存：真的省下来了，不是「删到只剩 0 条」
      expect(all.length).toBeGreaterThan(1);
      // 最新那条就是最后一次写盘存下来的那份（内容是倒数第二轮的正文）
      expect(await readChange(scratch, all[0]!.backupRelPath)).toBeTruthy();
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("淘汰过的盘上，最新的那份仍读得出内容（不能把回滚的最后一条也删了）", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "mochen-prune-keep-"));
    await mkdir(path.join(scratch, "chapters"), { recursive: true });
    await writeFile(path.join(scratch, CHAPTER), "初稿", "utf8");
    try {
      let content = "初稿";
      for (let i = 1; i <= 6; i++) {
        const next = `${content}·改${i}`;
        await writeDocFile(scratch, CHAPTER, next, makeFingerprint(content));
        content = next;
      }
      const all = await listChanges(scratch);
      const newest = await readChange(scratch, all[0]!.backupRelPath);
      expect(newest.content.length).toBeGreaterThan(0);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("保留上限内的盘：一个字节都不许动（不越线时 prune 是纯 no-op）", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "mochen-prune-noop-"));
    await mkdir(path.join(scratch, "chapters"), { recursive: true });
    await writeFile(path.join(scratch, CHAPTER), "0", "utf8");
    try {
      const r1 = await writeDocFile(scratch, CHAPTER, "1", makeFingerprint("0"));
      if (!r1.ok) throw new Error("夹具坏了");
      const before = await listChanges(scratch);
      const removed = await pruneChanges(scratch, before, { maxCount: 50, maxBytes: 1024 * 1024 });
      expect(removed).toBe(0);
      expect(await listChanges(scratch)).toHaveLength(before.length);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("删空的时间戳目录连里面的空子目录一起收掉（否则空壳会越积越多）", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "mochen-prune-empty-"));
    await mkdir(path.join(scratch, "chapters"), { recursive: true });
    await writeFile(path.join(scratch, CHAPTER), "0", "utf8");
    try {
      let content = "0";
      for (let i = 1; i <= 4; i++) {
        const next = `${content}·${i}`;
        const r = await writeDocFile(scratch, CHAPTER, next, makeFingerprint(content));
        if (!r.ok) throw new Error("夹具坏了");
        content = next;
      }
      const before = await listChanges(scratch);
      expect(before.length).toBeGreaterThan(1);
      const removed = await pruneChanges(scratch, before, { maxCount: 1, maxBytes: 1024 * 1024 });
      expect(removed).toBe(before.length - 1);

      // **递归判空**：备份路径是 `<stamp>/chapters/01.md.bak`，删掉 .bak 之后 stamp 里还剩 `chapters/`。
      // 只看一层的写法（`readdir(stamp).length === 0`）会把这些空壳全留下——真机实测就是这样：
      // 删到 50 份时盘上留着 61 个时间戳目录，多出来的 11 个全是空壳。
      // 这里数的是「整个 changes 树底下还剩几个文件」，不是「几个目录」。
      const changesRoot = path.join(scratch, ".mochen", "changes");
      let filesLeft = 0;
      let stampsLeft = 0;
      for (const s of await readdir(changesRoot, { withFileTypes: true })) {
        if (!s.isDirectory()) continue;
        stampsLeft += 1;
        const walk = async (dir: string): Promise<void> => {
          for (const e of await readdir(dir, { withFileTypes: true })) {
            if (e.isDirectory()) await walk(path.join(dir, e.name));
            else filesLeft += 1;
          }
        };
        await walk(path.join(changesRoot, s.name));
      }
      // 留下的文件数必须等于留下的备份数：目录数不该比文件数多（多出来的就是空壳）
      expect(filesLeft).toBe(before.length - removed);
      expect(stampsLeft).toBe(filesLeft);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});

/**
 * 保留上限从「写死」变成「可配」之后仍要守住的那几条（2026-10-06 批次 5-⑧）。
 *
 * 5-⑦ 的守卫只验了默认档下的收敛；这一段验的是**传进来的上限真的被用上了**，
 * 以及坏值不会被当成 0（0 会让判定「全删光」，那是数据损失）。
 */
describe("可配的保留上限", () => {
  it("传进来的上限真的生效（传 10 份就只留 10 份，不是还在留 13）", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "mochen-retention-cfg-"));
    await mkdir(path.join(scratch, "chapters"), { recursive: true });
    await writeFile(path.join(scratch, CHAPTER), "0", "utf8");
    try {
      // 写 13 次、上限 10 份。**10 是允许范围的下界**（contracts 的 CHANGE_RETENTION_COUNT_MIN，
      // 与设置页那份档位表同下界）——更小的数会被夹回下界而不是照办，
      // 所以想验「上限真的被用上」必须用范围内的值。
      let content = "0";
      for (let i = 1; i <= 13; i++) {
        const next = `${content}-${i}`;
        const r = await writeDocFile(scratch, CHAPTER, next, makeFingerprint(content), {
          maxCount: 10,
          maxBytes: 1024 * 1024 * 1024
        });
        if (!r.ok) throw new Error(`第${i}次写盘失败：${JSON.stringify(r)}`);
        content = next;
      }
      const all = await listChanges(scratch);
      expect(all.length).toBe(10);
      // 最新那条还在（传 10 不是传 0）
      expect(await readChange(scratch, all[0]!.backupRelPath)).toBeTruthy();
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("不传上限时用默认档（50 份），不是用 0 也不是用 1", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "mochen-retention-default-"));
    await mkdir(path.join(scratch, "chapters"), { recursive: true });
    await writeFile(path.join(scratch, CHAPTER), "0", "utf8");
    try {
      let content = "0";
      for (let i = 1; i <= 6; i++) {
        const next = `${content}-${i}`;
        await writeDocFile(scratch, CHAPTER, next, makeFingerprint(content));
        content = next;
      }
      // 6 份远小于默认 50 ⇒ 一条都不该删。这一条是「不传 = 行为一字不变」的证据。
      expect(await listChanges(scratch)).toHaveLength(6);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("上限传坏值（0 / 负数 / NaN）⇒ 退回默认档，**不删光**", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "mochen-retention-bad-"));
    await mkdir(path.join(scratch, "chapters"), { recursive: true });
    await writeFile(path.join(scratch, CHAPTER), "0", "utf8");
    try {
      let content = "0";
      for (let i = 1; i <= 4; i++) {
        const next = `${content}-${i}`;
        // 传 0 是最危险的一种：若照单全收，planChangePruning 会判定「全删光」。
        await writeDocFile(scratch, CHAPTER, next, makeFingerprint(content), {
          maxCount: 0,
          maxBytes: 0
        });
        content = next;
      }
      expect(await listChanges(scratch)).toHaveLength(4);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("回滚那条路也认这份上限（否则「回滚攒出一堆回滚」又绕过去了）", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "mochen-retention-restore-"));
    await mkdir(path.join(scratch, "chapters"), { recursive: true });
    await writeFile(path.join(scratch, CHAPTER), "初稿", "utf8");
    try {
      let content = "初稿";
      let lastBackup = "";
      for (let i = 1; i <= 5; i++) {
        const next = `${content}·改${i}`;
        const r = await writeDocFile(scratch, CHAPTER, next, makeFingerprint(content), {
          maxCount: 10,
          maxBytes: 1024 * 1024 * 1024
        });
        if (!r.ok || r.backupRelPath === null) throw new Error("夹具坏了");
        lastBackup = r.backupRelPath;
        content = next;
      }
      // 连着回滚几次：每回滚一次也存一份，但同样受「只留 10 份」约束（10 = 允许范围的下界）。
      for (let i = 0; i < 6; i++) {
        const cur = await readFile(path.join(scratch, CHAPTER), "utf8");
        const r = await restoreChange(scratch, lastBackup, makeFingerprint(cur), {
          maxCount: 10,
          maxBytes: 1024 * 1024 * 1024
        });
        if (!r.ok || r.backupRelPath === null) throw new Error("回滚失败");
        lastBackup = r.backupRelPath;
      }
      // 5 次写盘 + 6 次回滚 = 一共 11 份备份，收口后必须只剩 10 份：
      // 漏掉回滚这条路上限就等于上限不存在。
      expect((await listChanges(scratch)).length).toBeLessThanOrEqual(10);
      expect((await listChanges(scratch)).length).toBe(10);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});

describe("pruneAllChanges · 立即清理（设置页那个按钮）", () => {
  it("按当前上限清一遍整本书，回真删了几条、剩几条、腾了多少", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "mochen-prune-all-"));
    await mkdir(path.join(scratch, "chapters"), { recursive: true });
    await writeFile(path.join(scratch, CHAPTER), "0", "utf8");
    try {
      // 先攒到 5 份（默认 50 不会动手）
      let content = "0";
      for (let i = 1; i <= 5; i++) {
        const next = `${content}-${i}`;
        await writeDocFile(scratch, CHAPTER, next, makeFingerprint(content));
        content = next;
      }
      expect(await listChanges(scratch)).toHaveLength(5);

      const report = await pruneAllChanges(scratch, { maxCount: 2, maxBytes: 1024 * 1024 });
      expect(report.removed).toBe(3);
      expect(report.kept).toBe(2);
      expect(report.freedBytes).toBeGreaterThan(0);
      expect(report.keptBytes).toBeGreaterThan(0);
      expect(report.keptBytes + report.freedBytes).toBe(
        // 剩下的 + 删掉的 = 清理前的总字节（没有读失败、没有部分删除）
        (await listChanges(scratch)).reduce((s, e) => s + e.bytes, 0) + report.freedBytes
      );
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("本来就在上限内 ⇒ removed 为 0（界面要能说「没什么可清的」）", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "mochen-prune-none-"));
    await mkdir(path.join(scratch, "chapters"), { recursive: true });
    await writeFile(path.join(scratch, CHAPTER), "0", "utf8");
    try {
      const r = await writeDocFile(scratch, CHAPTER, "1", makeFingerprint("0"));
      if (!r.ok) throw new Error("夹具坏了");
      const report = await pruneAllChanges(scratch, { maxCount: 50, maxBytes: 1024 * 1024 });
      expect(report.removed).toBe(0);
      expect(report.kept).toBe(1);
      expect(report.freedBytes).toBe(0);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("空书目录 ⇒ 全 0，不抛", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "mochen-prune-bare-"));
    try {
      expect(await pruneAllChanges(scratch, { maxCount: 50, maxBytes: 1024 * 1024 })).toEqual({
        removed: 0,
        kept: 0,
        freedBytes: 0,
        keptBytes: 0
      });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("**按篇分别算**：一章超限不牵连另一章的回滚点", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "mochen-prune-perdoc-"));
    await mkdir(path.join(scratch, "chapters"), { recursive: true });
    const other = "chapters/第二章.md";
    await writeFile(path.join(scratch, CHAPTER), "0", "utf8");
    await writeFile(path.join(scratch, other), "0", "utf8");
    try {
      // 第一章攒 5 份，第二章只攒 2 份
      let a = "0";
      for (let i = 1; i <= 5; i++) {
        const next = `${a}-${i}`;
        await writeDocFile(scratch, CHAPTER, next, makeFingerprint(a));
        a = next;
      }
      let b = "0";
      for (let i = 1; i <= 2; i++) {
        const next = `${b}-${i}`;
        await writeDocFile(scratch, other, next, makeFingerprint(b));
        b = next;
      }
      await pruneAllChanges(scratch, { maxCount: 3, maxBytes: 1024 * 1024 });
      const after = await listChanges(scratch);
      expect(after.filter((e) => e.docRelPath === CHAPTER)).toHaveLength(3);
      // 第二章只有 2 份，本来就没越线，一条都不该被牵连
      expect(after.filter((e) => e.docRelPath === other)).toHaveLength(2);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
