#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const PACKAGES_DIR = path.resolve("packages");
const FORBIDDEN = /from\s+["']electron["']|require\(\s*["']electron["']\s*\)/;

export function findViolations(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findViolations(full));
    else if (/\.(ts|mts|vue)$/.test(entry.name) && FORBIDDEN.test(fs.readFileSync(full, "utf8")))
      out.push(path.relative(dir, full));
  }
  return out;
}

// 用文件系统路径而不是 URL 比较：本项目路径含中文，URL 会被百分号编码，永不相等。
const isCli =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);

if (isCli) {
  const violations = findViolations(PACKAGES_DIR);
  if (violations.length) {
    console.error("packages/* 禁止 import electron：\n" + violations.join("\n"));
    process.exit(1);
  }
  console.log("边界检查通过");
}
