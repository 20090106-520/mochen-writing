# 2026-10-20 文本活性代理指标层 · 任务清单

口径与不变量见 `spec.md`。**先红后绿**：每步先写会红的用例，再补实现。
每步收口都跑 `corepack pnpm verify`（须 `VERIFY_EXIT=0`），全绿后按小节提交（**不推送**）。

多行 commit message 用 `.git/COMMIT_MSG` + `git commit -F`（PowerShell 不支持 bash heredoc）。
PowerShell 里不用 `&&` 串联命令，用 `;`。

---

## T1 读数契约（`packages/contracts/src/text-vitality.ts` + 单测）

- 先写 `packages/contracts/test/text-vitality.test.ts`（先红）：
  - `charNgramEntropy`：手算定值（`"abab"` ⇒ 0.918…；`"aabb"` ⇒ log2 3 = 1.585…）；同长重复串的熵 = 0；
    短于 n 字 ⇒ `null`。
  - `sentenceBurstiness`：**反推不变量**——对任意语料恒等于 `(sentenceRhythmOf(t)!.spread − 1) / (spread + 1)`；
    句句等长（spread = 0）⇒ −1；不足 `SENTENCE_SPREAD_MIN_SENTENCES` 句 ⇒ `null`。
  - `typeTokenRatio`：手算（`"他他他他"` ⇒ 0.25）；空白与换行**不计入** token；无字符 ⇒ `null`。
  - `vitalityOf`：`charCount === text.length`；一项可算另两项 `null` 的混合态逐项断言。
- 再写 `text-vitality.ts` 实现；`index.ts` 在 `./draft-rank.js` 之后转出。
- 行数预算：单文件 < 800 行。

## T2 面板读数行（`utils/draft-candidates.ts` + 用例）

- 先写用例（补进 `draft-candidates.test.ts`）：三项各出一句；**算不出的那项整个不出现**（不硬凑）；
  `DRAFT_VITALITY_NOTE` 里必须同时出现「不是判据」与长度偏差的交代。
- 再写 `draftVitalityLine(text)` 与 `DRAFT_VITALITY_NOTE`（文案只此一份，照 `draftReadingLine` 的口径）。

## T3 面板接线（`components/DraftCandidates.vue`）

- 每稿在读数行下加一行活性读数（`draftVitalityLine(candidate.text)`）；面板标题下加 `DRAFT_VITALITY_NOTE`。
- 不新增 prop / emit（正文已在 `candidate.text` 上）；不改 `draftReadingLine` / `rankDrafts` / store / 夹具。

## T4 门禁与台账

- `corepack pnpm verify` 全绿（`prettier` → 6 枚 tsc → eslint → 边界 → 行数预算 → vitest，末行 `VERIFY_EXIT=0`）。
- 台账 `docs/superpowers/plans/2026-10-09-full-scan-report.md` 追加 **§一百三十五**：本刀取舍
  （为什么取 ⑥ 不取 ④ / ⑤、为什么报熵不报困惑度、为什么不聚合总分、为什么不导出长度阈值、为什么不改排序键）。
- `commit`（多条 message 走 `-F`），**不推送**。
