import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * CI 这道闸本身要有守卫（2026-10-09 全仓扫描第八节「第 0 步」）。
 *
 * 病灶有两层：
 * ① README 的门面当时写着「一条命令串起五道闸，任何一道红就不能提交」（那句现已改成六道闸——
 *    数错的那一头由 `tools/readme-gate-composition.test.mjs` 的门禁组成臂看着；第五十二节它从
 *    `readme-claims.test.mjs` 搬了出来，因为那道闸自己越过了 800 行预算），而扫描实跑确认
 *    既没有 CI（`.github` 不存在）也没有 git 钩子（`core.hooksPath` 为空、`.git/hooks` 里只有 sample）——
 *    那句话全靠人记得在本机跑；
 * ② 本机已经被「退出码被管道吞掉」咬过一次：typecheck 日志里同时存在 `error TS2300` 与
 *    `[ELIFECYCLE] Command failed with exit code 2`，外面报的却是 exit 0。
 *    CI 若写成 `pnpm verify | tail -20` 之类的形状，就是把第 ② 种自欺搬到一个更权威的地方。
 *
 * 所以这里钉的不是"有没有一个 yml"，而是三件可失败的事：闸在场、闸跑的是整条 verify、
 * 闸不许把码吞掉。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = path.join(ROOT, ".github", "workflows", "verify.yml");

function workflowText() {
  return fs.readFileSync(WORKFLOW, "utf8");
}

test("CI 工作流文件在场", () => {
  expect(fs.existsSync(WORKFLOW), ".github/workflows/verify.yml 必须存在").toBe(true);
});

test("CI 跑的是整条 `pnpm verify`，不是把它拆成几段各跑各的", () => {
  const text = workflowText();
  // 拆段跑最容易漏掉最后一段（或某一段偷偷 continue-on-error）。整条 verify 是仓里唯一的口径。
  expect(text).toMatch(/run:\s*pnpm verify\b/);
  // 依赖必须按锁文件装：锁不上就红，而不是让 CI 用一份和谁都不一样的依赖树变绿。
  expect(text).toMatch(/pnpm install\s+--frozen-lockfile/);
});

test("触发条件覆盖 push 与 pull_request，且 pnpm 版本只从 packageManager 一处来", () => {
  const text = workflowText();
  expect(text).toMatch(/^on:$/m);
  expect(text).toMatch(/push:/);
  expect(text).toMatch(/pull_request:/);
  // CI 里再钉一份 pnpm 号就是第二处口径：升级时会各说各话（版本归 packageManager 管）。
  expect(text).toMatch(/node-version:/);
  expect(text).not.toMatch(/version: "11/);
});

test("没有任何一步把退出码吞掉", () => {
  // 先把 YAML 注释行剥掉：本文件顶上的说明里就写着 `| tail`、`|| true` 这些反面写法，
  // 拿整份原文去 not.toContain 会被注释反咬一口（这条仓里在 `vue-source-reader` 那边踩过，
  // 判据是同一句：注释里写着没做 ≠ 真没做，注释里写着禁词 ≠ 真禁了）。
  const text = workflowText()
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
  // 逐条列出来，红的时候直接看得见是哪一种自欺形状。
  const swallowed = [
    /\|\s*(tail|head|grep)\b/.source,
    /\bcontinue-on-error:\s*true\b/.source,
    /\|\|\s*true\b/.source,
    /;\s*echo\b/.source,
    /\bset \+e\b/.source
  ].filter((pattern) => new RegExp(pattern).test(text));
  expect(swallowed, `CI 里出现了吞码写法：${swallowed.join(" | ")}`).toEqual([]);
});

test("verify 脚本本身仍然是 `&&` 串起来的（CI 绿等于六路全绿）", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const command = pkg.scripts.verify;
  // 若有人把它改成 `;` 或包进 shell 包装，CI 的绿就不再等于门禁的绿。
  expect(command).not.toMatch(/;/);
  expect(command).toMatch(/vitest run/);
  expect(command).toMatch(/eslint \. --max-warnings=0/);
  expect(command).toMatch(/prettier \. --check/);
});

test("桌面包自己的 test 跑的是整包，不是半套（P2-10 的门禁盲区之一）", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "apps", "desktop", "package.json"), "utf8")
  );
  const command = pkg.scripts.test;
  // 病灶：原先写的是「vitest run src/main」。实测它一颗用例都不收——cwd 在 apps/desktop，
  // 而 include 模式（apps/desktop/src/**）是相对仓库根写的，于是 vitest 报「No test files found」
  // 退出 1：一条永远红的脚本，和一条只跑半套的脚本一样没用。
  // 现在要求三件：主进程与渲染层都在、根口径显式给回仓库根（--root ../..）、且仍是一次 run。
  expect(command).toMatch(/vitest run\b/);
  expect(command).toMatch(/--root \.\.\/\.\./);
  expect(command).toMatch(/src\/main\b/);
  expect(command).toMatch(/src\/renderer\b/);
  expect(command).not.toMatch(/\bwatch\b/);
});
