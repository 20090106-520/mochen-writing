# 任务清单 · 明喻密度扫描判据（2026-10-20）

> 规范：[spec.md](./spec.md)。TDD：先写失败判据 → 再实现 → 转绿 → 全仓门禁 → 本地收口（**不推送**）。

- [ ] T1 先写失败判据（跑红）
  - [ ] T1.1 `packages/contracts/test/ai-flavor.test.ts` 新增 describe「明喻句式（2026-10-20…）」：
    4 处起报／3 处不报／四枚标记都认／召回边界（图像·录像·肖像·偶像·不像·像话·像样·像素 不抓）。
  - [ ] T1.2 同文件补退稿闸用例：干净铺底 ＋ 3 处放行、第 4 处退稿。
  - [ ] T1.3 同文件更新进闸清单断言：2 条 → 3 条。
  - [ ] T1.4 跑该文件 → 确认红。
  - [ ] T1.5 **既有夹具的两处订正**（新判据是合法命中，不是误伤；只动测试数据，不动判据）：
    - `packages/contracts/test/ai-flavor.test.ts` 的 adverbsOnly 底稿里有 3 处真明喻
      （「像谁搁在那里的白毡」「长得像没有尽头的河」「像是没挂稳」），`hits).toBe(0)` 会被撑成 3
      → 改这 3 句为非明喻写法，保住该用例「零重罪」的原意。
    - `packages/contracts/test/draft-rank.test.ts` 的 `LONG_TAIL` 里「像要断掉似的」是 1 处明喻，
      会把 `nullRhythm.hits` 顶高 1 → 与 `flatRhythm.hits` 的相等断言失守；换成「眼看就要断了似的」。
    - `CLEAN_FILLER`（ai-flavor.test.ts）里那句「长得像一条没有尽头的河」**不动**：它带 1 处明喻，
      低于起报线 4，既有用 CLEAN_FILLER 的闸用例断言是 `hits < minHits`，不受影响；
      只在 T1.1 的明喻闸用例里另铺一段零明喻底稿。

- [ ] T2 实现（`packages/contracts/src/ai-flavor.ts`）
  - [ ] T2.1 `AI_FLAVOR_SIMILE_PATTERN` ＋ `AI_FLAVOR_SIMILE_LABEL`（与生成端 ④ 同一批，上限 3）。
  - [ ] T2.2 `AI_FLAVOR_STRUCTURE_MIN_COUNT` 追加 明喻 → 4。
  - [ ] T2.3 `AI_FLAVOR_STRUCTURE_GATED_LABELS` 追加 明喻。
  - [ ] T2.4 `analyzeAiFlavor` 补计数；`aiFlavorGate` 补同一份正则计数（退稿信零改动——`doc-tools-host.ts`
    的判退线由 `AI_FLAVOR_STRUCTURE_MIN_COUNT[label] - 1` 派生，自动跟手）。
  - [ ] T2.5 **联动（必改，非可选）**：`packages/contracts/src/flavor-calibration.ts` 的 `PATTERN_SAMPLES`
    补明喻一项（category `essay`）。该文件写明的契约是「任意单篇 `flavorTermSamples([t])` 里
    category ≠ adverb 的 count 总和 **恰好等于** `aiFlavorGate(t).hits`」——只补闸不补它，这条不变量当场破。

- [ ] T3 联动核查 + 转绿
  - [ ] T3.1 核查 `flavor-calibration`（手动枚举则补一项，派生则零改动）。
  - [ ] T3.2 该测试文件全绿；既有六类结构判据断言一字不动。
  - [ ] T3.3 全仓 `corepack pnpm verify` 全绿：`VERIFY_EXIT=0`。

- [ ] T4 本地收口（**按用户要求不推送**）
  - [ ] T4.1 台账 `docs/superpowers/plans/2026-10-09-full-scan-report.md` 补记第一百三十七节。
  - [ ] T4.2 commit（不 push）。
  - [ ] T4.3 工作树干净、仓外临时件清零；README 门禁节 / CI **有意不动**（理由见 spec 第五节）。
