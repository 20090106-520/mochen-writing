# 任务清单 · 复读闸（2026-10-18）

> 规范：[spec.md](./spec.md)。TDD：先写失败判据 → 再实现 → 转绿 → 全仓门禁 → 收口（提交/CI/README/台账）。

- [x] T1 先写失败判据（跑红）
  - [x] T1.1 `packages/contracts/test/ai-flavor.test.ts` 新增 describe「repeatedSentences + 复读闸」：
    `repeatedSentences` 计数/过滤/排序四条 + 退稿闸「同一句 ×3 拦、×2 放」+「A B 交替打转也拦」
  - [x] T1.2 既有「副词不算重罪」条样本改为 30 句互不相同（旧样本 6 遍循环会被新条拦下）
  - [x] T1.3 跑该文件 → 确认红：6 条失败（5 条新判据 + 既有「副词」条撞上未实现的 `repeatOver`）

- [x] T2 实现 · 扫描端真身（`packages/contracts/src/ai-flavor.ts`）
  - [x] T2.1 新增 `AI_FLAVOR_REPEAT`（`minChars: 12` / `gateMinCount: 3`）＋ `RepeatedSentence` 类型
  - [x] T2.2 新增 `repeatedSentences(contents, minChars)`（复用 `sentencesOf()`，count ≥2 入表、按次数降序）
  - [x] T2.3 `AiFlavorGateVerdict` 新增 `repeatOver: RepeatedSentence[]`
  - [x] T2.4 `aiFlavorGate` 算 `repeatOver` 并入 `pass`
  - [x] T2.5 文件头「四类口径」注释补复读口径一条

- [x] T3 实现 · 巡检面板委托真身（`apps/desktop/src/renderer/src/utils/doc-checkup.ts`）
  - [x] T3.1 `findDuplicateSentences` 改为委托 `repeatedSentences`，保留原签名与封顶
  - [x] T3.2 `DUPLICATE_SENTENCE_MIN_CHARS` 改为 `AI_FLAVOR_REPEAT.minChars`；`DuplicateSentence` 复用 `RepeatedSentence`
  - [x] T3.3 `doc-checkup.test.ts` 重复句组转绿（行为一字不变）

- [x] T4 实现 · 生成端 ⑩ ＋ 退稿信话术
  - [x] T4.1 `apps/desktop/src/main/prompt-assembly.ts`：`DE_AI_FLAVOR_STRUCTURE_INSTRUCTION` 加第 ⑩ 条
  - [x] T4.2 `apps/desktop/src/main/doc-tools-host.ts`：`repeatOver` 非空时退稿信补「复读」一句
  - [x] T4.3 `doc-tools-host.test.ts` 钉一条（同一句三遍 → 信中含「复读」与次数）

- [x] T5 判据转绿
  - [x] T5.1 `ai-flavor.test.ts` 全绿（37 条）
  - [x] T5.2 邻近守卫全绿（`doc-checkup.test.ts` 23 条 / `doc-tools-host.test.ts` 57 条）
  - [x] T5.3 全仓 `corepack pnpm verify` 全绿：`VERIFY_EXIT=0`（364 文件 / 4779 passed | 2 skipped）

- [ ] T6 收口
  - [ ] T6.1 代码/判据/spec 提交并推送 `feat/plan3-interaction-and-assembly`
  - [ ] T6.2 读真实 CI（私有仓需带凭据）
  - [ ] T6.3 README「## 门禁」节换绑 ＋ `tools/readme-claims.test.mjs` 回填链注释同步
  - [ ] T6.4 台账补记新一节
  - [ ] T6.5 工作树干净、未收口项如实留档、清理仓外临时件
