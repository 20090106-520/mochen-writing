import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeFileAtomic } from "../src/atomic-write.js";
import { fsBrokenAt, realAtomicFs } from "./atomic-write-fixture.js";

/**
 * 这批用例钉的是「半截正文不许留在盘上」这一件事（2026-10-09 全仓扫描 P0-1）。
 *
 * 注入点（`fs` 参数）存在的理由与夹具见 `atomic-write-fixture.ts`：本体要防的失败是「某一步系统调用抛错」，
 * 真文件系统上复现不了，所以注入的是**只坏一步**的假实现，其余一律委托真 fs——
 * 断言的是「真文件到底剩下了什么」，不是「mock 被调用了几次」。
 */
async function scratch(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "mochen-atomic-"));
}

/** 目录里除了预期的文件不许多出任何东西——临时文件没清干净就是泄漏。 */
async function listing(dir: string): Promise<string[]> {
  return (await readdir(dir)).sort();
}

function boom(message: string, code: string): () => Promise<never> {
  return async () => {
    throw Object.assign(new Error(message), { code });
  };
}

describe("writeFileAtomic", () => {
  it("成功时内容落盘且不留临时文件", async () => {
    const dir = await scratch();
    const target = path.join(dir, "01.md");
    await writeFile(target, "旧稿\n", "utf8");

    await writeFileAtomic(target, "新稿\n", realAtomicFs);

    expect(await readFile(target, "utf8")).toBe("新稿\n");
    expect(await listing(dir)).toEqual(["01.md"]);
  });

  it("目标不存在时同样写出内容", async () => {
    const dir = await scratch();
    const target = path.join(dir, "new.md");

    await writeFileAtomic(target, "第一稿\n", realAtomicFs);

    expect(await readFile(target, "utf8")).toBe("第一稿\n");
    expect(await listing(dir)).toEqual(["new.md"]);
  });

  it("父目录不存在时先建出来", async () => {
    const dir = await scratch();
    const target = path.join(dir, "chapters", "01.md");

    await writeFileAtomic(target, "正文\n", realAtomicFs);

    expect(await readFile(target, "utf8")).toBe("正文\n");
    expect(await listing(path.dirname(target))).toEqual(["01.md"]);
  });

  it("写临时文件这一步就失败时，正文保持旧内容且不留残渣", async () => {
    const dir = await scratch();
    const target = path.join(dir, "01.md");
    await writeFile(target, "旧稿\n", "utf8");

    // 坏在「写 tmp」这一步：ENOSPC / 中途强杀最常见的落点。
    await expect(
      writeFileAtomic(
        target,
        "新稿\n",
        fsBrokenAt("writeFile", "ENOSPC: no space left on device", "ENOSPC")
      )
    ).rejects.toThrow(/ENOSPC/);

    expect(await readFile(target, "utf8")).toBe("旧稿\n");
    expect(await listing(dir)).toEqual(["01.md"]);
  });

  it("改名这一步失败时，正文保持旧内容且不留残渣", async () => {
    const dir = await scratch();
    const target = path.join(dir, "01.md");
    await writeFile(target, "旧稿\n", "utf8");

    await expect(
      writeFileAtomic(target, "新稿\n", {
        ...realAtomicFs,
        // Windows 上正文被别的进程占着时，rename 就是这一族错误码。
        rename: boom("EPERM: operation not permitted", "EPERM")
      })
    ).rejects.toThrow(/EPERM/);

    expect(await readFile(target, "utf8")).toBe("旧稿\n");
    expect(await listing(dir)).toEqual(["01.md"]);
  });

  it("清残渣时 unlink 又失败，不许把主错误盖掉", async () => {
    const dir = await scratch();
    const target = path.join(dir, "01.md");
    await writeFile(target, "旧稿\n", "utf8");

    await expect(
      writeFileAtomic(target, "新稿\n", {
        ...realAtomicFs,
        rename: boom("rename 炸了", "EPERM"),
        unlink: boom("unlink 也炸了", "EBUSY")
      })
    ).rejects.toThrow(/rename 炸了/);

    expect(await readFile(target, "utf8")).toBe("旧稿\n");
  });

  it("改名第一次被占、第二次成功 ⇒ 重试写完，盘上不留残渣", async () => {
    const dir = await scratch();
    const target = path.join(dir, "01.md");
    await writeFile(target, "旧稿\n", "utf8");

    // 这就是本机今早实测到的那一档：真 fs 上 50 连写里第 30/49 次 EPERM 在 rename 上
    // （杀软或索引器正拿着这个文件），旧实现直接把它当写失败报出去。
    let attempts = 0;
    await writeFileAtomic(
      target,
      "新稿\n",
      {
        ...realAtomicFs,
        rename: async (from, to) => {
          attempts += 1;
          if (attempts === 1) {
            throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
          }
          await realAtomicFs.rename(from, to);
        }
      },
      { wait: async () => {} }
    );

    expect(attempts).toBe(2);
    expect(await readFile(target, "utf8")).toBe("新稿\n");
    expect(await listing(dir)).toEqual(["01.md"]);
  });

  it("不是「被占着」那一族错误码就不重试：ENOSPC 一次就抛", async () => {
    const dir = await scratch();
    const target = path.join(dir, "01.md");
    await writeFile(target, "旧稿\n", "utf8");

    let attempts = 0;
    await expect(
      writeFileAtomic(
        target,
        "新稿\n",
        {
          ...realAtomicFs,
          rename: async (from, to) => {
            attempts += 1;
            if (attempts === 1) {
              throw Object.assign(new Error("ENOSPC: no space left on device"), {
                code: "ENOSPC"
              });
            }
            await realAtomicFs.rename(from, to);
          }
        },
        { wait: async () => {} }
      )
    ).rejects.toThrow(/ENOSPC/);

    // 反向钉：磁盘满重试一百次也还是满，多试只会把一次保存拖成一串无意义的等待。
    expect(attempts).toBe(1);
    expect(await readFile(target, "utf8")).toBe("旧稿\n");
    expect(await listing(dir)).toEqual(["01.md"]);
  });

  it("占用一直不松：试到上限就抛最近那次原错，并把临时文件清掉", async () => {
    const dir = await scratch();
    const target = path.join(dir, "01.md");
    await writeFile(target, "旧稿\n", "utf8");

    let attempts = 0;
    await expect(
      writeFileAtomic(
        target,
        "新稿\n",
        {
          ...realAtomicFs,
          rename: async () => {
            attempts += 1;
            throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
          }
        },
        // 上限交给用例注入：省得实现里的次数一改，用例就跟着莫名其妙地红。
        { attempts: 4, wait: async () => {} }
      )
    ).rejects.toThrow(/EPERM/);

    expect(attempts).toBe(4);
    expect(await readFile(target, "utf8")).toBe("旧稿\n");
    // 试了四次也只留一份临时文件残渣要清：改名失败不换 tmp 名，清一次就干净。
    expect(await listing(dir)).toEqual(["01.md"]);
  });

  it("连续两次写同一目标都成功（临时文件名不许撞车）", async () => {
    const dir = await scratch();
    const target = path.join(dir, "01.md");

    await writeFileAtomic(target, "第一稿\n", realAtomicFs);
    await writeFileAtomic(target, "第二稿\n", realAtomicFs);

    expect(await readFile(target, "utf8")).toBe("第二稿\n");
    expect(await listing(dir)).toEqual(["01.md"]);
  });
});
