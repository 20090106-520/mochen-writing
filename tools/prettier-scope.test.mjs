import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import prettier from "prettier";
import { fileURLToPath } from "node:url";

/**
 * 格式这道闸的**可见范围**（2026-10-09 全仓扫描 P2-10）。
 *
 * 病灶不是「文档没排好版」，是**盲区不被记录**：`.prettierignore` 一行裸的 `docs/superpowers`
 * 把 448 KB 台账与全部规格文档排除在外，而 `pnpm verify` 打印的是「All matched files use Prettier
 * code style!」——那句绿从来不包括这些文件，可读起来像包括。
 *
 * 修法 measured 过才定：把 docs 真放进闸里，prettier 要改 **20 个文件、-34575 / +38530 行**
 * （它连 markdown 里的代码块一起格式化，历史方案文档的每个片段都会重排）。那是把整条台账重写一遍，
 * 换来的只是排版一致 ⇒ 判定为「不划算」，改走**声明式豁免**：豁免留在 ignore 里，但
 * ① 必须写明理由，② 必须逐条列在下面这份名单里，③ 名单之外再出现任何源码树级别的排除就红。
 * 盲区从「看不见」变成「挂着牌子、有守卫的例外」——这才是这条 P2 的实际风险所在。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const IGNORE = path.join(ROOT, ".prettierignore");

/** 已声明的源码树级豁免（只许这些，且每条都得有理由注释）。 */
const DECLARED_EXEMPTIONS = ["docs/superpowers"];
/** 源码树的根：出现在 `.prettierignore` 里的这些前缀就算「源码树级排除」，必须逐条落在上面那份名单。 */
const SOURCE_ROOTS = ["docs", "packages", "apps", "tools", "src"];

function ignoreLines() {
  return fs
    .readFileSync(IGNORE, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim());
}

const isExclusion = (l) => l && !l.startsWith("#");
const sourceTreeExclusion = (l) =>
  SOURCE_ROOTS.some((r) => l === r || l.startsWith(r + "/") || l.startsWith(r + "\\"));

test("源码树级的排除只有那份已声明名单（多一条=新的隐形盲区）", () => {
  const found = ignoreLines()
    .filter((l) => isExclusion(l) && sourceTreeExclusion(l))
    .sort();
  expect(found, `排除清单：${found.join(", ")}`).toEqual([...DECLARED_EXEMPTIONS].sort());
});

test("每条豁免紧邻着一行中文理由（没理由的豁免等于没人负责的豁免）", () => {
  const lines = ignoreLines();
  for (const d of DECLARED_EXEMPTIONS) {
    const i = lines.indexOf(d);
    expect(i, `${d} 不在 .prettierignore 里，名单该同步删掉`).toBeGreaterThanOrEqual(0);
    const above = lines.slice(Math.max(0, i - 3), i).filter((l) => l.startsWith("#"));
    const reason = above.join(" ");
    expect(reason, `${d} 头顶没有理由注释`).toMatch(/[\u4e00-\u9fa5]/);
    expect(reason.length, `${d} 的理由注释太短，不构成理由`).toBeGreaterThanOrEqual(8);
  }
});

test("名单之外的源码文件确实在闸的视野里（抽四份真身，防止 ROOTS 写成空扫）", async () => {
  for (const rel of [
    "README.md",
    path.join("packages", "fs-store", "src", "index.ts"),
    path.join("apps", "desktop", "src", "main", "index.ts"),
    path.join("tools", "check-source-line-budget.mjs")
  ]) {
    const full = path.join(ROOT, rel);
    expect(fs.existsSync(full), `${rel} 不见了，用例的判据源变了`).toBe(true);
    const info = await prettier.getFileInfo(full, { ignorePath: IGNORE });
    expect(info.ignored, `${rel} 被排除在格式闸之外`).toBe(false);
  }
});

test("台账与规格文档确实落在豁免范围内（这条红=它已经进了闸，那份名单该删了）", async () => {
  const ledger = path.join(ROOT, "docs", "superpowers", "plans", "README.md");
  expect(fs.existsSync(ledger), "台账不在，判据源变了").toBe(true);
  const info = await prettier.getFileInfo(ledger, { ignorePath: IGNORE });
  expect(info.ignored).toBe(true);
});

test("该忽略的仍然忽略：依赖与构建产物不进格式闸", async () => {
  for (const rel of ["node_modules/pkg/index.js", "out/renderer/index.js", "dist/a.js"]) {
    const info = await prettier.getFileInfo(path.join(ROOT, rel), { ignorePath: IGNORE });
    expect(info.ignored, `${rel} 本该被忽略`).toBe(true);
  }
});
