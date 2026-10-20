# 任务清单 · P1-⑦ 退化专项零阈值代理读数

## T1 contracts 读数真身

- [x] `packages/contracts/src/text-degeneration.ts`（新）
  - `DEGENERATION_PARTICLE_CHARS`：26 枚单字虚词（助词 7 ＋ 介词 11 ＋ 连词 8）
  - `DEGENERATION_SHORT_SENTENCE_MAX_CHARS = 4`：短句刻度（定义参数，非判线）
  - `DegenerationReading`：`charCount` / `particlePerThousand` / `shortSentenceRatio` / `meanSentenceLength`
  - `degenerationOf(text)`：一次算齐
    - `particlePerThousand`：虚词命中 ÷ 字数 × 1000（2 位小数）；无字 → null
    - `shortSentenceRatio`：短句数 ÷ 句数（3 位小数）；不足 `SENTENCE_SPREAD_MIN_SENTENCES` 句 → null
    - `meanSentenceLength`：取 `sentenceRhythmOf(t)?.mean`；不足句数 → null
- [x] `packages/contracts/src/ai-flavor.ts`：`sentencesOf` 由私有提升为导出（切句只此一份）
- [x] `packages/contracts/src/index.ts`：`./text-vitality.js` 之后转出一行

## T2 contracts 用例 + 变异

- [x] `packages/contracts/test/text-degeneration.test.ts`（新）：
  - 门口：不足 10 句 → 两枚句级读数为 null，虚词密度照出；空文本 → 全 null
  - 虚词密度：交替句（他走。／他慢慢地走过来了。）→ 250/千字
  - 短句占比：同上 → 0.5；平均句长 → 6
  - 不变量：`meanSentenceLength === sentenceRhythmOf(t)?.mean`；`charCount === t.length === aiFlavorGate(t).charCount`
  - 清单：非空、无重复（虚词清单只此一份）
- [x] 变异：清空虚词清单 → 虚词密度用例红；短句刻度 4 → 5 → 短句占比用例红；还原全绿

## T3 渲染层

- [x] `apps/desktop/src/renderer/src/utils/draft-candidates.ts`：
  `DRAFT_DEGENERATION_NOTE` / `DRAFT_DEGENERATION_UNKNOWN` / `draftDegenerationLine(text)`
- [x] `components/DraftCandidates.vue`：加一行退化读数 ＋ 一句提示（不动排序／store／IPC）
- [x] `apps/desktop/src/renderer/src/utils/draft-candidates.test.ts`：新增 4 条用例

## T4 门禁与台账

- [x] `prettier --write` 触及的源码文件
- [x] `corepack pnpm verify` → `VERIFY_EXIT=0`（含行数预算）
- [x] 台账追加 §一百三十九（含推翻 §一百三十六 阻塞判断的理由、未收口项）
- [x] 仅本地 `git commit`（不推送）
