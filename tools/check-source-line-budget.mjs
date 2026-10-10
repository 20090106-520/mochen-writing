#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 八文件 800 行预算（README 的门面条款）。
 *
 * 2026-10-09 全仓扫描 P2-10 修的是**这道闸自己的两个洞**：
 * ① 扩展名只认 `.ts` / `.vue`，于是 `tools/*.mjs`（门禁脚本）与 `apps/desktop/scripts/*.mjs`（出图脚本）
 *    无论写多长都不进视野；
 * ② ROOTS 只写 `packages` 与 `apps/desktop/src`，那两个目录整个不在扫描范围内。
 * 现在两类都进来了，逐条钉在 `check-source-line-budget.test.mjs`——包括「ROOTS 不许写成空目录」，
 * 因为漏扫最阴的形状不是报错，是**扫描为空然后打印「通过」**。
 */

export const LIMIT = 800;
export const ROOTS = ["packages", "apps/desktop/src", "tools", "apps/desktop/scripts"];

/** 相对仓库根解析，而不是相对 cwd：CI 与本机 pnpm 的 cwd 不总是同一处。 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_FILE = /\.(ts|vue|mjs|cjs)$/;
/** 生成物不参与预算：`out`/`dist` 是构建产物，改它们只会让闸变成噪音源。 */
const SKIP_DIRS = new Set(["node_modules", "out", "dist"]);

const abs = (root) => (path.isAbsolute(root) ? root : path.join(REPO_ROOT, root));

/** 扫到的每一份源文件（绝对路径），供「ROOTS 有没有真扫到东西」那条用例判。 */
export function listScanned(roots) {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (SOURCE_FILE.test(entry.name)) out.push(full);
    }
  };
  for (const root of roots) walk(abs(root));
  return out;
}

export function findOverruns(roots, limit = LIMIT) {
  const out = [];
  for (const full of listScanned(roots)) {
    const lines = fs.readFileSync(full, "utf8").split("\n").length;
    if (lines > limit) out.push(`${full}  ${lines} 行 > ${limit}`);
  }
  return out;
}

// 用文件系统路径而不是 URL 比较：本项目路径含中文，URL 会被百分号编码，永不相等。
const isCli =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);

if (isCli) {
  const overruns = findOverruns(ROOTS);
  if (overruns.length) {
    console.error("行数超限：\n" + overruns.join("\n"));
    process.exit(1);
  }
  console.log(`行数预算通过（${listScanned(ROOTS).length} 份，含 .mjs/.cjs）`);
}
