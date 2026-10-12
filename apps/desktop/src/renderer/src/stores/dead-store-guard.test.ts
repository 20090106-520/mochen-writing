/// <reference types="node" />
/**
 * 死 store 守卫（2026-10-13）。
 *
 * 起因：`stores/useHotkeyConfigStore.ts`（232 行、含一份自己的键位表）在全仓**零引用**，
 * 却把「快捷键动作」写成第二份判据，而且已经和真身漂移：它写 `accept-proposal = Ctrl+Shift+A`，
 * 而 `utils/hotkey-guide.ts:94-97` 的真身是 Y / A / P / D 四枚。
 * `dead-css-guard.test.ts` 的开头说过同一句话——「这层没人报警，删不掉、看不见、改不动，
 * 一轮轮攒下来」。CSS 那层有守卫，store 这层没有，于是补这一条。
 *
 * 口径：`stores/*.ts` 里每个定义 store 的文件（判据不是文件名而是**内容**：源码含 `defineStore(`），
 * 必须被 `stores/` 之外、且不是测试（`*.test.ts`）的文件引用得到。
 * 之所以用内容而不是 `use*Store.ts` 命名：`layoutStore.ts` 不以 use 开头却是真 store，
 * 而 `agent-store-fixture.ts` / `book-draft-fixture.ts` / `book-data-test-harness.ts` 是测试夹具，
 * 它们本来只该被测试用到——写死一份豁免名单，下次加夹具还得回来改这里。
 *
 * 这条守卫**不管**「引用方自己没挂载」：`useVersionStore.ts` 的唯一引用方是 `VersionHistoryPanel.vue`，
 * 而那只面板当前不挂载（属台账里等他一句话的那一格）。面板在不在是挂载图的事，不在本守卫的判据里，
 * 免得一刀切进去把还没拍板的东西当成已决。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../", import.meta.url));
const STORES = path.join(SRC, "stores");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe("无人引用的 store 当场红（stores/ 这层的死代码守卫）", () => {
  const sources = walk(SRC).filter(
    (f) => /\.(ts|vue)$/.test(f) && !f.endsWith(".d.ts") && !f.endsWith(".test.ts")
  );
  const outsideStores = sources.filter((f) => !f.startsWith(STORES + path.sep));
  const texts = outsideStores.map((f) => ({ file: f, text: fs.readFileSync(f, "utf8") }));

  const storeFiles = walk(STORES)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .filter((f) => /defineStore\(/.test(fs.readFileSync(f, "utf8")));

  it("stores/ 里确实扫得到 store（否则本守卫会静默空跑）", () => {
    expect(
      storeFiles.length,
      "一个 defineStore 都没扫到——多半是扫描路径或判据写错了，不是仓库变干净了"
    ).toBeGreaterThan(10);
    expect(
      texts.length,
      "stores/ 之外没有可当引用方的源码，这条守卫就只剩自我声明"
    ).toBeGreaterThan(10);
  });

  it.each(storeFiles.map((f) => [path.basename(f), f] as const))(
    "%s 必须被 stores/ 之外的非测试源码引用得到",
    (_name, file) => {
      const id = path.basename(file, ".ts");
      const pattern = new RegExp(`\\b${id}\\b`);
      const referrers = texts
        .filter((t) => pattern.test(t.text))
        .map((t) => path.relative(SRC, t.file));
      expect(
        referrers,
        `${id}.ts 在 stores/ 之外没有任何非测试引用方：要么接上真身，要么删掉。留着它就等于再养一份没人读的判据`
      ).not.toHaveLength(0);
    }
  );
});
