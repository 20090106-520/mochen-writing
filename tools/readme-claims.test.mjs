import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 门面主张守卫（2026-10-13）。
 *
 * 病灶是当场撞出来的：`README.md` 写着「皮肤像素闸在 `tools/`」，我照着去 `tools/` 找，
 * 那里**一个像素闸都没有**——真身在 `apps/desktop/scripts/check-scene-art.mjs`（三道闸 G1/G2/G3），
 * 生成器是同目录的 `gen-scene-svgs.mjs` + `scene-palettes.mjs`。门面指错路，下一个人就会
 * 在错的目录里得出「这闸不存在 / 这活儿没做」的结论；本仓反复出现的假话形态正是
 * 「东西在，说明指向别处」。所以这一条不测代码，只测**门面里那些可核对的指向**：
 *
 * 1. README 用反引号写出的、以 `apps/ | packages/ | tools/ | docs/ | .github/` 开头的路径，必须真的存在。
 *    只认这五个顶层前缀是刻意的：`.mochen/`（作品目录里那份）与 `.git/hooks`（工作树里 `.git` 是文件）
 *    都不该被当成仓库路径来断言，扩大匹配面只会让人学会关掉这条守卫。
 * 2. README 里**以命令形式写出的**每个 `pnpm <脚本>`（反引号整句或 ``` 代码块，含
 *    `pnpm --filter <包> <脚本>`），脚本名必须在根 `package.json` 或 `apps/desktop/package.json`
 *    的 `scripts` 里；`install` / `exec` 这类 pnpm 自带命令除外。散文里的「pnpm workspace」不算命令。
 *
 * 两条各带一条"提取到东西没有"的自我声明：正则写坏了会让守卫**空跑即绿**，那比没有守卫更糟。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

const TOP_DIRS = ["apps", "packages", "tools", "docs", ".github"];

/** 反引号里、以顶层目录开头的路径主张（允许结尾斜杠；带空格与花括号的不是路径）。 */
function readmePaths() {
  return [...readme.matchAll(/`([^`\s]+)`/g)]
    .map((m) => m[1])
    .filter((t) => TOP_DIRS.some((d) => t.startsWith(`${d}/`)));
}

/**
 * `pnpm <脚本>` 与 `pnpm --filter <包> <脚本>` 点到的脚本名。
 * 只认**两种现场**：反引号里的整句命令，与 ``` 代码块里的行。散文里那句「pnpm workspace」
 * 是包管理器的形容词，不是脚本名——第一版没做这个区分，它当场被判成「不存在的脚本」，
 * 红得没错但红得没道理；守卫要咬的是指向，不是措辞。
 */
function pnpmScripts() {
  const names = [];
  for (const m of readme.matchAll(/`([^`]+)`/g)) {
    const cmd = /^pnpm\s+(?:--filter\s+\S+\s+)?([a-z][\w:-]*)\b/.exec(m[1].trim());
    if (cmd) names.push(cmd[1]);
  }
  for (const block of readme.matchAll(/```[\s\S]*?```/g)) {
    for (const m of block[0].matchAll(/\bpnpm\s+(?:--filter\s+\S+\s+)?([a-z][\w:-]*)\b/g)) {
      names.push(m[1]);
    }
  }
  return names;
}

/** pnpm 自带的命令——它们不是本仓的脚本，不该要求 package.json 里有同名条目。 */
const PNPM_BUILTINS = new Set([
  "install",
  "i",
  "add",
  "remove",
  "run",
  "exec",
  "dlx",
  "list",
  "why",
  "store",
  "patch",
  "rebuild",
  "up",
  "update",
  "frozen",
  "version"
]);

function scriptsOf(pkgJsonPath) {
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  return new Set(Object.keys(pkg.scripts || {}));
}

const rootScripts = scriptsOf(path.join(ROOT, "package.json"));
const desktopScripts = scriptsOf(path.join(ROOT, "apps/desktop/package.json"));

test("提取到的确实是门面里那些指向（否则本守卫只剩自我声明）", () => {
  const paths = readmePaths();
  expect(
    paths.length,
    "README 里没提取到任何以顶层目录开头的路径主张——多半是提取正则写坏了，不是门面变干净了"
  ).toBeGreaterThan(5);
  const scripts = pnpmScripts();
  expect(scripts.length, "README 里没提取到任何 pnpm 脚本名——同上，提取面塌了").toBeGreaterThan(2);
});

test("README 点到的仓库路径必须真实存在", () => {
  const missing = [...new Set(readmePaths())].filter((p) => {
    const target = path.join(ROOT, p.replace(/\/+$/, ""));
    return !fs.existsSync(target);
  });
  expect(
    missing,
    `门面上这些路径在仓库里找不到，读者会按图找不到东西：${missing.join(", ")}`
  ).toEqual([]);
});

test("README 点到的 pnpm 脚本必须在 package.json 里", () => {
  const unknown = [...new Set(pnpmScripts())].filter(
    (name) => !PNPM_BUILTINS.has(name) && !rootScripts.has(name) && !desktopScripts.has(name)
  );
  expect(
    unknown,
    `门面上写了不存在的 pnpm 脚本（改名或删掉的那一刻，README 必须同批改）：${unknown.join(", ")}`
  ).toEqual([]);
});
