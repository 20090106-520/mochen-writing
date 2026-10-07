import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scriptSource, templateSource } from "../utils/vue-source-reader";

/**
 * F-4 的第二道门禁：旧品牌目录名**不许出现在任何用户可见的地方**。
 *
 * 第一道门禁（`app-data-migration.test.ts`）管的是「旧目录还会被读到」这件事；
 * 这一道管的是「旧名字还会被用户看见」——迁移完了，设置里却还写着
 * `appData/mochen-writing`，用户照着去找就找不到，那迁移等于没做。
 *
 * 豁免只有三处，且每一处都要有理由：
 * ① `main/index.ts` 的 `LEGACY_APP_DIR_NAME`（迁移的入参，非用户可见）
 * ② `app-data-migration.ts` 与它的测试（流程本体）
 * ③ spec 文件名 `2026-10-01-mochen-writing-workbench-design.md`（是文件名不是路径，
 *    改名要连带重写十几处交叉引用，刻意保留）
 */
const LEGACY = "mochen-writing";
const SRC_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** 豁免表：路径片段 → 为什么这里可以留着旧名字。 */
const EXEMPT: readonly [string, string][] = [
  [path.join("main", "index.ts"), "迁移的入参常量，不是用户可见文案"],
  [path.join("main", "app-data-migration.ts"), "迁移流程本体"],
  [path.join("main", "app-data-migration.test.ts"), "迁移流程的用例"],
  // 普查文件自己：它必须**含有**那个字面量才能搜它。
  // 不豁免的话这条断言会永远红，而红的原因不是产品有残留，是这把尺子自己被量了。
  ["legacy-dir-name.test.ts", "普查文件自身——它要搜的就是这个字面量"]
];

function exempt(relative: string): boolean {
  return EXEMPT.some(([frag]) => relative.endsWith(frag));
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "assets") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|vue)$/.test(name)) yield full;
  }
}

/** .vue 要连模板一起看：旧名字可能写在 data 里而不在 script 里。 */
function sourceOf(full: string): string {
  if (!full.endsWith(".vue")) return readFileSync(full, "utf8");
  return `${scriptSource(path.relative(SRC_ROOT, full))}\n${templateSource(
    path.relative(SRC_ROOT, full)
  )}`;
}

describe("F-4 · 旧品牌目录名的全仓普查", () => {
  const hits: string[] = [];
  for (const full of walk(SRC_ROOT)) {
    const relative = path.relative(SRC_ROOT, full);
    if (exempt(relative)) continue;
    if (sourceOf(full).includes(LEGACY)) hits.push(relative);
  }

  it("渲染层与共享包里一处都不许有（除了上面那三处豁免）", () => {
    expect(hits).toEqual([]);
  });

  it("设置里那句「保存在本机 appData/…」必须已经是新目录名", () => {
    const about = sourceOf(path.join(SRC_ROOT, "components", "AboutPanel.vue"));
    expect(about).toContain("appData/mochen-ai");
  });
});
