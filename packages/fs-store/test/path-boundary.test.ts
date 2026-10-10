import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultAtomicFs } from "../src/atomic-write.js";
import { createDocFile } from "../src/create.js";
import { readDocFile, writeDocFile } from "../src/read-write.js";
import { makeFingerprint } from "../src/fingerprint.js";
import { assertSafeRelPath, isPathUnderRoot, samePath, type LinkResolver } from "../src/paths.js";

/**
 * 扫描总单 P2-2：路径边界只许一份口径，而且**读写两侧都要有**。
 *
 * 原来仓里是三份：`changes.ts` 里一份 `isUnder`、`skills.ts` 里一份就地写的 realpath 比对、
 * `readDocFile` / `writeDocFile` 一份都没有。第三份是真窟窿——`assertSafeRelPath` 只看路径**写法**，
 * 书目录里放一个指向书外的软链（别人发来的书、从旧盘拷回来的工程目录都会带），
 * 写法逐字合法，打开的却是书外那个文件；保存同样会顺着软链盖写到书外。
 *
 * 软链在 Windows 上要么要管理员要么要开发者模式（本机 `fs.symlink` 直接 EPERM），
 * 所以边界判定把「怎么解真实路径」做成注入点：测试注入一个把目标解到书外的解析器，
 * 拦的是**判定接线**而不是操作系统的软链行为；另有一条用真 realpath 的用例，
 * 证明这道闸在 Windows 临时目录（大小写、8.3 短名）上不会把合法写入误判成越界。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, "..", "src");

async function scratchBook(): Promise<{ root: string; outside: string }> {
  const base = await mkdtemp(path.join(tmpdir(), "mochen-boundary-"));
  const root = path.join(base, "book");
  const outside = path.join(base, "outside");
  await mkdir(path.join(root, "chapters"), { recursive: true });
  await mkdir(outside, { recursive: true });
  return { root, outside };
}

/** 把 `root/chapters/evil.md` 这一个目标解到书外，其余一律原样返回——等价于一个软链。 */
function linkOut(root: string, relPath: string, outsideTarget: string): LinkResolver {
  const affected = path.join(root, ...relPath.split("/"));
  return async (target) => (samePath(target, affected) ? outsideTarget : target);
}

describe("isPathUnderRoot（唯一的边界判定）", () => {
  it("解析结果落在根外就是越界", async () => {
    const { root, outside } = await scratchBook();
    const resolve: LinkResolver = async () => path.join(outside, "secret.txt");
    await expect(
      isPathUnderRoot(path.join(root, "chapters", "01.md"), root, resolve)
    ).resolves.toBe(false);
  });

  it("文件还不存在时改判它的父目录：新建一章不是越界", async () => {
    const { root } = await scratchBook();
    // 解析器只对**存在**的东西回话：新文件解不出，父目录解得出。
    const resolve: LinkResolver = async (target) => {
      if (samePath(target, path.join(root, "chapters", "02.md"))) throw new Error("ENOENT");
      return target;
    };
    await expect(
      isPathUnderRoot(path.join(root, "chapters", "02.md"), root, resolve)
    ).resolves.toBe(true);
  });

  it("父目录也解不出（整棵树都没了）就是读不到，当作越界而不是放行", async () => {
    const { root } = await scratchBook();
    const resolve: LinkResolver = async () => {
      throw new Error("ENOENT");
    };
    await expect(
      isPathUnderRoot(path.join(root, "chapters", "01.md"), root, resolve)
    ).resolves.toBe(false);
  });

  if (process.platform === "win32") {
    it("Windows：真实路径的大小写差异不算越界（临时目录尤其明显）", async () => {
      const { root } = await scratchBook();
      const resolve: LinkResolver = async (target) =>
        target.charAt(0).toLowerCase() + target.slice(1);
      await expect(
        isPathUnderRoot(path.join(root, "chapters", "01.md"), root, resolve)
      ).resolves.toBe(true);
    });

    it("Windows：解析器两边给的只有大小写之差时必须仍判在书内（samePath 的那一层压平就为这一档）", async () => {
      const { root } = await scratchBook();
      // 文稿解成大写、根解成原样：两条串除了大小写逐字相同。
      // 上面那条「首字母小写」的注入挡不住这一档——它两边折的是同一个字母，比的是等值串，
      // 把 samePath 的大小写折叠删掉也不会红；只有这种「两边异构」的注入才测得出压平有没有生效。
      const resolve: LinkResolver = async (target) =>
        target.toLowerCase().includes("chapters") ? target.toUpperCase() : target;
      await expect(
        isPathUnderRoot(path.join(root, "chapters", "01.md"), root, resolve)
      ).resolves.toBe(true);
    });

    /**
     * 本机 win32 + Node 24.21.0 实测（数字都是当场跑出来的，免得下一个人再量一遍）：
     * 生产引的是 `node:fs/promises` 的 `realpath`，它**会**规范化：
     *   `realpath('C:PROGRA~1')` → `C:\Program Files`（8.3 短名展开）
     *   `realpath(小写的书根)` → `...\Temp\mochen-rp-ElSNEj\BookDir`（大小写复原）
     * 而同名的 `fs.realpathSync` **不**规范化（`C:PROGRA~1` 原样回显、小写进小写出）。
     * ⇒ 「8.3 短名与大小写被压平」这件事在真 fs 上是解法本身给的，`samePath` 的折叠是第二层：
     * 注入解析器（造软链那一档）时只剩这一层，所以上面那条用例必须存在。
     * 下面这条用真 fs 钉的是**反向**的风险：合法路径不许被误判成越界（判错比漏判更伤日常）。
     */
    it("Windows：真 fs 上「根小写 / 文稿原样」必须仍判在书内，读盘通路也要认这一条", async () => {
      const { root } = await scratchBook();
      await writeFile(path.join(root, "chapters", "01.md"), "第一章\n", "utf8");
      const target = path.join(root, "chapters", "01.md");
      // 第三个参数省略＝用 paths.ts 里那份真 fs 的解法，不走任何注入。
      await expect(isPathUnderRoot(target, root.toLowerCase())).resolves.toBe(true);
      const read = await readDocFile(root.toLowerCase(), "chapters/01.md");
      expect(read.content).toBe("第一章\n");
    });

    it("samePath：Windows 上大小写是同一个名字，POSIX 上是两个名字（这条压平不许溢出到非 win32）", () => {
      expect(samePath("C:\\Users\\TMP", "c:\\users\\tmp")).toBe(true);
      expect(samePath("C:\\Users\\TMP", "C:\\Users\\TMP2")).toBe(false);
    });
  } else {
    it("samePath：POSIX 上大小写是两个不同的名字，不许压平", () => {
      expect(samePath("/Tmp/A", "/tmp/a")).toBe(false);
      expect(samePath("/tmp/a", "/tmp/a")).toBe(true);
    });
  }
});

describe("读侧：软链文稿不许被当成书内文件读回来", () => {
  it("readDocFile 遇到解析到书外的目标直接报 outside-book，一个字节都不读", async () => {
    const { root, outside } = await scratchBook();
    const secret = path.join(outside, "secret.txt");
    await writeFile(secret, "书外的私人笔记\n", "utf8");
    await writeFile(path.join(root, "chapters", "01.md"), "第一章\n", "utf8");

    await expect(
      readDocFile(root, "chapters/01.md", linkOut(root, "chapters/01.md", secret))
    ).rejects.toThrow(/outside-book/);
  });

  it("正常文稿照读——闸不许把日常打开文件判成越界", async () => {
    const { root } = await scratchBook();
    await writeFile(path.join(root, "chapters", "01.md"), "第一章\n", "utf8");
    const read = await readDocFile(root, "chapters/01.md");
    expect(read.content).toBe("第一章\n");
  });
});

describe("写侧：顺着软链盖写到书外必须被拦下", () => {
  it("writeDocFile 的写入目标解析到书外 ⇒ 报 outside-book，书外那个文件原样不动", async () => {
    const { root, outside } = await scratchBook();
    const victim = path.join(outside, "notes.txt");
    await writeFile(victim, "别的项目的正文，不该被动\n", "utf8");
    await writeFile(path.join(root, "chapters", "01.md"), "第一章\n", "utf8");

    const result = await writeDocFile(
      root,
      "chapters/01.md",
      "改写后的第一章\n",
      (await readDocFile(root, "chapters/01.md")).fingerprint,
      null,
      undefined,
      linkOut(root, "chapters/01.md", victim)
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("越界写入不该成功");
    expect(result.reason).toBe("outside-book");
    expect(await readFile(victim, "utf8")).toBe("别的项目的正文，不该被动\n");
    expect(await readFile(path.join(root, "chapters", "01.md"), "utf8")).toBe("第一章\n");
  });

  it("新建一篇（目标还不存在）用真 realpath 也必须放行：闸不能把 Windows 临时目录判成越界", async () => {
    const { root } = await scratchBook();
    // 新稿的指纹闸口径是「盘上什么都没有 = 空串的指纹」，不是空字符串本身（同 read-write.test.ts）。
    const result = await writeDocFile(root, "chapters/09.md", "新章节\n", makeFingerprint(""));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`真 fs 新建写入被拦了：${JSON.stringify(result)}`);
    expect(await readFile(path.join(root, "chapters", "09.md"), "utf8")).toBe("新章节\n");
  });

  it("覆盖已有文稿用真 realpath 也必须放行", async () => {
    const { root } = await scratchBook();
    await writeFile(path.join(root, "chapters", "03.md"), "旧稿\n", "utf8");
    const read = await readDocFile(root, "chapters/03.md");
    const result = await writeDocFile(root, "chapters/03.md", "新稿\n", read.fingerprint);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`真 fs 覆盖写入被拦了：${JSON.stringify(result)}`);
    expect(await readFile(path.join(root, "chapters", "03.md"), "utf8")).toBe("新稿\n");
  });
});

describe("Windows 保留名（P2-2 的后半）：命名层当场拒，不留到 fs.writeFile 猜", () => {
  /** 本机 win32 + Node 24 实测：`fs.writeFile` 写 `CON.txt` **不抛错**，文件真能落盘。
   *  也就是说这条病全程没有任何报错，稿子会以一个 Windows 命名规则不认的名字躺在书目录里。
   *  所以这一组的重点用例都盯着「盘上到底多没多出这个文件」。 */
  it("assertSafeRelPath 拒 chapters/CON.txt：理由里既有 invalid-path 也点名是哪一段", () => {
    let message = "";
    try {
      assertSafeRelPath("chapters/CON.txt");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toBe("");
    expect(message).toMatch(/invalid-path/);
    expect(message).toContain("保留名");
    expect(message).toContain("CON.txt");
  });

  it("writeDocFile 撞保留名 ⇒ invalid-path，盘上不许多出这个文件（真机不拦，闸只能长在这儿）", async () => {
    const { root } = await scratchBook();
    const result = await writeDocFile(
      root,
      "chapters/CON.txt",
      "第一章\n",
      makeFingerprint(""),
      null,
      // fs 缝给的是「什么都不做也算写过」的实现：一旦判定漏了，盘上就会真长出这个文件，
      // 下面 readdir 那条断言立刻红。
      defaultAtomicFs
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("保留名不该能落盘");
    if (result.reason !== "invalid-path")
      throw new Error(`保留名必须报 invalid-path，实际报了 ${result.reason}`);
    expect(result.message).toContain("保留名");
    expect(await readdir(path.join(root, "chapters"))).not.toContain("CON.txt");
  });

  it("readDocFile 撞保留名 ⇒ 抛的是那句人话，不是 ENOENT", async () => {
    const { root } = await scratchBook();
    let message = "";
    try {
      await readDocFile(root, "chapters/NUL.md");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("保留名");
    expect(message).not.toMatch(/ENOENT/);
  });

  it("createDocFile 撞保留名 ⇒ invalid-path，不建目录也不建文件", async () => {
    const { root } = await scratchBook();
    const result = await createDocFile(root, "chapters/AUX.md", "AUX");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("保留名不该建得出来");
    expect(result.reason).toBe("invalid-path");
    expect(await readdir(path.join(root, "chapters"))).not.toContain("AUX.md");
  });

  it("目录段也算：chapters/LPT1/01.md 这种嵌套保留名一样拒", async () => {
    const { root } = await scratchBook();
    const result = await writeDocFile(
      root,
      "chapters/LPT1/01.md",
      "第一章\n",
      makeFingerprint(""),
      null,
      defaultAtomicFs
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("目录名的保留名不该放行");
    expect(result.reason).toBe("invalid-path");
    expect(await readdir(path.join(root, "chapters"))).not.toContain("LPT1");
  });

  it("像保留名但不是的名字照旧能写能读（CON1 / CONFIG）——闸不许挡过头", async () => {
    const { root } = await scratchBook();
    for (const rel of ["chapters/CON1.md", "chapters/CONFIG.md"]) {
      const result = await writeDocFile(
        root,
        rel,
        "第一章\n",
        makeFingerprint(""),
        null,
        defaultAtomicFs
      );
      expect(result.ok, `${rel} 不是保留名，必须写得进去`).toBe(true);
      expect((await readDocFile(root, rel)).content).toBe("第一章\n");
    }
  });
});

describe("边界判定只许一份实现", () => {
  it("除 paths.ts 之外没人自己写「在根之下」的比对（两份口径迟早不一样，那是比没闸更坏的状态）", () => {
    const owners = readdirSync(srcDir)
      .filter((name) => name.endsWith(".ts"))
      .filter((name) => {
        const body = readFileFromDisk(path.join(srcDir, name));
        return body !== null && body.includes("slice(0, prefix.length)");
      });
    expect(owners).toEqual(["paths.ts"]);
  });

  it("changes.ts 与 skills.ts 都从 paths.js 引这道闸", () => {
    for (const name of ["changes.ts", "skills.ts"]) {
      const body = readFileFromDisk(path.join(srcDir, name)) ?? "";
      expect(body, `${name} 必须 import paths.js`).toMatch(/from "\.\/paths\.js"/);
      expect(body, `${name} 必须调用 isPathUnderRoot`).toContain("isPathUnderRoot(");
    }
  });

  it("保留名判定也只许一份真身：fs 层引 contracts 那一条，谁都不再自己写一张表", () => {
    const body = readFileFromDisk(path.join(srcDir, "paths.ts")) ?? "";
    expect(body, "paths.ts 必须引 contracts 的那条判定").toMatch(
      /windowsReservedNameProblem.*from "@mochen\/contracts"/s
    );
    expect(body, "paths.ts 必须调用它").toContain("windowsReservedNameProblem(");
    // 整包不许有人另起一张保留名表/另写一句保留名文案（那第二份迟早和第一份不一样）。
    const copiers = readdirSync(srcDir)
      .filter((name) => name.endsWith(".ts"))
      .filter((name) => {
        const text = readFileFromDisk(path.join(srcDir, name)) ?? "";
        return /function (isWindowsReserved|windowsReservedNameProblem)/.test(text);
      });
    expect(copiers).toEqual([]);
  });
});

function readFileFromDisk(file: string): string | null {
  try {
    // 同步读：普查用，不参与运行时（readFileSync 从顶部 node:fs 那条 import 进来，
    // 不用 require()——ESLint 的 no-require-imports 在 ESM 测试里会拦）。
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}
