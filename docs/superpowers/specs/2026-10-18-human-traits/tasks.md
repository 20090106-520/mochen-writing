# 任务清单 · 人味写作（二）四个正向维度（2026-10-18）

> 规范：[spec.md](./spec.md)。TDD：先写失败判据 → 再实现 → 转绿 → 全仓门禁 → 本地收口（**不推送**）。

- [x] T1 先写失败判据（跑红）
  - [x] T1.1 `apps/desktop/src/main/agent-service-prompt.test.ts` 追加 1 条：四个维度各钉一句原文
    （逻辑「他此刻想要什么、怕什么」／片段「每场戏都要有事发生」／细节「细节选得准、留得少」／
    语言「句子跟着情绪走」＋「毛边」）
  - [x] T1.2 跑该文件 → 确认红（提示词里没有这段）

- [x] T2 实现 · 生成端新段（`apps/desktop/src/main/prompt-assembly.ts`）
  - [x] T2.1 新增 `HUMAN_CRAFT_INSTRUCTION`（四条：逻辑／片段／细节／语言，含分工与扫描端对齐注释）
  - [x] T2.2 装配数组里紧接 `NARRATIVE_CRAFT_INSTRUCTION` 之后注入

- [x] T3 判据转绿
  - [x] T3.1 `agent-service-prompt.test.ts` 全绿（既有 5 条提示词判据一字不动）
  - [x] T3.2 全仓 `corepack pnpm verify` 全绿：`VERIFY_EXIT=0`

- [x] T4 本地收口（**按用户要求不推送**）
  - [x] T4.1 commit（不 push）
  - [x] T4.2 工作树干净、仓外临时件清零
  - [x] T4.3 README 门禁节 / CI / 台账**有意不动**，理由写进 spec 第五节
