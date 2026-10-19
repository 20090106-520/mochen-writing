# 任务清单 · 作者风格档案下沉（P0-③ · 2026-10-19）

> 规范：[spec.md](./spec.md)。TDD：先写失败判据 → 再实现 → 转绿 → 全仓门禁 → 本地收口（**不推送**）。

- [x] T1 先写失败判据（跑红）
  - [x] T1.1 新增 `packages/contracts/test/dialogue.test.ts`：半角 `"`（行内奇偶）／弯引号 `“”` 进配对；
    `「」` 稿读数与旧口径一致；`endsInsideQuote` 两态（`「喝吧。` ⇒ true；`「喝吧。」她推过杯子。` ⇒ false）
  - [x] T1.2 新增 `packages/contracts/test/style-profile.test.ts`：样本 <500 字 ⇒ null；
    句长／波动读数；标点每千字；对白占比与 `dialogueBalance` 同一份数；段末收法计数
  - [x] T1.3 `apps/desktop/src/main/agent-service-prompt.test.ts` 追加 1 组：够量 ⇒ 摘要段在位（四维＋硬约束优先＋段落位置）；
    样本不足 ⇒ 不注入；只有非 chapter 条目 ⇒ 不注入
  - [x] T1.4 跑这三处 → 确认红：**3 文件 9 failed**

- [x] T2 实现 · 配对真身（`packages/contracts/src/dialogue.ts`）
  - [x] T2.1 私有 `scanQuotes`（全角＋弯引号＋半角行内奇偶＋行末回落），`dialogueBalance` 改走它（口径不变）
  - [x] T2.2 新增导出 `endsInsideQuote`
  - [x] T2.3 文件头注释同步（补两条）

- [x] T3 实现 · 测量真身（`packages/contracts/src/style-profile.ts` 新增 ＋ `index.ts` 导出）
  - [x] T3.1 `STYLE_PROFILE_MIN_CHARS` / `STYLE_PROFILE_PUNCTUATION` / `StyleProfile` / `styleProfileOf`
  - [x] T3.2 `index.ts` 紧邻 `./dialogue.js` 追加一行导出

- [x] T4 实现 · 生成端那段（`apps/desktop/src/main/prompt-assembly.ts`）
  - [x] T4.1 新增 `styleProfileSentence`（四维＋保持腔调＋允许例外＋硬约束优先＋两维不报）
  - [x] T4.2 装配数组里紧接 `dialogueBalanceSentence` 之后注入（空串不注入）

- [x] T5 判据转绿
  - [x] T5.1 三处测试全绿（**57 passed**）；既有守卫一字不动（除 spec §三.5 明列的「半角引号稿从读不出来到读得出来」）
  - [x] T5.2 全仓 `corepack pnpm verify` 全绿：**366 文件 / 4817 passed | 2 skipped**，`VERIFY_EXIT=0`

- [x] T6 本地收口（**按用户要求不推送**）
  - [x] T6.1 台账 `docs/superpowers/plans/2026-10-09-full-scan-report.md` 补记 §一百三十二
  - [x] T6.2 commit（不 push）→ 工作树干净、仓外临时件清零

## 落地结果（2026-10-19）

| 项 | 结果 |
| --- | --- |
| 新增用例 | 26 条（对话配对 10 ＋ 腔调测量 12 ＋ 提示词 4） |
| 全仓门禁 | `corepack pnpm verify` → **366 文件 / 4817 passed \| 2 skipped**，`VERIFY_EXIT=0` |
| 提交 | 见台账 §一百三十二（**未推送**） |
| 未收口 | ③⑥ 两维只进生成端；段末收法／半角配对为启发式（详见 spec §五） |
