import { describe, expect, it } from "vitest";
import { planDocRelPath, sanitizeDocFileName, windowsReservedNameProblem } from "../src/index.js";

/**
 * 扫描总单 P2-2 的后半：Windows 保留名（2026-10-09 表里点名、前几波没收到的那一条）。
 *
 * `sanitizeDocFileName` 已经挡了 `<>:"/\|?*` 与控制字符，但**没挡保留名**——
 * `CON` / `PRN` / `AUX` / `NUL` / `COM1`-`COM9` / `LPT1`-`LPT9` 在 Windows 上既不能当文件名
 * 也不能当目录名，而且**带扩展名同样算**（`CON.txt` 照样是保留名，这是 Win32 的真实规则，不是想多了）。
 *
 * 本机（win32 + Node 24）实测：`fs.writeFile` 写 `CON.txt` / `nul.md` **不抛错**，文件真落盘、
 * Node 自己还读得回来——也就是说这条病不会给用户任何线索，稿子会以一个 Windows 命名规则不认的
 * 名字躺在书目录里（换台机器、用资源管理器拷贝整本书、或任何走经典 Win32 名字解析的程序一读就出问题）。
 * 所以判定必须长在**命名层**，而且必须**跨平台一律拒**（同一本书迟早被拷回 Windows；CI 是 Linux，
 * 下面所有用例都不带平台开关，两边都要过）。
 *
 * 判定住在 `contracts/src/book.ts` 这一处真身：这条链路本来就是「渲染层用 `planDocRelPath` 先拒、
 * 主进程 `book-service.createDoc` 用同一个 `sanitizeDocFileName` 再兜一遍」的双闸，
 * 保留名跟着加进同一处，不新开第二处（铁律 6）。
 */

/** 全部保留名的**字面清单**（故意写死，不从实现里读——否则实现删掉一条，用例也跟着少一条，等于没钉）。 */
const RESERVED = [
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9"
];

describe("Windows 保留名判定（唯一的真身）", () => {
  it.each(RESERVED)("22 条保留名逐条都挡：%s", (name) => {
    expect(windowsReservedNameProblem(name)).toContain("保留名");
  });

  it("大小写无关（windows 的名字解析就是这样）", () => {
    for (const variant of ["nul", "Nul", "nul", "cOn", "CoM3", "lPt9"]) {
      expect(windowsReservedNameProblem(variant), variant).toContain("保留名");
    }
  });

  it("带扩展名同样是保留名：CON.txt 在 Windows 上也落不了盘", () => {
    for (const variant of ["CON.txt", "nul.md", "AUX.log", "COM1.backup", "LPT9.final.md"]) {
      expect(windowsReservedNameProblem(variant), variant).toContain("保留名");
    }
  });

  it("结尾的圆点与空格会被 Windows 吃掉，所以 CON. 与 NUL  一样是保留名", () => {
    expect(windowsReservedNameProblem("CON.")).toContain("保留名");
    expect(windowsReservedNameProblem("NUL  ")).toContain("保留名");
    expect(windowsReservedNameProblem("nul. ")).toContain("保留名");
  });

  it("路径的每一段都判（目录名同样是保留名，两种分隔符都要认）", () => {
    expect(windowsReservedNameProblem("chapters/CON.md")).toContain("保留名");
    expect(windowsReservedNameProblem("AUX/01.md")).toContain("保留名");
    expect(windowsReservedNameProblem("chapters\\NUL\\01.md")).toContain("保留名");
  });

  it("像保留名但不是的必须放行——挡过头会把合法章节名一起杀掉", () => {
    for (const ok of [
      "CON1",
      "COM0",
      "LPT10",
      "CONFIG.md",
      "AUXILIARY.md",
      "NULL.md",
      "chapter-CON",
      "CON-2.md",
      "第 CON 章",
      "chapters/01-开局.md",
      "characters/李深.md",
      "outline/01.md"
    ]) {
      expect(windowsReservedNameProblem(ok), `${ok} 不是保留名`).toBeNull();
    }
  });

  it("理由里点名是哪一段撞了，用户才不用猜", () => {
    const reason = windowsReservedNameProblem("chapters/NUL.md");
    expect(reason).toContain("NUL.md");
  });
});

describe("命名闸：章节名 / 文档名撞上保留名 ⇒ 起不出路径", () => {
  it("sanitizeDocFileName 对保留名返回 null（和「洗不出名字」同一档，两条闸都认这个 null）", () => {
    expect(sanitizeDocFileName("CON")).toBeNull();
    expect(sanitizeDocFileName("nul.md")).toBeNull();
    expect(sanitizeDocFileName("LPT1")).toBeNull();
  });

  it("sanitizeDocFileName 仍然放行普通标题与含保留名子串的标题", () => {
    expect(sanitizeDocFileName("第 CON 章")).toBe("第 CON 章");
    expect(sanitizeDocFileName("CON 的对面")).toBe("CON 的对面");
    expect(sanitizeDocFileName("深渊之下")).toBe("深渊之下");
  });

  it.each([
    ["chapter", "CON"],
    ["character", "AUX"],
    ["outline", "NUL"]
  ] as const)("planDocRelPath(%s, %s) 不给路径", (kind, title) => {
    expect(planDocRelPath(kind, title)).toBeNull();
  });

  it("普通标题照旧出路径（闸不许把日常新建一章判成失败）", () => {
    expect(planDocRelPath("chapter", "01 开局")).toBe("chapters/01 开局.md");
  });
});
