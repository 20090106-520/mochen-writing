# 任务清单 · 句首趋同自查

## T1 常量与抽取（prompt-assembly，私有件）

- [ ] `SENTENCE_OPENING_CHARS = 2`（句首的定义，独立导出以便用例钉住）
- [ ] `SENTENCE_OPENING_MIN_COUNT = 2`（结构性重复下限）
- [ ] `SENTENCE_OPENING_TOP = 5`（展示额度）
- [ ] 私有 `openingOf(sentence)`：剥掉前置标点／符号／空白，取前 `SENTENCE_OPENING_CHARS` 个字
- [ ] 复用 §一百四十一 的 `finishedChaptersText`（已完稿正文，不含当前章）与 `sentencesOf`

## T2 动态段与注入

- [ ] `sentenceOpeningSentence(assembled)`：
      「本书句首提醒：这几个开头已经用多了——「他没」（12 次）、…；新句子换个起法……」
      无重复项（全部 count < 2）返回空串
- [ ] `defaultPromptFor` 在 `dialogueSampleSentence` 之后按「非空才加」注入

## T3 单测 + 变异

- [ ] `agent-service-prompt.test.ts` 新增 `describe`：
  - 计数逐位相等、按次数降序、同数按字符序
  - 只保留 ≥2 次的句首，单次出现的不报
  - 超过 5 种时只列前 5
  - 句首剥标点（`「你先…」` 记成「你先」）
  - 当前章（active）不算；非 chapter 条目不参与
  - 无重复 ⇒ 不注入
- [ ] 变异：① 去掉 `!active` → 当前章用例红；② `MIN_COUNT` 改 1 → 单次用例红；
      ③ 不剥前置标点 → 引号句首用例红；全部还原后全绿

## T4 门禁与台账

- [ ] `prettier --write` 两个源码文件
- [ ] `corepack pnpm verify` → `VERIFY_EXIT=0`
- [ ] 台账追加 §一百四十二
- [ ] 仅本地 `git commit`（不推送）
