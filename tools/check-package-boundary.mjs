#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* 相对**仓库根**解析，而不是相对 cwd（P2-10）：原先写 `path.resolve("packages")`，
   从 apps/desktop 里跑这条命令时两个根都不存在——于是「边界检查通过」是空扫扫出来的假绿。 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PACKAGES_DIR = path.join(REPO_ROOT, "packages");
export const APPS_DIR = path.join(REPO_ROOT, "apps", "desktop", "src");
export const DEFAULT_RENDERER_DIR = path.join(APPS_DIR, "renderer", "src");
const FORBIDDEN = /from\s+["']electron["']|require\(\s*["']electron["']\s*\)/;

/** 路径比较一律走 posix 形状：Windows 的反斜杠会把 `startsWith("apps/desktop/…")` 判成永假。 */
const posix = (p) => p.split(path.sep).join("/");

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

/**
 * 跨层相对引用（P2-10 补的那三条通路）。
 *
 * 三道各自的判据，全部只在**说明符落到真实文件**时才报，避免把 `@mochen/x` 那种包名或
 * 不存在的历史引用误判成越界：
 * ① 渲染层的文件相对引到 `renderer/src` 之外 ⇒ 越界（引到 main / preload / 包源码 / 别处，四种分别说）；
 * ② 主进程或预加载相对引到渲染层里面 ⇒ 越界（Node 侧去要一份浏览器代码，构建产物里那份永远跑不起来）；
 * ③ 包源码不许被任何 app 侧文件用相对路径引（它们只许走 package.json 的 exports）——这条与 ① 的
 *    「包源码」分支同一处判，不重复扫第二遍。
 */
export function findCrossLayerViolations(appsDir = APPS_DIR, packagesDir = PACKAGES_DIR) {
  const out = [];
  // 目录不在就什么也不报：「空扫」由 CLI 那层的根检查兜住（见文件末尾），
  // 纯函数这一层要能拿临时夹具喂进来，不该因为缺一个根就自己造违规。
  if (!fs.existsSync(appsDir)) return out;
  const rendererRoot = path.join(appsDir, "renderer", "src");
  const layerOf = (rel) => {
    const r = posix(rel);
    if (r.startsWith("renderer/")) return "renderer";
    if (r.startsWith("main/")) return "main";
    if (r.startsWith("preload/")) return "preload";
    return "other";
  };
  const whereName = (targetAbs) => {
    const t = posix(targetAbs);
    if (targetAbs.startsWith(rendererRoot + path.sep) || t.startsWith(posix(rendererRoot) + "/"))
      return "渲染层";
    const pkgPrefix = packagesDir + path.sep;
    if (targetAbs.startsWith(pkgPrefix)) return "包源码（只许走 exports 声明的子路径）";
    const r = posix(path.relative(appsDir, targetAbs));
    if (r.startsWith("main/")) return "主进程";
    if (r.startsWith("preload/")) return "预加载";
    return "apps 之外";
  };

  for (const file of listSourceFiles(appsDir)) {
    // 测试文件不进 bundle，所以不参与跨层判据——而且本仓的接线用例**刻意**从 main 目录去读
    // renderer 那份 `vue-source-reader`（读 .vue 源文件做装配断言）。把这条排除写在这儿而不是漏掉，
    // 是因为它同时也是这道闸的一个洞：违规只要改名成 `*.test.ts` 就免检。钉在
    // `check-package-boundary.test.mjs` 的那条「测试文件免检是明写规则」用例上。
    if (/\.(test|spec)\.(m|c)?[jt]s[x]?$/.test(file)) continue;
    const relFromApps = path.relative(appsDir, file);
    const layer = layerOf(relFromApps);
    const source = fs.readFileSync(file, "utf8");
    for (const spec of specifiersOf(source)) {
      if (!spec.startsWith(".")) continue;
      const target = resolveRelative(file, spec);
      if (!target) continue;
      const targetLayer = whereName(target);
      if (layer === "renderer" && !target.startsWith(rendererRoot + path.sep)) {
        out.push(
          `${posix(relFromApps)}: 渲染层跨层 import：${spec} —— 跨出 renderer/src，进了${targetLayer}`
        );
      } else if (layer !== "renderer" && target.startsWith(rendererRoot + path.sep)) {
        out.push(
          `${posix(relFromApps)}: 主进程/预加载跨层 import：${spec} —— 从 Node 侧伸进了渲染层`
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
  /* `--root <目录>`：给自选用例喂一套临时夹具用（`boundary.selfcheck.test.mjs` 那条「CLI 会真的
     执行并把违规转成非零码」靠它）。不带这个参数时**一律按仓库根**扫——原先写 `path.resolve("packages")`
     是从 cwd 算的，从 apps/desktop 里跑就是两个不存在的目录，于是「边界检查通过」四个字
     是空扫扫出来的假绿（P2-10 的盲区形状之一）。 */
  const at = process.argv.indexOf("--root");
  const base = at > -1 ? path.resolve(process.argv[at + 1]) : REPO_ROOT;
  const packagesDir = path.join(base, "packages");
  const appsDir = path.join(base, "apps", "desktop", "src");
  if (!fs.existsSync(packagesDir) && !fs.existsSync(appsDir)) {
    console.error(`边界检查的两个根都不在（${base}）——空扫不叫通过`);
    process.exit(1);
  }
  const violations = [
    ...findViolations(packagesDir).map((v) => `packages/* 禁止 import electron：${v}`),
    ...findRendererViolations(path.join(appsDir, "renderer", "src"), packagesDir),
    ...findCrossLayerViolations(appsDir, packagesDir)
  ];
  if (violations.length) {
    console.error(violations.join("\n"));
    process.exit(1);
  }
  console.log("边界检查通过");
}
