/// <reference types="node" />
/**
 * theme-runtime.css 覆盖清单不许留化石（2026-10-05）。
 *
 * 那一层的主题覆盖靠一长串 `:where(.a, .b, …)` 清单把前景/背景/边框色重新指到运行时 token 上，
 * 好让早于 token 体系的老控件也跟着换肤。清单是纯 CSS，编译期不会报错——**写错了也没有任何人报警**。
 * 2026-10-05 清查出 35 个条目（三处都没有：既没有规则，也没有模板 class，也没有任何代码引用），
 * 全是时间线改版之前那版实现（`tool-trace` / `processing-*` / `model-card` 那套词汇）留下的残骸。
 *
 * 这条测试把三处口径钉死，让化石长不回来：
 *   ① 有规则：某个 styles/*.css 里真的有一条规则约束它（**`:where()` 内部不算** —— 那是清单自己，
 *      清单提到某个类不等于有人给它写过样式）；
 *   ② 模板在用：某个 .vue 的 <template> 里出现过这个类名；
 *   ③ 代码引用：某个非测试 .ts/.vue 全文出现过（`:class="{ 'is-x': … }"` 这类动态挂名走这条）。
 * 三条都不满足 = 覆盖不到任何元素，删掉即可。
 *
 * 踩过的两个坑写在这里：解析前必须**剥掉 CSS 注释**（解释"为什么删"的注释里写了 `:where(…)`，
 * 会被当成真规则读一遍）；类名只取**开头那个基类**（清单里混着 `.a small` / `.a:not(.b)`）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const STYLES_DIR = fileURLToPath(new URL("../styles/", import.meta.url));
const SRC_DIR = fileURLToPath(new URL("../", import.meta.url));

function readFileAt(dir: string, name: string): string {
  return fs.readFileSync(path.join(dir, name), "utf8");
}

/** 注释里的选择器不是规则。 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** 被规则真正约束的类名。跳过 :where(...) 内部，否则覆盖清单会把自己算成规则。 */
function definedClasses(css: string): string[] {
  const found: string[] = [];
  for (const match of stripComments(css).matchAll(/([^{}]+)\{/g)) {
    const selector = match[1]!.replace(/:where\([^)]*\)/g, " ");
    for (const cls of selector.matchAll(/\.([A-Za-z0-9_-]+)/g)) found.push(cls[1]!);
  }
  return found;
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSourceFiles(full, out);
    else out.push(full);
  }
  return out;
}

describe("theme-runtime.css · 覆盖清单不留化石", () => {
  it("清单里每个类都被消费：有规则 / 模板在用 / 代码引用，三者至少居其一", () => {
    const runtime = stripComments(readFileAt(STYLES_DIR, "theme-runtime.css"));
    const listed = new Set<string>();
    for (const block of runtime.matchAll(/:where\(([^)]*)\)/g)) {
      for (const raw of block[1]!.split(",")) {
        const base = /^\.([A-Za-z0-9_-]+)/.exec(raw.trim());
        if (base) listed.add(base[1]!);
      }
    }
    expect(listed.size, "清单解析出了问题：一个类都没读到").toBeGreaterThan(0);

    const defined = new Set<string>();
    for (const file of fs.readdirSync(STYLES_DIR)) {
      if (!file.endsWith(".css")) continue;
      for (const cls of definedClasses(readFileAt(STYLES_DIR, file))) defined.add(cls);
    }

    // 排除 .test.ts：否则本文件自己提到的类名会把判定喂饱，这条测试就成了永动机。
    const codeText = collectSourceFiles(SRC_DIR)
      .filter((file) => /\.(ts|vue)$/.test(file) && !file.endsWith(".test.ts"))
      .map((file) => fs.readFileSync(file, "utf8"));

    const orphans = [...listed].filter(
      (cls) => !defined.has(cls) && !codeText.some((text) => text.includes(cls))
    );

    expect(
      orphans.map((cls) => `.${cls}`),
      "覆盖清单里的化石条目：既没有规则、也没有模板 class、也没有任何代码引用，覆盖不到任何元素。" +
        "确认无用就删掉；若是有意留下的（例如先备着、组件还没接线），先给它一条规则再留在清单里。"
    ).toEqual([]);
  });
});
