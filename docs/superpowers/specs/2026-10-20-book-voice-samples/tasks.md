# 任务清单 · 本书原句样本

## T1 抽取口径（prompt-assembly，私有件）

- [ ] `apps/desktop/src/main/prompt-assembly.ts`：
  - `BOOK_SAMPLE_CHARS = 40`（每枚样本的展示额度，不是判据）
  - `BOOK_SAMPLE_MIN_SENTENCES = 3`（摆得出首／中／尾三枚的结构性下限）
  - 私有 `finishedChaptersText(assembled)`：只并 `kind === "chapter" && active === false` 的正文
  - 私有 `pickByLength(sentences)`：不足 3 句返回 null；按句长排序取**首／中／尾**
  - 私有 `sampleLine(rank, sentence)`：写成 `最短的一句（N 字）：「…」`，超额度截断带「…」
  - 从 `@mochen/contracts` 引入 `sentencesOf`（切句单真身）

## T2 两段动态段

- [ ] `voiceSampleSentence(assembled)`：本书句长的下沿／中沿／上沿三枚原句 +
      「前面各段给的例子只是示意，真要照的是这几条本书原句」+「与硬约束冲突时硬约束优先」
- [ ] `dialogueSampleSentence(assembled)`：同上三枚，但只筛 `dialogueBalance(sentence).quoted > 0` 的对白句
- [ ] `defaultPromptFor` 内算两段、按「非空才加」注入，落点紧接 `styleProfileSentence` 之后

## T3 单测 + 变异

- [ ] `agent-service-prompt.test.ts` 新增 `describe("本书原句样本（2026-10-20：把通用范例句换成本书自己的句子）")`：
  - 够量 ⇒ 段在、「最短/中位/最长」三枚的「N 字」与原文逐位对得上、落在「用笔处置」之后
  - 当前章（`active === true`）不算样本 ⇒ 只有当前一章时不注入
  - 已完稿不足 3 句 ⇒ 不注入；非 `chapter` 条目（人物卡）不参与
  - 超 `BOOK_SAMPLE_CHARS` 的句子被截断、原文不整句进提示词
  - 对白样本只摘含引号的句子；没有对白句 ⇒ 对白段不注入；没有正文 ⇒ 两段都不注入
- [ ] 变异：① 去掉 `active === false` 过滤 → 「当前章不算样本」红；
      ② `pickByLength` 改成按出现序取首/尾 → 三枚顺序用例红；还原全绿

## T4 门禁与台账

- [ ] `prettier --write` 触及的源码文件
- [ ] `corepack pnpm verify` → `VERIFY_EXIT=0`
- [ ] 台账追加 §一百四十一（含「为什么不去改七段静态」「为什么只取已完稿」「为什么三枚是首/中/尾」
      「为什么不足三句不注入」与未收口项）
- [ ] 仅本地 `git commit`（不推送）
