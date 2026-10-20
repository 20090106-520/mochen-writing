# 任务清单 · 用笔处置（五）：详略三测 ＋ 章末最后一拍（2026-10-20）

> 规范：[spec.md](./spec.md)。TDD：先写失败判据 → 再实现 → 转绿 → 全仓门禁 → 本地收口（**不推送**）。

- [x] T1 先写失败判据（跑红）
  - [x] T1.1 `apps/desktop/src/main/agent-service-prompt.test.ts` 在「拼装」describe 内追加 1 条：
    两条成法各钉一句原文——详略三测（「详略三测」／「删的是废话」／「电报体」）、
    章末最后一拍（「章末最后一拍」／「不在章尾开新线」／「让处境、关系或读者的悬念动一下」），
    并断言落点在 `HUMAN_DIALOGUE_INSTRUCTION` 那段（`对话写法要求`）之后。
  - [x] T1.2 跑该文件 → 确认红（1 failed / 35 passed，失败于 `toContain("详略三测")`）。

- [x] T2 实现 · 生成端新段（`apps/desktop/src/main/prompt-assembly.ts`）
  - [x] T2.1 新增 `DETAIL_AND_BEAT_INSTRUCTION`（两条：详略三测／章末最后一拍），
    常量注释写清三件事——报告前提不成立故为新写、与「章末四禁」互补、与 `deslop-structure`
    删除优先＋电报体自检同源、两条都只进生成端不上扫描。
  - [x] T2.2 装配数组里**紧接 `HUMAN_DIALOGUE_INSTRUCTION` 之后**注入。

- [x] T3 判据转绿
  - [x] T3.1 该测试文件全绿（36 passed）；既有六段常驻断言一字不动。
  - [x] T3.2 全仓 `corepack pnpm verify` 全绿：`VERIFY_EXIT=0`（374 文件 / 4917 passed | 2 skipped）。

- [x] T4 本地收口（**按用户要求不推送**）
  - [x] T4.1 台账 `docs/superpowers/plans/2026-10-09-full-scan-report.md` 补记第一百三十六节。
  - [x] T4.2 commit（不 push）。
  - [x] T4.3 工作树干净、仓外临时件清零；README 门禁节 / CI **有意不动**（理由见 spec 第五节）。
