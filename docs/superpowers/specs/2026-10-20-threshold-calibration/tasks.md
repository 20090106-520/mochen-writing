# 2026-10-20 判据阈值真人语料校准 · 任务清单

口径与不变量见 `spec.md`。**这一刀只落基础设施，四枚阈值一个不动。**
每步收口都跑 `corepack pnpm verify`（须 `VERIFY_EXIT=0`）；本刀**不 commit、不 push**。

---

## T1 `packages/contracts/src/ai-flavor.ts`（只做两处小改）

- [x] T1.1 先 grep `MIN_COUNT` / `normalizeDialogueQuotes` 的全部引用点，确认改名/导出不打破别处
      （结论：`MIN_COUNT` 只在 `analyzeAiFlavor` 里用一次，其余全是注释；`normalizeDialogueQuotes` 只在本文件两处调用）。
- [x] T1.2 `const MIN_COUNT: Record<AiFlavorCategory, number>` → `export const AI_FLAVOR_MIN_COUNT`；
      同步 `analyzeAiFlavor` 的引用（`?? AI_FLAVOR_MIN_COUNT[category]`）与两处注释字样。
- [x] T1.3 `normalizeDialogueQuotes` 改 `export function`（函数体、正则、词表、四枚数值、gate 常量一律不动）。
- [x] T1.4 `test/ai-flavor.test.ts` 里那处提到 `MIN_COUNT` 的注释一并对齐。

## T2 `packages/contracts/src/flavor-calibration.ts`（新建，纯函数、不碰 fs）

- [x] T2.1 词表与正则全部 **import** 自 `ai-flavor.js`（`AI_FLAVOR_TERMS` ＋ 六个正则/标签 ＋
      `AI_FLAVOR_MIN_COUNT` ＋ `normalizeDialogueQuotes` ＋ `AI_FLAVOR_CATEGORY_LABELS`）——不抄第二份。
- [x] T2.2 私有 `countTermIn` 逐字对齐 `aiFlavorGate` 的 indexOf 循环；`PATTERN_SAMPLES` 复刻标签→类别映射
      （cognitive → `cognitive`；antithesis/tail/contrast/emotion → `essay`；dialogue 单独走归一）。
- [x] T2.3 导出 `FlavorTermSample`、`flavorTermSamples`、`CategoryCalibration`、`calibrateFlavor`、
      `FLAVOR_CORPUS_GAP`、`formatCalibrationTable`。
- [x] T2.4 分位走最近秩法（`clamp(⌈q·n⌉, 1, n)`）；`samples === 0` ⇒ 分位与 `overShare` 全 `null`。

## T3 `packages/contracts/test/flavor-calibration.test.ts`（新建，纯单测）

- [x] T3.1 **不变量**：≥3 段样本（含副词/对话标签/情绪直陈命中），逐段断言
      `Σ(count | category ≠ "adverb") === aiFlavorGate(t).hits`；另加多篇版。
- [x] T3.2 `flavorTermSamples` 只收 `count ≥ 1`（没出现的条目零样本；干净段落零样本）；「缓缓」×2 归 `adverb`。
- [x] T3.3 同一句式条目跨篇各出一条样本（`docIndex` 不同，对话标签也测）。
- [x] T3.4 构造语料（三篇，自造，不用现成夹具）上 `calibrateFlavor` 的分位与 `overShare` 手算对照：
      cliche 样本 [1,1,1,2]、essay 全 1、adverb [2]、cognitive [1,2]；`overShare` = 0.25 / 1 / 0 / 0。
- [x] T3.5 空语料：`samples === 0`、分位全 `null`、`overShare === null`。
- [x] T3.6 `formatCalibrationTable` 输出含 category / current / p95 / overShare 的数值文本；5 行（表头 + 四类）。
- [x] T3.7 `FLAVOR_CORPUS_GAP` 非空且含中文。

## T4 `packages/contracts/test/flavor-calibration.corpus.test.ts`（新建，投料即出表）

- [x] T4.1 **先确认落点**：`tools/check-package-boundary.mjs` 对 `packages/*` 只拦 `electron`，`node:` 不在其列
      （同包 `test/change-retention.test.ts` 早有先例）⇒ **留在 `packages/contracts/test/`**，
      不必挪去 `apps/desktop/src/main`。
- [x] T4.2 `corpus/` 用 `import.meta.url` 推绝对路径；递归收 `*.txt` / `*.md`（目录不存在 ⇒ `[]`）。
- [x] T4.3 `docs.length === 0` ⇒ 打印 `FLAVOR_CORPUS_GAP` 并断言四类 `samples === 0`（**用例通过、缺口可见**）；
      否则 ⇒ 打印 `formatCalibrationTable` 并断言 4 行、`current === AI_FLAVOR_MIN_COUNT[category]`。

## T5 导出面与忽略

- [x] T5.1 `packages/contracts/src/index.ts` 在 `./ai-flavor.js` 之后增 `export * from "./flavor-calibration.js";`。
- [x] T5.2 `.gitignore` 按既有分组风格增 `packages/contracts/corpus/`（受版权语料不进仓）。

## T6 门禁

- [x] T6.1 `vitest run` 两条新用例 + `vitest run packages/contracts` 全量。
- [x] T6.2 `tsc` 三处：contracts、desktop `tsconfig.node.json`、desktop `tsconfig.web.json`。
- [x] T6.3 `eslint . --max-warnings=0`、`check-package-boundary.mjs`、`check-source-line-budget.mjs`、`prettier --check .`。

## 后续（另开一刀，不在本刀射程）

- 语料入库（`packages/contracts/corpus/`，本地、不进仓）→ 跑 T4 用例出表 → 人定夺是否改四枚阈值。
