import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileSfcSource } from "./sfc-compile";

/**
 * 整仓 SFC 编译关卡（2026-10-09 全仓扫描 P1-11 的第一格）。
 *
 * 判据本身在 `sfc-compile.ts`（那边有用例逐条钉"什么算红"，含一份故意写坏的 SFC 反向证据），
 * 这一份只干一件事：**把 `renderer/src` 下每一个 `.vue` 真编译一遍**，一个都不放过。
 *
 * 为什么值得单开一份：此前 `.vue` 完全不进类型程序（`tsc --listFiles` 里 .vue 计数 = 0），
 * 模板与 `<script setup>` 的语法/绑定层从来没有静态关卡，全靠 65 份"读源码做正则断言"的守卫——
 * 守卫判的是"源码里有没有这串字"，重构换个写法就查不出来。编译器判的是这段模板成不成立。
 *
 * 诚实的边界：这一层只到**语法与绑定**，不做类型检查（那要 `vue-tsc`，本仓没有这个依赖，
 * 离线也装不上），也不判"模板里用了 setup 没声明的名字"（Vue 编译器对未知绑定只生成 `_ctx.x`，
 * 不报错；要做得住得自己写作用域分析，那份留在 P1-11 的未做完里）。
 */
// 这份测试住在 `src/utils/`，而关卡要扫的是整个 `src/`（components、stores、composables 都在下面）：
// 相对自己上跳两级。少跳这一级时目录里一个 `.vue` 都没有，第二条用例就会**空跑变绿**——
// 正是下面那条数量下限要钉住的事。
const RENDERER_SRC = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

function listSfcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listSfcFiles(full));
    else if (entry.endsWith(".vue")) out.push(full);
  }
  return out;
}

describe("整仓 .vue 编译关卡", () => {
  const files = listSfcFiles(RENDERER_SRC);

  it("扫到的 SFC 数量在量级上（glob 空转就等于这道闸根本没跑）", () => {
    // 当场 `ls` 量到的是 60 个 `.vue`（总单说的 165 是"渲染层文件"，含 .ts）。
    // 取一个宽松下限，只为钉住"真的扫到了东西"：这一条一开始写的是 100，
    // 而它红过一次——因为我把根目录算成了 `utils/` 自己，一个 `.vue` 都没扫到，
    // 第二条用例当场"空跑变绿"。数量下限就是用来抓这种假绿的。
    expect(files.length).toBeGreaterThan(50);
  });

  it("每一个 SFC 都编译得动：任何一个红都要把文件名与行号一起报出来", () => {
    const failures: string[] = [];
    let attempted = 0;
    for (const file of files) {
      attempted += 1;
      // 传**绝对路径**给编译器：`compileScript` 要按文件名所在目录去解 `import` 的相对路径，
      // 给相对路径时它解不动 `../../utils/canvasui/particle-object`，会把好文件报成红——
      // 这是我这份关卡的错，不是被扫文件的错，必须区分清楚。
      const result = compileSfcSource(readFileSync(file, "utf8"), file);
      if (!result.ok) {
        failures.push(
          ...result.errors.map((error) => error.split(RENDERER_SRC + path.sep).join(""))
        );
      }
    }
    // 这一条钉的是"循环真的跑满了"：光有数量下限挡不住 `continue`——
    // 有人（或下一次重构）把某个文件跳过时，扫描照样全绿，而闸其实已经空了。
    expect(attempted).toBe(files.length);
    expect(failures, `编译不过的 SFC：\n${failures.join("\n")}`).toEqual([]);
  });
});
