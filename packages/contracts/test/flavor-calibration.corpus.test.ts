/**
 * 「投料即出表」的语料入口用例（P0-①，2026-10-20）。
 *
 * 读 `packages/contracts/corpus/`（相对本测试文件定位）：递归收 `*.txt` / `*.md` 的 UTF-8 文本。
 * 目录不存在或为空 ⇒ `docs = []` ⇒ 打印 `FLAVOR_CORPUS_GAP` 并断言四类 `samples === 0`——
 * **用例通过，但缺口在输出里一眼可见**：这一刀只落基础设施，真人语料到齐那天，
 * 把语料丢进那个目录，这条用例自然打出校准表，一个字不用改。
 *
 * 落点说明：`node:fs/promises` 归 Node 侧。本仓 `tools/check-package-boundary.mjs` 对 `packages/*`
 * 只拦 `electron`，`node:` 不在其列（同包的 `test/change-retention.test.ts` 早就这么读源文件），
 * 所以这条用例留在 `packages/contracts/test/` 即可，不必挪去 `apps/desktop/src/main`。
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AI_FLAVOR_MIN_COUNT } from "../src/ai-flavor.js";
import {
  FLAVOR_CORPUS_GAP,
  calibrateFlavor,
  formatCalibrationTable
} from "../src/flavor-calibration.js";

const CORPUS_DIR = fileURLToPath(new URL("../corpus/", import.meta.url));

/** 递归收语料文件；目录不存在（或读不动）当空目录。 */
async function collectCorpusFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
  if (entries === null) return [];
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectCorpusFiles(full)));
    else if (/\.(txt|md)$/i.test(entry.name)) out.push(full);
  }
  return out.sort();
}

describe("flavor-calibration · 语料入口用例", () => {
  it("corpus/ 里有真人语料就出表；没有就打印缺口并断言零样本", async () => {
    const files = await collectCorpusFiles(CORPUS_DIR);
    const docs: string[] = [];
    for (const file of files) docs.push(await readFile(file, "utf8"));

    if (docs.length === 0) {
      console.log(FLAVOR_CORPUS_GAP);
      const rows = calibrateFlavor([]);
      expect(rows).toHaveLength(4);
      for (const row of rows) expect(row.samples).toBe(0);
      return;
    }

    const rows = calibrateFlavor(docs);
    console.log(formatCalibrationTable(rows));
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.current).toBe(AI_FLAVOR_MIN_COUNT[row.category]);
  });
});
