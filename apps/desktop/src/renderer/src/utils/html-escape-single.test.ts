import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scriptSource } from "./vue-source-reader";

/**
 * HTML 转义只许有一份真身（2026-10-09 扫描总单·重复实现表）。
 *
 * 病灶：渲染层 `DocumentPane.vue` 里抄了一份只转 `& < >` 的，`fs-store` 的共享层那份还转
 * `" '`，而共享层自己的注释就写着「判定只留一份」（铁律 6）。两份并存的实际代价不是重复代码，
 * 是**口径**：读代码的人会以为转义不需要转引号，下一次把文本往带引号的属性里塞时照抄渲染层那份，
 * 就是一条真 XSS。所以这里钉三件事：谁定义了它、渲染层用的是哪一份、全仓有没有第二份。
 *
 * 判定住在 fs-store 而不是 renderer/utils：因为导出侧与预览侧都要用它，而渲染层引 `@mochen/fs-store`
 * 必须走 `exports` 里显式声明的子路径（`export-shared` 已在用，且那条链零 `node:` 依赖）——
 * 这一条也由用例钉着，防止有人把共用真身挪进 barrel 导致首屏白屏（2026-10-05 的事故原委）。
 */

/**
 * 仓库根：一路往上找到 `packages/fs-store/package.json` 为止。
 * 数层数（本文件在 apps/desktop/src/renderer/src/utils/ 下，往上六层）在 Windows 上极易数错，
 * 数错的结果不是报错而是普查扫了个空目录、`definers()` 回 `[]` —— 看着像"只有一份"其实一份没看到。
 */
function findRepoRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 12; i += 1) {
    if (fs.existsSync(path.join(cur, "packages", "fs-store", "package.json"))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  throw new Error(`找不到仓库根（从 ${start} 往上没有 packages/fs-store/package.json）`);
}

const REPO_ROOT = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));

/** 定义那份的正则——写成构造式，免得本文件自己的注释把普查咬红。 */
const DEFINITION = new RegExp("^\\s*(?:export\\s+)?function\\s+escapeHtml\\b", "m");

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|mts|vue)$/.test(entry.name) && !/\.(test|selfcheck)\./.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** 参与普查的范围：渲染层 + 主进程 + preload + 四个包。备份目录（点开头）天然不在里面。 */
const SCAN_DIRS = [
  "apps/desktop/src",
  "packages/contracts/src",
  "packages/fs-store/src",
  "packages/agent-runtime/src",
  "packages/plugin-kernel/src"
];

function definers(): string[] {
  return allScanned()
    .filter((f) => DEFINITION.test(fs.readFileSync(f, "utf8")))
    .map((f) => path.relative(REPO_ROOT, f).split(path.sep).join("/"));
}

function allScanned(): string[] {
  return SCAN_DIRS.flatMap((d) => listSourceFiles(path.join(REPO_ROOT, d)));
}

describe("HTML 转义只有一份真身", () => {
  it("普查真的扫到了这两处（路径数错会扫成空目录，把下一条伪造成绿色）", () => {
    const rel = allScanned().map((f) => path.relative(REPO_ROOT, f).split(path.sep).join("/"));
    expect(rel).toContain("packages/fs-store/src/export-shared.ts");
    expect(rel).toContain("apps/desktop/src/renderer/src/components/DocumentPane.vue");
  });

  it("全仓只有一个 escapeHtml 定义，且它住在 fs-store 的共享层", () => {
    expect(definers()).toEqual(["packages/fs-store/src/export-shared.ts"]);
  });

  it("渲染层不再自己定义，改为 import 那一份", () => {
    const src = scriptSource("components/DocumentPane.vue");
    // 从共享真身那一条 import 里取 escapeHtml（走子路径，不是 barrel）。
    expect(src).toMatch(
      /import\s*\{[^}]*\bescapeHtml\b[^}]*\}\s*from\s*"@mochen\/fs-store\/export-shared"/
    );
    expect(src).not.toMatch(DEFINITION);
    // 高亮 mirror 的每一段正文都走那一份，渲染层不留第二套 replace 链。
    expect(src).toContain("escapeHtml(text.slice(pos.start, pos.end))");
    // 渲染层不再自己拼转义链：整份脚本里不该再出现实体名（真身在 fs-store 那一份里）。
    expect(src).not.toContain("&amp;");
  });

  it("共享真身所在子路径在 fs-store 的 exports 里显式声明（渲染层引它才证明是安全的）", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "packages/fs-store/package.json"), "utf8")
    ) as { exports?: Record<string, string> };
    expect(pkg.exports?.["./export-shared"]).toBe("./src/export-shared.ts");
    const shared = fs.readFileSync(
      path.join(REPO_ROOT, "packages/fs-store/src/export-shared.ts"),
      "utf8"
    );
    expect(shared).not.toMatch(/from\s+["']node:/);
  });
});
