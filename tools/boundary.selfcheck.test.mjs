import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findViolations } from "./check-package-boundary.mjs";
import { findOverruns } from "./check-source-line-budget.mjs";

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));

test("边界门禁能抓到 electron import", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abyss-bound-"));
  fs.writeFileSync(path.join(dir, "bad.ts"), 'import { app } from "electron";\n');
  expect(findViolations(dir)).toEqual(["bad.ts"]);
});

test("边界门禁放过干净目录", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abyss-bound-ok-"));
  fs.writeFileSync(path.join(dir, "good.ts"), "export const a = 1;\n");
  expect(findViolations(dir)).toEqual([]);
});

test("行数门禁能抓到超长文件", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abyss-budget-"));
  fs.writeFileSync(path.join(dir, "big.ts"), "x\n".repeat(801));
  expect(findOverruns([dir], 800)).toHaveLength(1);
});

// 回归：CLI 守卫曾在含中文的项目路径下静默不执行，门禁退化成永远返回 0 的空壳。
test("CLI 形态会真的执行并把违规转成非零退出码", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "abyss-cli-"));
  fs.mkdirSync(path.join(cwd, "packages", "demo"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, "packages", "demo", "bad.ts"),
    'import { app } from "electron";\n'
  );
  const result = spawnSync(process.execPath, [path.join(TOOLS_DIR, "check-package-boundary.mjs")], {
    cwd,
    encoding: "utf8"
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("禁止 import electron");
});
