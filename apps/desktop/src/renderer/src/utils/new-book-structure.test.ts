/**
 * 「建好之后目录里长什么样」这张表不许漂（2026-11-20 新建作品智能刀）。
 *
 * 对话框里那张表是**写给用户看的承诺**：它说建完会得到什么。
 * 如果它跟主进程真正建出来的东西对不上，那不是文案不好，是**假话**——
 * 用户按它准备好的目录结构到时候找不到。
 *
 * ⇒ 这一份直接对着 fs-store 的真身逐条核：
 *  ① `packages/fs-store/src/scan.ts` 的 `DOC_DIRS`（真目录名）；
 *  ② `packages/fs-store/src/create.ts` 的建书那几行（真会建哪些）；
 *  ③ 创作约定那一份由 `bookConventionBody` 的空串判着（跳过立项就不写）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NEW_BOOK_STRUCTURE } from "./new-book-structure";

const REPO = fileURLToPath(new URL("../../../../../../", import.meta.url));
const scanSource = readFileSync(path.join(REPO, "packages/fs-store/src/scan.ts"), "utf8");
const createSource = readFileSync(path.join(REPO, "packages/fs-store/src/create.ts"), "utf8");

/** 从 scan.ts 的 `DOC_DIRS` 里读出「键 → 目录名」。 */
function docDirs(): Record<string, string> {
  const start = scanSource.indexOf("export const DOC_DIRS = {");
  expect(start, "scan.ts 里找不到 DOC_DIRS").toBeGreaterThan(-1);
  const open = scanSource.indexOf("{", start);
  const close = scanSource.indexOf("}", open);
  const body = scanSource.slice(open + 1, close);
  const out: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const match = /(\w+):\s*"([^"]+)"/.exec(line);
    if (match) out[match[1]!] = match[2]!;
  }
  return out;
}

/** 建书代码里真正 mkdir 出来的目录名。 */
function createdDirNames(): string[] {
  const dirs = docDirs();
  const names = [...createSource.matchAll(/mkdir\(path\.join\(directory, DOC_DIRS\.(\w+)\)/g)].map(
    (match) => dirs[match[1]!] ?? ""
  );
  // 「materials」是字面量建的，不走 DOC_DIRS。
  for (const match of createSource.matchAll(/mkdir\(path\.join\(directory, "([^"]+)"\)/g)) {
    names.push(match[1]!);
  }
  return names.filter((name) => name !== "");
}

/** 表里的目录（path 以 "/" 结尾的那些），去掉尾斜杠。 */
function listedDirNames(): string[] {
  return NEW_BOOK_STRUCTURE.filter((item) => item.path.endsWith("/")).map((item) =>
    item.path.replace(/\/$/, "")
  );
}

describe("新建作品 · 目录结构预览不许漂", () => {
  it("建书真会建出来的目录，和表里摆出来的目录，一个不多一个不少", () => {
    const created = [...createdDirNames()].sort();
    const listed = [...listedDirNames()].sort();
    expect(listed, "表里的目录与 fs-store 真正建出来的对不上").toEqual(created);
  });

  it("每个目录名都是真名：要么是 DOC_DIRS 的值，要么是建书代码里字面量建出来的", () => {
    const dirs = Object.values(docDirs());
    const literal = [...createSource.matchAll(/mkdir\(path\.join\(directory, "([^"]+)"\)/g)].map(
      (match) => match[1]!
    );
    for (const name of listedDirNames()) {
      expect(
        [...dirs, ...literal],
        `「${name}」既不是 DOC_DIRS 的值，也不是建书代码里字面量建出来的目录`
      ).toContain(name);
    }
  });

  it("book.json 在表里——它是那本书的设定，不是一个文件夹", () => {
    const meta = NEW_BOOK_STRUCTURE.find((item) => item.path === "book.json");
    expect(meta).toBeDefined();
    expect(meta!.usage.length).toBeGreaterThan(0);
    expect(meta!.path.endsWith("/")).toBe(false);
  });

  it("「创作约定」那份标成条件件：跳过立项时盘上不多这个文件", () => {
    const convention = NEW_BOOK_STRUCTURE.find((item) => item.path.includes("创作约定"));
    expect(convention).toBeDefined();
    expect(convention!.conditional).toBe(true);
    // 建书代码里它确实被 `bookConventionBody` 的空串判着：没填就不写。
    expect(createSource).toContain("bookConventionBody");
    expect(createSource).toContain("创作约定.md");
  });

  it("每一行都有一句「干什么用」——空话不如不摆", () => {
    for (const item of NEW_BOOK_STRUCTURE) {
      expect(item.label.length, `${item.path} 没有名字`).toBeGreaterThan(0);
      expect(item.usage.length, `${item.path} 没有说明`).toBeGreaterThan(0);
    }
  });
});
