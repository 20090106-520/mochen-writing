import { expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LIMIT, ROOTS, findOverruns, listScanned } from "./check-source-line-budget.mjs";

/**
 * 行数预算这道闸自己的守卫（2026-10-09 全仓扫描 P2-10）。
 *
 * 病灶不是「有文件超限」，而是**闸漏扫**：
 * ① 只扫 `.ts` / `.vue`——门禁脚本与出图脚本都是 `.mjs`，压根进不了它的视野；
 * ② 只扫 `packages` 与 `apps/desktop/src`——`tools/` 与 `apps/desktop/scripts/` 整个目录不在 ROOTS 里。
 * 于是一个 1500 行的 `tools/*.mjs` 可以一路活到合并，而 README 那句「八文件 800 行预算」听起来还是绿的。
 *
 * 这里钉四件可失败的事：
 * - 漏扫的两类真身（`.mjs` 与那两个目录）确实在视野里；
 * - ROOTS 不许写成不存在的目录名（那样扫描为空 = 假绿，所以逐根要求「至少扫到一份文件」）；
 * - 仓库当前状态真的过闸（这条就是出图脚本必须拆下去的理由）；
 * - 判据是「> 上限」而不是「>=」，别把正好 800 行的文件误杀。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** 造一个临时目录树：写份文件进去，返回它的绝对路径。 */
function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "budget-"));
  for (const [rel, lines] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    // 每行都得是真代码形状：注释与空行同样占一行，这里只关心行数。
    fs.writeFileSync(
      full,
      Array.from({ length: lines }, (_, i) => `const x${i} = ${i};`).join("\n")
    );
  }
  return dir;
}

test(".mjs 进视野：超限的门禁/出图脚本会被报出来", () => {
  const dir = fixture({ "scripts/gen.mjs": 12, "src/a.ts": 12, "src/b.vue": 12 });
  try {
    const overruns = findOverruns([dir], 10);
    expect(
      overruns.some((line) => line.includes(path.join("scripts", "gen.mjs"))),
      overruns.join("\n")
    ).toBe(true);
    expect(
      overruns.some((line) => line.includes(path.join("src", "a.ts"))),
      overruns.join("\n")
    ).toBe(true);
    expect(
      overruns.some((line) => line.includes(path.join("src", "b.vue"))),
      overruns.join("\n")
    ).toBe(true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("正好等于上限的不算超（判据是 >，不是 >=）", () => {
  const dir = fixture({ "a.mjs": 10, "b.ts": 11 });
  try {
    const overruns = findOverruns([dir], 10);
    expect(overruns, overruns.join("\n")).toEqual([expect.stringContaining("b.ts")]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ROOTS 含 tools 与 apps/desktop/scripts，而且逐根都真扫到东西（写成空目录=假绿）", () => {
  for (const want of ["tools", path.join("apps", "desktop", "scripts")])
    expect(
      ROOTS.some((r) => path.resolve(ROOT, r) === path.resolve(ROOT, want)),
      `ROOTS 里没有 ${want}：${JSON.stringify(ROOTS)}`
    ).toBe(true);
  const scanned = listScanned(ROOTS);
  for (const want of ["tools", path.join("apps", "desktop", "scripts")]) {
    const hit = scanned.filter((f) => f.startsWith(path.resolve(ROOT, want) + path.sep));
    expect(hit.length, `${want} 一份文件都没扫到，ROOTS 或扩展名写错了`).toBeGreaterThan(0);
  }
});

test("仓库当前状态过闸：没有任何被扫文件超过 800 行", () => {
  const overruns = findOverruns(ROOTS, LIMIT);
  expect(overruns, overruns.join("\n")).toEqual([]);
});
