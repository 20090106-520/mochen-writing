#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const LIMIT = 800;
const ROOTS = ["packages", "apps/desktop/src"];

export function findOverruns(roots, limit = LIMIT) {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|vue)$/.test(entry.name)) {
        const lines = fs.readFileSync(full, "utf8").split("\n").length;
        if (lines > limit) out.push(`${full}  ${lines} 行 > ${limit}`);
      }
    }
  };
  for (const root of roots) walk(root);
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
  console.log("行数预算通过");
}
