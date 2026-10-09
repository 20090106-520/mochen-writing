import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * typecheck 覆盖面守卫（2026-10-09 全仓扫描第六节第 3 条）。
 *
 * 病灶：`packages/plugin-kernel` 是四包之一，却从未出现在根 `package.json` 的 tsc 项目列表里，
 * 于是它带着 `TS2352 + TS7006` 两个类型错误「全绿」了不知多少轮——**门禁的覆盖面本身没人管**。
 * 这一条把覆盖面变成断言：凡是 `packages/*` 下有 `tsconfig.json` 的包，都必须被 `typecheck`
 * 与 `verify` 两个脚本点名；将来新增第五包忘了接，这里先红，而不是静默漏检。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

/** 仓库里真实存在类型程序的包目录。 */
function packagesWithTsconfig() {
  const dir = path.join(ROOT, "packages");
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => fs.existsSync(path.join(dir, name, "tsconfig.json")));
}

for (const script of ["typecheck", "verify"]) {
  test(`${script} 点名了每一个有 tsconfig 的包`, () => {
    const command = pkg.scripts[script];
    expect(typeof command).toBe("string");
    const missing = packagesWithTsconfig().filter(
      (name) => !command.includes(`packages/${name}/tsconfig.json`)
    );
    // 反向钉：漏检的包名列出来，红的时候直接看得见是谁没接进类型程序。
    expect(missing).toEqual([]);
  });
}

test("apps/desktop 的两套 tsconfig（node / web）也都在场", () => {
  const command = pkg.scripts.typecheck;
  expect(command).toContain("apps/desktop/tsconfig.node.json");
  expect(command).toContain("apps/desktop/tsconfig.web.json");
});

test("守卫自己不是空转：packages 下确实数得出四包以上", () => {
  // 数不出东西的守卫等于没有守卫——这一条保证上面两条永远有被测对象。
  expect(packagesWithTsconfig().length).toBeGreaterThanOrEqual(4);
});
