#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const PACKAGES_DIR = path.resolve("packages");
const RENDERER_DIR = path.resolve("apps/desktop/src/renderer/src");
const FORBIDDEN = /from\s+["']electron["']|require\(\s*["']electron["']\s*\)/;

/** 渲染层跑在浏览器里：任何 `node:` 依赖都会被打包器换成空壳，模块顶层一调用就整页白屏。 */
const NODE_IMPORT = /(?:from|import|require\()\s*\(?\s*["']node:[^"']+["']/;

/** 只认 import/export 的字面量说明符，够用且不会把注释里的字样算进来。 */
const SPECIFIER = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

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

function listSourceFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|mts|vue)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function specifiersOf(source) {
  return [...source.matchAll(SPECIFIER)].map((m) => m[1]);
}

/** 相对说明符（./x.js）落到真实文件上；只认 .ts/.vue，别把 .json 之类的当模块。 */
function resolveRelative(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec.replace(/\.js$/, ""));
  for (const candidate of [base + ".ts", base + ".vue", path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * 这个子路径（连同它在包内的传递依赖）有没有 `node:` 依赖。
 * 只看入口模块不够：`export-service.js` 干净，但它 import 的东西脏，一样进 bundle。
 */
function nodeDependentModules(entryFile) {
  const seen = new Set();
  const queue = [entryFile];
  const dirty = new Set();
  while (queue.length) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const source = fs.readFileSync(file, "utf8");
    if (NODE_IMPORT.test(source)) dirty.add(file);
    for (const spec of specifiersOf(source)) {
      if (spec.startsWith(".")) {
        const next = resolveRelative(file, spec);
        if (next) queue.push(next);
      }
    }
  }
  return [...dirty];
}

function readFsStoreExports(fsStoreDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(fsStoreDir, "package.json"), "utf8")).exports ?? {};
  } catch {
    return {};
  }
}

/**
 * 渲染层的包边界。
 *
 * 事故原委（2026-10-05）：`DocumentPane.vue` 与 `ExportDialog.vue` 从 `@mochen/fs-store` 这个
 * barrel 取两个纯函数，而 barrel 是 `export *` 全包的——于是 `changes.ts`、`create.ts`、
 * `read-write.ts`、`scan.ts`、`skills.ts` 五个 Node 模块一起进了渲染 bundle。barrel 里任何模块
 * 顶层只要有一行 `path.join(...)`，浏览器里就变成 `undefined.join` 的 TypeError，**首屏直接白屏**，
 * 而且 `tsc` 与打包全绿——构建期没有任何线索。
 *
 * 所以规则不是「别写顶层 path.join」，而是：渲染层只许走 fs-store 在 `exports` 里**显式声明**的
 * 子路径，且该子路径的传递依赖必须一个 `node:` 都不碰。
 */
export function findRendererViolations(rendererDir, packagesDir = PACKAGES_DIR) {
  const out = [];
  const fsStoreDir = path.join(packagesDir, "fs-store");
  const fsStoreExports = readFsStoreExports(fsStoreDir);

  for (const file of listSourceFiles(rendererDir)) {
    const rel = path.relative(rendererDir, file);
    const source = fs.readFileSync(file, "utf8");
    for (const spec of specifiersOf(source)) {
      if (spec === "@mochen/agent-runtime") {
        out.push(`${rel}: 渲染层禁止 import @mochen/agent-runtime（它只在主进程跑）`);
        continue;
      }
      if (spec !== "@mochen/fs-store" && !spec.startsWith("@mochen/fs-store/")) continue;

      if (spec === "@mochen/fs-store") {
        out.push(
          `${rel}: 渲染层禁止 import @mochen/fs-store 整包（barrel 会把 Node 模块拖进 bundle）`
        );
        continue;
      }
      const subpath = "./" + spec.slice("@mochen/fs-store/".length);
      const target = fsStoreExports[subpath];
      if (!target) {
        out.push(`${rel}: ${spec} 不在 fs-store 的 exports 里声明，无从证明它是渲染层安全的`);
        continue;
      }
      const entryFile = path.resolve(fsStoreDir, target);
      if (!fs.existsSync(entryFile)) {
        out.push(`${rel}: ${spec} 指向的 ${target} 不存在`);
        continue;
      }
      for (const dirty of nodeDependentModules(entryFile)) {
        out.push(
          `${rel}: ${spec} 的传递依赖 ${path.relative(fsStoreDir, dirty)} 用了 node:，会白屏`
        );
      }
    }
  }
  return out;
}

// 用文件系统路径而不是 URL 比较：本项目路径含中文，URL 会被百分号编码，永不相等。
const isCli =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);

if (isCli) {
  const violations = [
    ...findViolations(PACKAGES_DIR).map((v) => `packages/* 禁止 import electron：${v}`),
    ...findRendererViolations(RENDERER_DIR)
  ];
  if (violations.length) {
    console.error(violations.join("\n"));
    process.exit(1);
  }
  console.log("边界检查通过");
}
