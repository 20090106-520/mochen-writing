import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findRendererViolations, findViolations } from "./check-package-boundary.mjs";
import { findOverruns } from "./check-source-line-budget.mjs";

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));

/** 造一套最小的 packages/fs-store：exports 里声明哪些子路径就写哪些文件。 */
function makeFixture({ exportsMap, modules }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mochen-render-bound-"));
  const store = path.join(root, "packages", "fs-store");
  fs.mkdirSync(path.join(store, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(store, "package.json"),
    JSON.stringify({ name: "@mochen/fs-store", exports: exportsMap })
  );
  for (const [name, source] of Object.entries(modules)) {
    fs.writeFileSync(path.join(store, "src", name), source);
  }
  const renderer = path.join(root, "renderer");
  fs.mkdirSync(renderer, { recursive: true });
  return { root, store, renderer };
}

function writeRendererFile(renderer, name, importLine) {
  fs.writeFileSync(path.join(renderer, name), `${importLine}\nexport const a = 1;\n`);
}

test("边界门禁能抓到 electron import", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mochen-bound-"));
  fs.writeFileSync(path.join(dir, "bad.ts"), 'import { app } from "electron";\n');
  expect(findViolations(dir)).toEqual(["bad.ts"]);
});

test("边界门禁放过干净目录", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mochen-bound-ok-"));
  fs.writeFileSync(path.join(dir, "good.ts"), "export const a = 1;\n");
  expect(findViolations(dir)).toEqual([]);
});

test("行数门禁能抓到超长文件", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mochen-budget-"));
  fs.writeFileSync(path.join(dir, "big.ts"), "x\n".repeat(801));
  expect(findOverruns([dir], 800)).toHaveLength(1);
});

// 回归：CLI 守卫曾在含中文的项目路径下静默不执行，门禁退化成永远返回 0 的空壳。
test("CLI 形态会真的执行并把违规转成非零退出码", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mochen-cli-"));
  fs.mkdirSync(path.join(cwd, "packages", "demo"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, "packages", "demo", "bad.ts"),
    'import { app } from "electron";\n'
  );
  // 【2026-10-10 P2-10】CLI 默认改成按**仓库根**扫（从 apps/desktop 里跑时 cwd 相对的两个根不存在，
  // 那句「边界检查通过」就成了空扫的假绿）。这条用例要喂夹具，所以显式给 `--root`——
  // 它钉的两件事一件没少：CLI 真的执行、违规真的变成非零码。
  const result = spawnSync(
    process.execPath,
    [path.join(TOOLS_DIR, "check-package-boundary.mjs"), "--root", cwd],
    {
      cwd,
      encoding: "utf8"
    }
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("禁止 import electron");
});

// 同一条闸的反面：给了 root 却什么根都没有，不许打印「通过」。
test("CLI 拿到不存在的 root：红，而不是空扫扫出一片绿", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mochen-cli-empty-"));
  const result = spawnSync(
    process.execPath,
    [path.join(TOOLS_DIR, "check-package-boundary.mjs"), "--root", path.join(cwd, "nope")],
    { cwd, encoding: "utf8" }
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("空扫");
  fs.rmSync(cwd, { recursive: true, force: true });
});

// 默认口径的正反面：不带 --root 时**永远按仓库根**扫，跟敲命令时站在哪个目录无关。
// 从临时空目录里跑，如果它按 cwd 算就会得到「两个根都不在」或直接空扫；按仓库根算则应该正常通过。
test("CLI 不带 --root 时按仓库根扫（cwd 不再决定它看得见什么）", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mochen-cli-cwd-"));
  const result = spawnSync(process.execPath, [path.join(TOOLS_DIR, "check-package-boundary.mjs")], {
    cwd,
    encoding: "utf8"
  });
  expect(result.stdout + result.stderr, result.stderr).toContain("边界检查通过");
  expect(result.status).toBe(0);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test("渲染层边界能抓到整包 import fs-store", () => {
  const { renderer, store } = makeFixture({
    exportsMap: { ".": "./src/index.ts" },
    modules: { "index.ts": "export * from './changes.js';\n" }
  });
  writeRendererFile(renderer, "Pane.vue", 'import { x } from "@mochen/fs-store";');
  expect(findRendererViolations(renderer, path.join(store, ".."))).toEqual([
    "Pane.vue: 渲染层禁止 import @mochen/fs-store 整包（barrel 会把 Node 模块拖进 bundle）"
  ]);
});

test("渲染层边界能抓到未在 exports 声明的子路径", () => {
  const { renderer, store } = makeFixture({
    exportsMap: { ".": "./src/index.ts" },
    modules: { "index.ts": "export const a = 1;\n" }
  });
  writeRendererFile(renderer, "Pane.vue", 'import { x } from "@mochen/fs-store/secret";');
  expect(findRendererViolations(renderer, path.join(store, ".."))[0]).toContain(
    "不在 fs-store 的 exports 里声明"
  );
});

// 这条是 2026-10-05 白屏事故真正承重的断言：入口模块本身干净，但它 import 的东西用了 node: 一样白屏。
test("渲染层边界能抓到子路径的传递依赖里有 node:", () => {
  const { renderer, store } = makeFixture({
    exportsMap: { ".": "./src/index.ts", "./clean": "./src/clean.ts" },
    modules: {
      "clean.ts": 'import { CHANGES } from "./dir.js";\nexport const x = CHANGES;\n',
      "dir.ts":
        'import path from "node:path";\nexport const CHANGES = path.join(".mochen", "changes");\n'
    }
  });
  writeRendererFile(renderer, "Pane.vue", 'import { x } from "@mochen/fs-store/clean";');
  expect(findRendererViolations(renderer, path.join(store, ".."))[0]).toContain("会白屏");
});

test("渲染层边界放过纯子路径，并拦下 agent-runtime", () => {
  const { renderer, store } = makeFixture({
    exportsMap: { ".": "./src/index.ts", "./clean": "./src/clean.ts" },
    modules: {
      "clean.ts": 'import { h } from "./helper.js";\nexport const x = h("a");\n',
      "helper.ts": "export const h = (s) => s.toUpperCase();\n"
    }
  });
  writeRendererFile(renderer, "Ok.vue", 'import { x } from "@mochen/fs-store/clean";');
  expect(findRendererViolations(renderer, path.join(store, ".."))).toEqual([]);

  writeRendererFile(renderer, "Agent.vue", 'import { x } from "@mochen/agent-runtime";');
  expect(findRendererViolations(renderer, path.join(store, ".."))).toEqual([
    "Agent.vue: 渲染层禁止 import @mochen/agent-runtime（它只在主进程跑）"
  ]);
});
